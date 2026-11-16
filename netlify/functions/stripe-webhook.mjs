// Keeps Supabase in sync with Stripe: plan + subscription status, and paid rental bookings.
// In Stripe → Developers → Webhooks, point an endpoint at /.netlify/functions/stripe-webhook and send:
//   checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted
import { json, db, verifyStripeSignature, PLAN_CREDITS, planForPrice } from '../lib/shared.mjs';

const STATUS = { active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'past_due', incomplete: 'none', incomplete_expired: 'canceled', canceled: 'canceled', paused: 'past_due' };

export default async (req) => {
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET || '')) {
    return json(400, { error: 'Bad signature' });
  }
  const event = JSON.parse(raw);
  const obj = event.data.object;

  try {
    if (event.type === 'checkout.session.completed' && obj.metadata?.kind === 'rental' && obj.payment_status === 'paid') {
      await db(`rental_bookings?id=eq.${obj.metadata.booking_id}`, { method: 'PATCH', body: { paid: true } });
    }

    if (event.type.startsWith('customer.subscription.')) {
      const plan = obj.metadata?.plan || planForPrice(obj.items?.data?.[0]?.price?.id);
      let userId = obj.metadata?.user_id;
      if (!userId) {
        const [p] = await db(`profiles?stripe_customer_id=eq.${obj.customer}&select=id`);
        userId = p?.id;
      }
      if (userId) {
        const [current] = await db(`profiles?id=eq.${userId}&select=plan,subscription_status`);
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : (STATUS[obj.status] || 'none');
        const patch = { subscription_status: status };
        // New plan (or first activation): set it and refresh the year's delivery credits.
        if (plan && status === 'active' && (plan !== current?.plan || current?.subscription_status !== 'active')) {
          const reset = new Date(); reset.setFullYear(reset.getFullYear() + 1);
          Object.assign(patch, { plan, delivery_credits: PLAN_CREDITS[plan], credits_reset_on: reset.toISOString().slice(0, 10) });
        }
        await db(`profiles?id=eq.${userId}`, { method: 'PATCH', body: patch });
      }
    }
    return json(200, { received: true });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
