// Starts Stripe Checkout for a plan subscription or a rental booking.
import { json, userFromRequest, db, stripe, binPrice, oversizedPrice, billableCounts, siteUrl } from '../lib/shared.mjs';

async function ensureCustomer(profile) {
  if (profile.stripe_customer_id) return profile.stripe_customer_id;
  const c = await stripe('customers', {
    email: profile.email, name: profile.full_name || undefined, phone: profile.phone || undefined,
    address: profile.address_line1 ? { line1: profile.address_line1, line2: profile.address_line2 || undefined, city: profile.city, postal_code: profile.postal_code, state: 'ON', country: 'CA' } : undefined,
    metadata: { user_id: profile.id },
  });
  await db(`profiles?id=eq.${profile.id}`, { method: 'PATCH', body: { stripe_customer_id: c.id } });
  return c.id;
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const user = await userFromRequest(req);
  if (!user) return json(401, { error: 'Please log in again.' });
  const body = await req.json().catch(() => ({}));
  const [profile] = await db(`profiles?id=eq.${user.id}&select=*`);
  if (!profile) return json(404, { error: 'Profile not found' });
  const customer = await ensureCustomer(profile);
  const base = siteUrl(req);
  const tax = process.env.STRIPE_AUTOMATIC_TAX === 'true' ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' } } : {};

  try {
    if (body.kind === 'plan') {
      if (!binPrice()) return json(400, { error: 'Billing is not set up yet' });
      // Bill for the bins they have (or the 3-bin minimum); founding members get free months first.
      const counts = await billableCounts(user.id);
      const trial = parseInt(process.env.STRIPE_FOUNDING_TRIAL_DAYS || '0', 10);
      const line_items = [{ price: binPrice(), quantity: counts.bins }];
      if (counts.oversized && oversizedPrice()) line_items.push({ price: oversizedPrice(), quantity: counts.oversized });
      const session = await stripe('checkout/sessions', {
        mode: 'subscription', customer, line_items,
        subscription_data: { metadata: { user_id: user.id, plan: 'standard' }, ...(trial > 0 && profile.subscription_status === 'none' ? { trial_period_days: trial } : {}) },
        metadata: { kind: 'plan', user_id: user.id, plan: 'standard' },
        allow_promotion_codes: 'true',
        success_url: `${base}/app.html?checkout=success#account`,
        cancel_url: `${base}/app.html#account`,
        ...tax,
      });
      return json(200, { url: session.url });
    }

    if (body.kind === 'rental') {
      const [booking] = await db(`rental_bookings?id=eq.${encodeURIComponent(body.booking_id)}&select=*,item:rental_items(name)`);
      if (!booking || booking.customer_id !== user.id) return json(404, { error: 'Booking not found' });
      if (booking.paid) return json(400, { error: 'That booking is already paid' });
      const session = await stripe('checkout/sessions', {
        mode: 'payment', customer,
        line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: booking.total_cents, product_data: { name: `${booking.item?.name || 'Rental'} × ${booking.quantity}`, description: `${booking.start_date} to ${booking.end_date}, delivered and picked up` } } }],
        metadata: { kind: 'rental', booking_id: booking.id, user_id: user.id },
        payment_intent_data: { metadata: { kind: 'rental', booking_id: booking.id } },
        success_url: `${base}/app.html?checkout=success#requests`,
        cancel_url: `${base}/app.html#requests`,
        ...tax,
      });
      return json(200, { url: session.url });
    }
    return json(400, { error: 'Unknown checkout type' });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
