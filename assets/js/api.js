// Fraktion data layer.
// Runs in one of two modes:
//   • live — Supabase (auth + database) and Stripe (billing via Netlify functions)
//   • demo — everything stored in this browser, so the site works before any keys are added
// Every page talks to this file only, so swapping or extending the backend happens here.

import { isoDate, serviceDays } from './ui.js';

export const PLANS = {
  starter: { name: 'Starter', price: 5, priceLabel: '$5', unit: 'per bin / month', bins: null, credits: 4, blurb: 'Pay per bin. Perfect for seasonal stuff.' },
  family: { name: 'Family', price: 35, priceLabel: '$35', unit: 'per month · 10 bins', bins: 10, credits: 10, blurb: 'The sweet spot for a busy household.' },
  pro: { name: 'Pro', price: 79, priceLabel: '$79', unit: 'per month · 25 bins', bins: 25, credits: null, blurb: 'Unlimited deliveries. Basement, cleared.' },
};
export const EXTRA_DELIVERY_CENTS = 999;
export const OVERSIZED_CENTS = 700;

let mode = 'demo';
let sb = null;            // Supabase client (live mode)
let cfg = {};
let ready;

export function init() {
  if (ready) return ready;
  ready = (async () => {
    cfg = { ...(window.FRAKTION_CONFIG || {}) };
    // On Netlify, keys come from environment variables via a tiny function — no code edits needed.
    try {
      const r = await fetch('/.netlify/functions/config', { cache: 'no-store' });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
        const remote = await r.json();
        for (const [k, v] of Object.entries(remote)) if (v) cfg[k] = v;
      }
    } catch { /* local preview — fall back to config.js */ }

    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      mode = 'live';
    }
    return { mode, stripe: !!cfg.stripeEnabled };
  })();
  return ready;
}
export const getMode = () => mode;

const fail = (error) => { if (error) throw new Error(error.message || String(error)); };

/* =====================================================================
   DEMO STORE — mirrors the database rules in supabase/schema.sql
   ===================================================================== */
const DEMO_KEY = 'fraktion-demo-v3';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const nowIso = () => new Date().toISOString();
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

function seed() {
  const me = 'demo-user';
  const sd = serviceDays(6);
  const bin = (n, owner, label, emoji, tags, contents, status, location, kind = 'bin') => ({
    id: uid(), code: `FRK-${String(n).padStart(4, '0')}`, owner_id: owner, kind, label, emoji, tags, contents, status,
    location, created_at: daysFromNow(-60 + n).toISOString(), updated_at: daysFromNow(-10 + (n % 7)).toISOString(),
  });
  const bins = [
    bin(12, me, 'Christmas decorations', '🎄', ['holiday', 'fragile'], 'String lights (4)\nGlass ornaments\nWreath\nTree skirt\nAdvent calendar', 'stored', 'A-03-2'),
    bin(13, me, 'Halloween', '🎃', ['holiday'], 'Costumes (kids)\nPumpkin lights\nFake cobwebs\nInflatable ghost', 'stored', 'A-03-3'),
    bin(14, me, 'Baby clothes 0–12m', '👶', ['kids', 'keep'], 'Onesies\nSleepers\nHats & mitts\nSwaddles', 'stored', 'A-04-1'),
    bin(15, me, 'Camping gear', '⛺', ['summer', 'outdoor'], 'Tent (4 person)\nSleeping bags (2)\nCamp stove\nHeadlamps', 'stored', 'B-01-2'),
    bin(16, me, 'Books & yearbooks', '📚', ['keepsakes'], 'High school yearbooks\nPhoto albums\nKids’ art folder', 'with_customer', null),
    bin(17, me, 'Winter clothes', '🧥', ['seasonal'], 'Snow pants\nBoots (kids)\nParkas', 'with_customer', null),
    bin(18, me, 'Christmas tree (7 ft)', '🌲', ['holiday', 'oversized'], 'Artificial tree, 3 sections + stand', 'stored', 'OS-02', 'oversized'),
    bin(21, 'cust-2', 'Hockey equipment', '🏒', ['sports'], 'Pads, helmet, skates', 'stored', 'A-05-1'),
    bin(22, 'cust-2', 'Patio cushions', '🌱', ['summer'], 'Cushions (6)', 'stored', 'A-05-2'),
    bin(23, 'cust-3', 'Office files 2019–2023', '🗂️', ['business'], 'Tax returns, receipts', 'stored', 'B-02-1'),
  ];
  const req = (customer_id, type, bin_ids, quantity, dayIdx, win, status, ageDays, extra = {}) => ({
    id: uid(), customer_id, type, bin_ids, quantity, scheduled_date: isoDate(sd[dayIdx]), time_window: win, notes: '',
    status, used_credit: type === 'delivery', fee_cents: 0, address: '', created_at: daysFromNow(-ageDays).toISOString(), updated_at: daysFromNow(-ageDays).toISOString(), ...extra,
  });
  const requests = [
    req('cust-2', 'delivery', [bins[7].id], 0, 0, 'evening', 'scheduled', 1, { address: '214 Lakeshore Rd E, Oakville, L6J 1H8', notes: 'Leave at side door' }),
    req('cust-3', 'new_bins', [], 4, 1, 'morning', 'requested', 0, { address: '88 Brant St, Burlington, L7R 2G1' }),
    req(me, 'pickup', [], 0, 0, 'afternoon', 'completed', 12, { bin_ids: [bins[3].id], scheduled_date: isoDate(daysFromNow(-11)), address: '1234 Glen Abbey Gate, Oakville, L6M 2V4' }),
  ];
  const items = [
    { id: 'item-table', slug: 'folding-table-6ft', name: '6 ft grey folding table', description: 'Seats 6–8. Sturdy, wipe-clean top. Great for birthdays, garage sales and holiday overflow.', emoji: '🪑', price_cents_per_day: 2500, quantity_total: 6, max_per_booking: 6, active: true, sort: 1 },
    { id: 'item-chair', slug: 'folding-chair', name: 'Folding chair', description: 'Matching grey folding chairs. Pairs with the 6 ft table.', emoji: '💺', price_cents_per_day: 300, quantity_total: 0, max_per_booking: 40, active: false, sort: 2 },
    { id: 'item-castle', slug: 'bounce-castle', name: 'Bounce castle', description: 'Delivered, set up and taken down by our crew.', emoji: '🏰', price_cents_per_day: 6500, quantity_total: 0, max_per_booking: 1, active: false, sort: 3 },
  ];
  const bookings = [
    { id: uid(), customer_id: 'cust-2', item_id: 'item-table', quantity: 2, start_date: isoDate(sd[3]), end_date: isoDate(sd[4]), time_window: 'morning', address: '214 Lakeshore Rd E, Oakville, L6J 1H8', notes: 'Birthday party', total_cents: 10000, status: 'scheduled', paid: true, created_at: daysFromNow(-2).toISOString() },
  ];
  const profiles = {
    [me]: { id: me, email: 'alex@example.com', full_name: 'Alex Morgan', phone: '905-555-0142', address_line1: '1234 Glen Abbey Gate', address_line2: '', city: 'Oakville', postal_code: 'L6M 2V4', access_notes: 'Garage code 4412', plan: 'family', delivery_credits: 8, subscription_status: 'active', is_admin: true, created_at: daysFromNow(-60).toISOString() },
    'cust-2': { id: 'cust-2', email: 'jordan@example.com', full_name: 'Jordan Patel', phone: '905-555-0199', address_line1: '214 Lakeshore Rd E', city: 'Oakville', postal_code: 'L6J 1H8', plan: 'starter', delivery_credits: 3, subscription_status: 'active', created_at: daysFromNow(-30).toISOString() },
    'cust-3': { id: 'cust-3', email: 'sam@example.com', full_name: 'Sam Rivera', phone: '289-555-0110', address_line1: '88 Brant St', city: 'Burlington', postal_code: 'L7R 2G1', plan: 'starter', delivery_credits: 4, subscription_status: 'none', created_at: daysFromNow(-1).toISOString() },
  };
  return { me, signedIn: false, profiles, bins, requests, items, bookings, waitlist: [], nextCode: 24 };
}
function load() {
  try { const raw = localStorage.getItem(DEMO_KEY); if (raw) return JSON.parse(raw); } catch {}
  const s = seed(); save(s); return s;
}
function save(s) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)); } catch {} }
function tx(fn) { const s = load(); const out = fn(s); save(s); return structuredClone(out ?? null); }
export function resetDemo() { localStorage.removeItem(DEMO_KEY); }
const addressOf = (p) => [p.address_line1, p.address_line2, p.city, p.postal_code].filter(Boolean).join(', ');
const delay = (v) => new Promise((r) => setTimeout(() => r(v), 120));

function demoAvailable(s, item_id, start, end) {
  const it = s.items.find((i) => i.id === item_id);
  let maxBooked = 0;
  for (let d = new Date(start + 'T00:00'); isoDate(d) <= end; d.setDate(d.getDate() + 1)) {
    const day = isoDate(d);
    const booked = s.bookings.filter((b) => b.item_id === item_id && b.status !== 'cancelled' && b.start_date <= day && b.end_date >= day).reduce((a, b) => a + b.quantity, 0);
    maxBooked = Math.max(maxBooked, booked);
  }
  return Math.max(0, it.quantity_total - maxBooked);
}

function demoAdvance(s, r, status) {
  const prev = r.status;
  r.status = status; r.updated_at = nowIso();
  const setBins = (st) => s.bins.forEach((b) => { if (r.bin_ids.includes(b.id)) b.status = st; });
  if (status === 'cancelled' && prev !== 'cancelled' && r.used_credit) {
    const p = s.profiles[r.customer_id]; if (p.delivery_credits !== null) p.delivery_credits += 1;
  }
  if (status === 'en_route') setBins(r.type === 'delivery' ? 'out_for_delivery' : 'to_warehouse');
  if (status === 'completed' && prev !== 'completed') {
    if (r.type === 'delivery') setBins('with_customer');
    if (r.type === 'pickup') setBins('stored');
    if (r.type === 'new_bins') for (let i = 0; i < r.quantity; i++) {
      s.bins.push({ id: uid(), code: `FRK-${String(s.nextCode++).padStart(4, '0')}`, owner_id: r.customer_id, kind: 'bin', label: 'New bin', emoji: '📦', tags: [], contents: '', status: 'with_customer', location: null, created_at: nowIso(), updated_at: nowIso() });
    }
  }
}

/* =====================================================================
   AUTH
   ===================================================================== */
export async function getUser() {
  await init();
  if (mode === 'demo') return load().signedIn ? { id: load().me, email: load().profiles[load().me].email } : null;
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

export async function signUp({ email, password, full_name, postal_code }) {
  await init();
  if (mode === 'demo') return tx((s) => { s.signedIn = true; Object.assign(s.profiles[s.me], { full_name: full_name || s.profiles[s.me].full_name, email: email || s.profiles[s.me].email, postal_code: postal_code || s.profiles[s.me].postal_code }); return { needsConfirmation: false }; });
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name, postal_code }, emailRedirectTo: `${location.origin}/app.html` } });
  fail(error);
  return { needsConfirmation: !data.session };
}

export async function signIn({ email, password }) {
  await init();
  if (mode === 'demo') return tx((s) => { s.signedIn = true; });
  const { error } = await sb.auth.signInWithPassword({ email, password });
  fail(error);
}

export async function sendPasswordReset(email) {
  await init();
  if (mode === 'demo') return delay();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth.html?mode=reset` });
  fail(error);
}

export async function updatePassword(password) {
  await init();
  if (mode === 'demo') return delay();
  const { error } = await sb.auth.updateUser({ password });
  fail(error);
}

export async function signOut() {
  await init();
  if (mode === 'demo') return tx((s) => { s.signedIn = false; });
  await sb.auth.signOut();
}

export function onAuthChange(cb) {
  if (mode === 'live') sb.auth.onAuthStateChange((event, session) => cb(event, session));
}

/* =====================================================================
   PROFILE
   ===================================================================== */
export async function getProfile() {
  await init();
  if (mode === 'demo') return delay(tx((s) => s.profiles[s.me]));
  const user = await getUser();
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
  fail(error); return data;
}

export async function updateProfile(patch) {
  await init();
  const allowed = ['full_name', 'phone', 'address_line1', 'address_line2', 'city', 'postal_code', 'access_notes'];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
  if (mode === 'demo') return delay(tx((s) => Object.assign(s.profiles[s.me], clean)));
  const user = await getUser();
  const { data, error } = await sb.from('profiles').update(clean).eq('id', user.id).select().single();
  fail(error); return data;
}

/* =====================================================================
   BINS
   ===================================================================== */
export async function listBins() {
  await init();
  if (mode === 'demo') return delay(tx((s) => s.bins.filter((b) => b.owner_id === s.me)));
  const { data, error } = await sb.from('bins').select('*').order('code');
  fail(error); return data;
}

export async function updateBin(id, patch) {
  await init();
  const clean = {
    label: String(patch.label ?? '').trim().slice(0, 60) || 'Untitled bin',
    emoji: patch.emoji || '📦',
    tags: [...new Set((patch.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 8),
    contents: String(patch.contents ?? '').slice(0, 2000),
  };
  if (mode === 'demo') return delay(tx((s) => { const b = s.bins.find((x) => x.id === id && x.owner_id === s.me); Object.assign(b, clean, { updated_at: nowIso() }); return b; }));
  const { data, error } = await sb.from('bins').update(clean).eq('id', id).select().single();
  fail(error); return data;
}

/* =====================================================================
   REQUESTS — delivery, pickup, new bins
   ===================================================================== */
export async function listRequests() {
  await init();
  if (mode === 'demo') return delay(tx((s) => s.requests.filter((r) => r.customer_id === s.me).sort((a, b) => b.created_at.localeCompare(a.created_at))));
  const { data, error } = await sb.from('requests').select('*').order('created_at', { ascending: false });
  fail(error); return data;
}

export async function createRequest({ type, bin_ids = [], quantity = 0, scheduled_date, time_window, notes = '' }) {
  await init();
  if (mode === 'demo') {
    return delay(tx((s) => {
      const p = s.profiles[s.me];
      if (scheduled_date < isoDate(new Date())) throw new Error('Pick a date from tomorrow onward');
      if (type !== 'new_bins') {
        if (!bin_ids.length) throw new Error('Choose at least one bin');
        const need = type === 'delivery' ? 'stored' : 'with_customer';
        if (bin_ids.some((id) => s.bins.find((b) => b.id === id)?.status !== need)) throw new Error('One or more bins are not available for this request');
      } else if (quantity < 1 || quantity > 20) throw new Error('Choose between 1 and 20 bins');
      const r = { id: uid(), customer_id: s.me, type, bin_ids, quantity, scheduled_date, time_window, notes, status: 'requested', used_credit: false, fee_cents: 0, address: addressOf(p), created_at: nowIso(), updated_at: nowIso() };
      if (type === 'delivery') {
        if (p.delivery_credits === null) r.used_credit = true;
        else if (p.delivery_credits > 0) { p.delivery_credits -= 1; r.used_credit = true; }
        else r.fee_cents = EXTRA_DELIVERY_CENTS;
      }
      s.requests.push(r);
      return r;
    }));
  }
  const user = await getUser();
  const { data, error } = await sb.from('requests').insert({ customer_id: user.id, type, bin_ids, quantity, scheduled_date, time_window, notes }).select().single();
  fail(error); return data;
}

export async function cancelRequest(id) {
  await init();
  if (mode === 'demo') return delay(tx((s) => { const r = s.requests.find((x) => x.id === id); if (r.status !== 'requested') throw new Error('Only requests that are not yet scheduled can be cancelled'); demoAdvance(s, r, 'cancelled'); return r; }));
  const { data, error } = await sb.from('requests').update({ status: 'cancelled' }).eq('id', id).select().single();
  fail(error); return data;
}

/* =====================================================================
   RENTALS
   ===================================================================== */
export async function listRentalItems() {
  await init();
  if (mode === 'demo') return delay(tx((s) => [...s.items].sort((a, b) => a.sort - b.sort)));
  const { data, error } = await sb.from('rental_items').select('*').order('sort');
  fail(error); return data;
}

export async function rentalAvailable(item_id, start, end) {
  await init();
  if (mode === 'demo') return tx((s) => demoAvailable(s, item_id, start, end));
  const { data, error } = await sb.rpc('rental_available', { p_item: item_id, p_start: start, p_end: end });
  fail(error); return data;
}

export async function listBookings() {
  await init();
  if (mode === 'demo') return delay(tx((s) => s.bookings.filter((b) => b.customer_id === s.me).sort((a, b) => b.created_at.localeCompare(a.created_at))));
  const { data, error } = await sb.from('rental_bookings').select('*').order('created_at', { ascending: false });
  fail(error); return data;
}

export async function createBooking({ item_id, quantity, start_date, end_date, time_window, notes = '' }) {
  await init();
  if (mode === 'demo') {
    return delay(tx((s) => {
      const it = s.items.find((i) => i.id === item_id);
      if (!it.active) throw new Error('That item is not available yet');
      if (start_date <= isoDate(new Date())) throw new Error('Rentals need at least one day of notice');
      if (end_date < start_date) throw new Error('Return date must be on or after the start date');
      const avail = demoAvailable(s, item_id, start_date, end_date);
      if (avail < quantity) throw new Error(`Only ${avail} available for those dates`);
      const days = Math.round((new Date(end_date) - new Date(start_date)) / 86400000) + 1;
      const b = { id: uid(), customer_id: s.me, item_id, quantity, start_date, end_date, time_window, notes, address: addressOf(s.profiles[s.me]), total_cents: it.price_cents_per_day * quantity * days, status: 'requested', paid: false, created_at: nowIso() };
      s.bookings.push(b); return b;
    }));
  }
  const user = await getUser();
  const { data, error } = await sb.from('rental_bookings').insert({ customer_id: user.id, item_id, quantity, start_date, end_date, time_window, notes }).select().single();
  fail(error); return data;
}

export async function cancelBooking(id) {
  await init();
  if (mode === 'demo') return delay(tx((s) => { const b = s.bookings.find((x) => x.id === id); if (b.status !== 'requested') throw new Error('Only unconfirmed bookings can be cancelled'); b.status = 'cancelled'; return b; }));
  const { data, error } = await sb.from('rental_bookings').update({ status: 'cancelled' }).eq('id', id).select().single();
  fail(error); return data;
}

/* =====================================================================
   WAITLIST (public)
   ===================================================================== */
export async function joinWaitlist({ email, postal_code, source = 'website' }) {
  await init();
  if (mode === 'demo') return delay(tx((s) => { s.waitlist.push({ id: uid(), email, postal_code, source, created_at: nowIso() }); }));
  const { error } = await sb.from('waitlist').insert({ email, postal_code, source });
  fail(error);
}

/* =====================================================================
   BILLING — Stripe Checkout + Customer Portal through Netlify functions
   ===================================================================== */
async function callFn(name, body) {
  const { data } = await sb.auth.getSession();
  const r = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify(body || {}),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || 'Billing is not available right now');
  return json;
}
export const billingEnabled = () => mode === 'live' && !!cfg.stripeEnabled;
export async function startPlanCheckout(plan, quantity = 1) {
  await init();
  if (!billingEnabled()) throw new Error('Billing goes live once Stripe keys are added — see the README.');
  const { url } = await callFn('checkout', { kind: 'plan', plan, quantity });
  location.href = url;
}
export async function startRentalCheckout(booking_id) {
  await init();
  if (!billingEnabled()) throw new Error('Card payment goes live once Stripe keys are added. Your booking is saved.');
  const { url } = await callFn('checkout', { kind: 'rental', booking_id });
  location.href = url;
}
export async function openBillingPortal() {
  await init();
  if (!billingEnabled()) throw new Error('The billing portal goes live once Stripe keys are added — see the README.');
  const { url } = await callFn('billing-portal');
  location.href = url;
}

/* =====================================================================
   ADMIN (staff only — enforced by row level security in live mode)
   ===================================================================== */
export async function adminData() {
  await init();
  if (mode === 'demo') {
    return delay(tx((s) => ({ profiles: Object.values(s.profiles), bins: s.bins, requests: s.requests, bookings: s.bookings, items: s.items, waitlist: s.waitlist })));
  }
  const [p, b, r, k, i, w] = await Promise.all([
    sb.from('profiles').select('*').order('created_at', { ascending: false }),
    sb.from('bins').select('*').order('code'),
    sb.from('requests').select('*').order('scheduled_date'),
    sb.from('rental_bookings').select('*').order('start_date'),
    sb.from('rental_items').select('*').order('sort'),
    sb.from('waitlist').select('*').order('created_at', { ascending: false }),
  ]);
  [p, b, r, k, i, w].forEach((x) => fail(x.error));
  return { profiles: p.data, bins: b.data, requests: r.data, bookings: k.data, items: i.data, waitlist: w.data };
}

export async function adminSetRequestStatus(id, status) {
  await init();
  if (mode === 'demo') return delay(tx((s) => { const r = s.requests.find((x) => x.id === id); demoAdvance(s, r, status); return r; }));
  const { data, error } = await sb.from('requests').update({ status }).eq('id', id).select().single();
  fail(error); return data;
}

export async function adminSetBookingStatus(id, status) {
  await init();
  if (mode === 'demo') return delay(tx((s) => { const b = s.bookings.find((x) => x.id === id); b.status = status; return b; }));
  const { data, error } = await sb.from('rental_bookings').update({ status }).eq('id', id).select().single();
  fail(error); return data;
}

export async function adminUpdateBin(id, patch) {
  await init();
  if (mode === 'demo') return delay(tx((s) => { const b = s.bins.find((x) => x.id === id); Object.assign(b, patch, { updated_at: nowIso() }); return b; }));
  const { data, error } = await sb.from('bins').update(patch).eq('id', id).select().single();
  fail(error); return data;
}

export async function adminUpdateItem(id, patch) {
  await init();
  if (mode === 'demo') return delay(tx((s) => Object.assign(s.items.find((x) => x.id === id), patch)));
  const { data, error } = await sb.from('rental_items').update(patch).eq('id', id).select().single();
  fail(error); return data;
}
