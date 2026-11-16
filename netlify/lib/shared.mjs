// Shared helpers for the Netlify functions. Not a function itself (lives outside netlify/functions).
import crypto from 'node:crypto';

const env = (k) => process.env[k] || '';
export const SUPABASE_URL = () => env('SUPABASE_URL').replace(/\/$/, '');

export const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

/** The signed-in Supabase user behind the request's bearer token, or null. */
export async function userFromRequest(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL()}/auth/v1/user`, { headers: { apikey: env('SUPABASE_ANON_KEY'), authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}

/** Supabase REST with the service-role key (bypasses row level security — server only). */
export async function db(path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${SUPABASE_URL()}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Database error ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Flatten nested objects into Stripe's form encoding: a[b][0][c]=v */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(path, params, method = 'POST') {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : form(params || {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'Stripe error');
  return data;
}

/** Verify a Stripe webhook signature without the Stripe SDK. */
export function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries((header || '').split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = (header || '').split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

export const FREE_DELIVERIES = 10;     // per year, every account
export const MIN_BINS = 3;
export const binPrice = () => env('STRIPE_PRICE_BIN');            // $5/month, per unit
export const oversizedPrice = () => env('STRIPE_PRICE_OVERSIZED'); // optional, $7/month per unit

/** What a customer should be billed for right now, from their bins. */
export async function billableCounts(userId) {
  const bins = await db(`bins?owner_id=eq.${userId}&select=kind`);
  return {
    bins: Math.max(MIN_BINS, bins.filter((b) => b.kind === 'bin').length),
    oversized: bins.filter((b) => b.kind === 'oversized').length,
  };
}
export const siteUrl = (req) => env('URL') || new URL(req.url).origin;
