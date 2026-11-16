// Opens the Stripe Customer Portal: update card, see invoices, change or cancel plan.
import { json, userFromRequest, db, stripe, siteUrl } from '../lib/shared.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const user = await userFromRequest(req);
  if (!user) return json(401, { error: 'Please log in again.' });
  const [profile] = await db(`profiles?id=eq.${user.id}&select=stripe_customer_id`);
  if (!profile?.stripe_customer_id) return json(400, { error: 'Start a plan first — then billing lives here.' });
  try {
    const s = await stripe('billing_portal/sessions', { customer: profile.stripe_customer_id, return_url: `${siteUrl(req)}/app.html#account` });
    return json(200, { url: s.url });
  } catch (err) { return json(500, { error: err.message }); }
};
