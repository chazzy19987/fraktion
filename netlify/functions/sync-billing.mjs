// Keeps a customer's Stripe subscription in step with their bin count.
// Called from the ops board after a bin drop-off is completed (staff only).
import { json, userFromRequest, db, stripe, binPrice, oversizedPrice, billableCounts } from '../lib/shared.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const user = await userFromRequest(req);
  if (!user) return json(401, { error: 'Please log in again.' });
  const [me] = await db(`profiles?id=eq.${user.id}&select=is_admin`);
  if (!me?.is_admin) return json(403, { error: 'Staff only' });

  const { customer_id } = await req.json().catch(() => ({}));
  const [p] = await db(`profiles?id=eq.${encodeURIComponent(customer_id)}&select=stripe_customer_id`);
  if (!p?.stripe_customer_id) return json(200, { skipped: 'Customer has not started billing yet' });

  try {
    const subs = await stripe(`subscriptions?customer=${p.stripe_customer_id}&status=all&limit=10`, null, 'GET');
    const sub = subs.data.find((x) => ['active', 'trialing', 'past_due'].includes(x.status));
    if (!sub) return json(200, { skipped: 'No live subscription' });
    const counts = await billableCounts(customer_id);
    const want = [[binPrice(), counts.bins], [oversizedPrice(), counts.oversized]].filter(([price]) => price);
    const items = [];
    for (const [price, quantity] of want) {
      const existing = sub.items.data.find((i) => i.price.id === price);
      if (existing) items.push(quantity ? { id: existing.id, quantity } : { id: existing.id, deleted: 'true' });
      else if (quantity) items.push({ price, quantity });
    }
    // Index the items array the way Stripe's form encoding expects: items[0][id]=…
    await stripe(`subscriptions/${sub.id}`, { items: Object.fromEntries(items.map((it, i) => [i, it])), proration_behavior: 'create_prorations' });
    return json(200, { ok: true, ...counts });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
