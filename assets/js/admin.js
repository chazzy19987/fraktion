// Ops board: the daily run sheet, customers, bins, rentals and waitlist.
import { icon, esc, money, fmtDate, fmtRelative, isoDate, toast, confirmModal, setBusy, WINDOWS, BIN_STATUS, REQ_STATUS, REQ_TYPE } from './ui.js?v=4';
import * as api from './api.js?v=4';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = $('#root');
let D = null;               // all admin data
let showDone = false;
const OPEN = ['requested', 'scheduled', 'en_route'];
const NEXT = { requested: ['scheduled', 'Confirm'], scheduled: ['en_route', 'Start trip'], en_route: ['completed', 'Mark done'] };
const WIN_ORDER = { morning: 0, afternoon: 1, evening: 2 };

(async () => {
  const { mode } = await api.init();
  if (mode === 'demo') {
    $('#demo-banner').innerHTML = `<div class="demo-banner"><span>Demo ops board — try confirming a request, then check the <a href="app.html" style="color:inherit">customer dashboard</a>.</span><button id="reset-demo">Reset demo</button></div>`;
    $('#reset-demo').onclick = () => { api.resetDemo(); location.reload(); };
    if (!(await api.getUser())) await api.signIn({});
  }
  if (!(await api.getUser())) { location.replace('auth.html'); return; }
  const me = await api.getProfile();
  if (!me.is_admin) {
    root.innerHTML = `<div class="loading"><div class="empty"><h3>Staff only</h3><p>This page is for the Fraktion team.</p><a class="btn btn-dark" href="app.html">Go to my bins</a></div></div>`;
    return;
  }
  await load();
  window.addEventListener('hashchange', render);
  render();
})().catch((err) => { root.innerHTML = `<div class="loading"><div class="empty"><h3>Couldn't load the ops board</h3><p>${esc(err.message)}</p></div></div>`; });

async function load() { D = await api.adminData(); }
async function reload() { await load(); render(); }

const route = () => location.hash.slice(1) || 'queue';
const person = (id) => D.profiles.find((p) => p.id === id) || { full_name: 'Unknown' };
const addr = (p) => [p.address_line1, p.address_line2, p.city, p.postal_code].filter(Boolean).join(', ');
const bin = (id) => D.bins.find((b) => b.id === id);
const item = (id) => D.items.find((i) => i.id === id) || { name: 'Rental', emoji: '📦' };

function shell(title, sub, body) {
  const r = route();
  const openCount = D.requests.filter((x) => OPEN.includes(x.status)).length + D.bookings.filter((x) => OPEN.includes(x.status)).length;
  const nav = [['queue', 'Run sheet', 'truck', openCount], ['customers', 'Customers', 'users', D.profiles.length], ['bins', 'Bins', 'box', D.bins.length], ['rentals', 'Rentals', 'table', ''], ['waitlist', 'Waitlist', 'mail', D.waitlist.length]];
  return `<div class="shell">
    <aside class="sidebar">
      <a class="logo" href="index.html"><span class="logo-mark">${icon.logo}</span>Fraktion</a>
      <span class="admin-tag">OPS BOARD</span>
      <nav class="nav">${nav.map(([k, l, ic, c]) => `<a href="#${k}" class="${r === k ? 'active' : ''}">${icon[ic]}${l}${c ? `<span class="count">${c}</span>` : ''}</a>`).join('')}</nav>
      <nav class="nav" style="margin-top:auto"><a href="app.html">${icon.home}Customer view</a></nav>
    </aside>
    <div class="main">
      <header class="topbar"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
        <div class="topbar-actions"><button class="btn btn-ghost btn-sm" id="refresh">Refresh</button></div></header>
      <div class="content">${body}</div>
    </div>
    <nav class="mobile-nav">${nav.map(([k, l, ic]) => `<a href="#${k}" class="${r === k ? 'active' : ''}">${icon[ic]}${l.split(' ')[0]}</a>`).join('')}</nav>
  </div>`;
}

function render() {
  const r = route();
  ({ queue, customers, bins: binsView, rentals, waitlist }[r] || queue)();
  $('#refresh')?.addEventListener('click', reload);
}

/* ----------------------------------------------------------- run sheet */
function queue() {
  const today = isoDate(new Date());
  // Turn requests and rental bookings into "stops" on a date.
  const stops = [
    ...D.requests.map((r) => ({ kind: 'req', id: r.id, date: r.scheduled_date, win: r.time_window, status: r.status, r })),
    ...D.bookings.map((b) => ({ kind: 'drop', id: b.id, date: b.start_date, win: b.time_window, status: b.status, b })),
    ...D.bookings.filter((b) => b.status !== 'cancelled').map((b) => ({ kind: 'collect', id: b.id, date: b.end_date, win: 'evening', status: b.status === 'completed' ? 'completed' : 'scheduled', b })),
  ].filter((s) => showDone ? s.status !== 'cancelled' : OPEN.includes(s.status) || (s.status === 'completed' && s.date >= today && s.kind !== 'collect'))
    .sort((a, b) => a.date.localeCompare(b.date) || WIN_ORDER[a.win] - WIN_ORDER[b.win]);

  const byDay = stops.reduce((m, s) => ((m[s.date] ||= []).push(s), m), {});
  const stats = [
    [D.requests.filter((x) => x.status === 'requested').length + D.bookings.filter((x) => x.status === 'requested').length, 'Need confirming'],
    [stops.filter((s) => s.date === today && OPEN.includes(s.status)).length, 'Stops today'],
    [D.bins.filter((b) => b.status === 'stored').length, 'Bins in storage'],
    [D.profiles.length, 'Customers'],
    [D.waitlist.length, 'On the waitlist'],
  ];

  let body = `<div class="stats5">${stats.map(([n, l]) => `<div class="card stat"><div class="stat-num">${n}</div><div class="stat-label">${l}</div></div>`).join('')}</div>
  <div class="section-head"><h2>Run sheet</h2><label class="hint" style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="show-done" ${showDone ? 'checked' : ''}> Show completed</label></div>`;

  if (!stops.length) body += `<div class="empty"><h3>All clear</h3><p>No open requests. New deliveries, pickups and drop-offs land here.</p></div>`;
  for (const [day, list] of Object.entries(byDay)) {
    const label = day === today ? 'Today' : day < today ? 'Overdue · ' + fmtDate(day) : fmtDate(day, { weekday: 'long', month: 'short', day: 'numeric' });
    body += `<div class="day-head"><h3 style="${day < today ? 'color:var(--red)' : ''}">${label}</h3><span class="hint">${list.length} stop${list.length === 1 ? '' : 's'}</span></div>`;
    body += list.map(stopCard).join('');
  }
  root.innerHTML = shell('Run sheet', 'Every drop-off and pickup, by day', body);
  $('#show-done').addEventListener('change', (e) => { showDone = e.target.checked; render(); });
  $$('[data-status]').forEach((b) => b.addEventListener('click', onStatus));
}

function stopCard(s) {
  const done = s.status === 'completed';
  if (s.kind === 'req') {
    const r = s.r, p = person(r.customer_id);
    const bins = r.bin_ids.map(bin).filter(Boolean);
    const what = r.type === 'new_bins'
      ? `<b>Drop off ${r.quantity} empty bin${r.quantity === 1 ? '' : 's'}</b>`
      : `<b>${r.type === 'delivery' ? 'Deliver from warehouse' : 'Collect to warehouse'} · ${bins.length} bin${bins.length === 1 ? '' : 's'}</b>
         <div class="bins">${bins.map((b) => `<span title="${esc(b.label)}">${esc(b.code)}${r.type === 'delivery' && b.location ? ` @ ${esc(b.location)}` : ''}</span>`).join('')}</div>`;
    const next = NEXT[r.status];
    return `<div class="stop ${done ? 'is-done' : ''}">
      <div class="win">${WINDOWS[r.time_window].label}<small>${WINDOWS[r.time_window].time}</small></div>
      <div class="who"><b>${esc(p.full_name)}</b><span>${esc(r.address || addr(p))}</span>${p.phone ? `<span><a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></span>` : ''}</div>
      <div class="what"><span><span class="pill pill-plain" style="margin-right:6px">${icon[REQ_TYPE[r.type].icon].replace('<svg', '<svg style="width:14px;height:14px"')} ${REQ_TYPE[r.type].label}</span></span>${what}
        ${r.notes ? `<span class="note">“${esc(r.notes)}”</span>` : ''}${p.access_notes ? `<span class="note" style="background:var(--paper)">Access: ${esc(p.access_notes)}</span>` : ''}
        ${r.fee_cents ? `<span class="hint">Charge ${money(r.fee_cents)} delivery fee</span>` : ''}</div>
      <div class="acts"><span class="pill ${REQ_STATUS[r.status].cls}">${REQ_STATUS[r.status].label}</span>
        ${next ? `<div class="row"><button class="btn btn-dark btn-sm" data-status="${next[0]}" data-kind="req" data-id="${r.id}">${next[1]}</button>
        ${r.status !== 'en_route' ? `<button class="btn btn-ghost btn-sm" data-status="cancelled" data-kind="req" data-id="${r.id}">Cancel</button>` : ''}</div>` : ''}</div>
    </div>`;
  }
  const b = s.b, p = person(b.customer_id), it = item(b.item_id);
  const isDrop = s.kind === 'drop';
  const next = isDrop ? NEXT[b.status] : null;
  return `<div class="stop ${done ? 'is-done' : ''}">
    <div class="win">${isDrop ? WINDOWS[b.time_window].label : 'Collect'}<small>${isDrop ? WINDOWS[b.time_window].time : 'End of rental'}</small></div>
    <div class="who"><b>${esc(p.full_name)}</b><span>${esc(b.address || addr(p))}</span>${p.phone ? `<span><a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></span>` : ''}</div>
    <div class="what"><span class="pill pill-plain" style="justify-self:start">${icon.table.replace('<svg', '<svg style="width:14px;height:14px"')} Rental ${isDrop ? 'drop-off' : 'collection'}</span>
      <b>${esc(it.emoji)} ${esc(it.name)} × ${b.quantity}</b><span class="hint">${fmtDate(b.start_date)} → ${fmtDate(b.end_date)} · ${money(b.total_cents)} · ${b.paid ? 'Paid' : 'Unpaid'}</span>
      ${b.notes ? `<span class="note">“${esc(b.notes)}”</span>` : ''}</div>
    <div class="acts"><span class="pill ${REQ_STATUS[s.status].cls}">${isDrop ? REQ_STATUS[b.status].label : 'To collect'}</span>
      ${next ? `<div class="row"><button class="btn btn-dark btn-sm" data-status="${next[0]}" data-kind="book" data-id="${b.id}">${next[1]}</button>${b.status === 'requested' ? `<button class="btn btn-ghost btn-sm" data-status="cancelled" data-kind="book" data-id="${b.id}">Cancel</button>` : ''}</div>` : ''}
      ${!isDrop && b.status === 'en_route' ? '' : ''}</div>
  </div>`;
}

async function onStatus(e) {
  const btn = e.currentTarget;
  const { status, kind, id } = btn.dataset;
  if (status === 'cancelled' && !(await confirmModal('Cancel this?', 'The customer will see it as cancelled, and any delivery credit is returned.', 'Cancel it', true))) return;
  setBusy(btn, true, '…');
  try {
    if (kind === 'req') await api.adminSetRequestStatus(id, status);
    else await api.adminSetBookingStatus(id, status);
    toast(`Marked <b>${REQ_STATUS[status].label.toLowerCase()}</b>.`);
    await reload();
  } catch (err) { setBusy(btn, false); toast(esc(err.message)); }
}

/* ------------------------------------------------------------ customers */
function customers() {
  const rows = D.profiles.map((p) => {
    const bins = D.bins.filter((b) => b.owner_id === p.id);
    return `<tr>
      <td><b>${esc(p.full_name || '—')}</b>${p.is_admin ? ' <span class="pill pill-plain pill-yellow" style="font-size:10px">staff</span>' : ''}<div class="hint">${esc(p.email)}</div></td>
      <td>${p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : '—'}</td>
      <td>${esc(addr(p) || '—')}</td>
      <td>${esc(api.PLANS[p.plan]?.name || p.plan)}<div class="hint">${esc(p.subscription_status)}</div></td>
      <td class="mono">${bins.filter((b) => b.status === 'stored').length} / ${bins.length}</td>
      <td class="mono">${p.delivery_credits === null ? '∞' : p.delivery_credits}</td>
      <td class="hint">${fmtRelative(p.created_at)}</td>
    </tr>`;
  }).join('');
  root.innerHTML = shell('Customers', `${D.profiles.length} accounts`, `<div class="table-wrap"><table class="table">
    <thead><tr><th>Customer</th><th>Phone</th><th>Address</th><th>Plan</th><th>Stored / bins</th><th>Credits</th><th>Joined</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">No customers yet.</td></tr>'}</tbody></table></div>`);
}

/* ----------------------------------------------------------------- bins */
function binsView() {
  const rows = [...D.bins].sort((a, b) => a.code.localeCompare(b.code)).map((b) => `<tr>
    <td class="mono"><b>${esc(b.code)}</b>${b.kind === 'oversized' ? '<div class="hint">oversized</div>' : ''}</td>
    <td>${esc(b.emoji)} ${esc(b.label)}</td>
    <td>${esc(person(b.owner_id).full_name)}</td>
    <td><span class="pill ${BIN_STATUS[b.status].cls}">${BIN_STATUS[b.status].label}</span></td>
    <td style="min-width:120px"><input class="input tbl-input mono" data-loc="${b.id}" value="${esc(b.location || '')}" placeholder="e.g. A-03-2" aria-label="Shelf location for ${esc(b.code)}"></td>
  </tr>`).join('');
  root.innerHTML = shell('Bins', 'Shelf locations save when you leave the field', `<div class="table-wrap"><table class="table">
    <thead><tr><th>Code</th><th>Label</th><th>Owner</th><th>Status</th><th>Shelf</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No bins yet — they\'re created when you complete a bin drop-off.</td></tr>'}</tbody></table></div>`);
  $$('[data-loc]').forEach((inp) => inp.addEventListener('change', async () => {
    try { await api.adminUpdateBin(inp.dataset.loc, { location: inp.value.trim().toUpperCase() || null }); inp.value = inp.value.trim().toUpperCase(); toast('Shelf saved.'); await load(); }
    catch (err) { toast(esc(err.message)); }
  }));
}

/* -------------------------------------------------------------- rentals */
function rentals() {
  const items = D.items.map((it) => `<tr>
    <td>${esc(it.emoji)} <b>${esc(it.name)}</b></td>
    <td style="width:130px"><input class="input tbl-input" type="number" min="0" step="0.5" data-item="${it.id}" data-field="price" value="${(it.price_cents_per_day / 100).toFixed(2)}" aria-label="Price per day"></td>
    <td style="width:110px"><input class="input tbl-input" type="number" min="0" data-item="${it.id}" data-field="qty" value="${it.quantity_total}" aria-label="Units owned"></td>
    <td><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-item="${it.id}" data-field="active" ${it.active ? 'checked' : ''}> ${it.active ? 'Bookable' : 'Coming soon'}</label></td>
  </tr>`).join('');
  const bookings = [...D.bookings].sort((a, b) => b.start_date.localeCompare(a.start_date)).map((b) => `<tr>
    <td>${esc(item(b.item_id).name)} × ${b.quantity}</td><td>${esc(person(b.customer_id).full_name)}</td>
    <td>${fmtDate(b.start_date)} → ${fmtDate(b.end_date)}</td><td>${money(b.total_cents)} · ${b.paid ? 'paid' : 'unpaid'}</td>
    <td><span class="pill ${REQ_STATUS[b.status].cls}">${REQ_STATUS[b.status].label}</span></td></tr>`).join('');
  root.innerHTML = shell('Rentals', 'Catalogue and bookings', `
    <div class="section-head" style="margin-top:0"><h2>Catalogue</h2><span class="hint">Changes save as you edit. Tick "bookable" once you own the units.</span></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th>$ / day</th><th>Units owned</th><th>Status</th></tr></thead><tbody>${items}</tbody></table></div>
    <div class="section-head"><h2>Bookings</h2></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th>Customer</th><th>Dates</th><th>Total</th><th>Status</th></tr></thead><tbody>${bookings || '<tr><td colspan="5">No bookings yet.</td></tr>'}</tbody></table></div>`);
  $$('[data-item]').forEach((inp) => inp.addEventListener('change', async () => {
    const f = inp.dataset.field;
    const patch = f === 'price' ? { price_cents_per_day: Math.round(parseFloat(inp.value || '0') * 100) } : f === 'qty' ? { quantity_total: parseInt(inp.value || '0', 10) } : { active: inp.checked };
    try { await api.adminUpdateItem(inp.dataset.item, patch); toast('Catalogue updated.'); await reload(); } catch (err) { toast(esc(err.message)); }
  }));
}

/* ------------------------------------------------------------- waitlist */
function waitlist() {
  const rows = D.waitlist.map((w) => `<tr><td>${esc(w.email)}</td><td class="mono">${esc(w.postal_code || '')}</td><td class="hint">${fmtRelative(w.created_at)}</td></tr>`).join('');
  root.innerHTML = shell('Waitlist', 'Founding-member sign-ups from the website', `
    <div class="toolbar" style="margin-bottom:14px"><button class="btn btn-dark btn-sm" id="copy" ${D.waitlist.length ? '' : 'disabled'}>${icon.mail}Copy all emails</button></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Email</th><th>Postal code</th><th>Joined</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No sign-ups yet. Share the site and drop some door hangers!</td></tr>'}</tbody></table></div>`);
  $('#copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(D.waitlist.map((w) => w.email).join(', ')); toast(`Copied ${D.waitlist.length} emails.`); } catch { toast('Couldn\'t copy — select the table instead.'); }
  });
}
