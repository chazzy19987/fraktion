// Customer dashboard: bins, requests, rentals and account.
import {
  icon, esc, money, fmtDate, fmtRelative, isoDate, serviceDays, toast, modal, confirmModal, setBusy,
  dateStrip, windowChoices, WINDOWS, BIN_STATUS, REQ_STATUS, REQ_TYPE, EMOJIS,
} from './ui.js?v=6';
import * as api from './api.js?v=6';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = $('#root');

const state = {
  profile: null, bins: [], requests: [], items: [], bookings: [],
  filter: 'all', search: '', tag: '', selected: new Set(),
};
const OPEN = ['requested', 'scheduled', 'en_route'];

/* ------------------------------------------------------------------ boot */
(async () => {
  const { mode } = await api.init();
  if (mode === 'demo') {
    $('#demo-banner').innerHTML = `<div class="demo-banner"><span>Demo mode — sample data lives in this browser. Requests you make here show up on the <a href="admin.html" style="color:inherit">ops board</a>.</span><button id="reset-demo">Reset demo</button></div>`;
    $('#reset-demo').onclick = () => { api.resetDemo(); location.reload(); };
    if (!(await api.getUser())) await api.signIn({}); // demo visitors go straight in
  }
  if (!(await api.getUser())) { location.replace('auth.html'); return; }
  api.onAuthChange((event) => { if (event === 'SIGNED_OUT') location.replace('auth.html'); });
  await loadAll();
  window.addEventListener('hashchange', render);
  render();
  const params = new URLSearchParams(location.search);
  if (params.get('welcome') || !hasAddress()) { history.replaceState(null, '', location.pathname + location.hash); welcomeFlow(); }
  if (params.get('checkout') === 'success') { history.replaceState(null, '', location.pathname + location.hash); toast('<b>Payment received.</b> Thanks — you\'re all set.'); }
})().catch((err) => {
  root.innerHTML = `<div class="loading"><div class="empty"><h3>We couldn't load your dashboard</h3><p>${esc(err.message)}</p><a class="btn btn-dark" href="auth.html">Back to log in</a></div></div>`;
});

async function loadAll() {
  const [profile, bins, requests, items, bookings] = await Promise.all([
    api.getProfile(), api.listBins(), api.listRequests(), api.listRentalItems(), api.listBookings(),
  ]);
  Object.assign(state, { profile, bins, requests, items, bookings });
  const ids = new Set(bins.map((b) => b.id));
  state.selected.forEach((id) => { if (!ids.has(id)) state.selected.delete(id); });
}
async function refresh() { await loadAll(); render(); }

/* --------------------------------------------------------------- helpers */
const route = () => (location.hash.slice(1) || 'bins').split('?')[0];
const plan = () => api.PLANS[state.profile.plan] || api.PLANS.standard;
const PR = api.PRICING;
const binCount = () => state.bins.filter((b) => b.kind === 'bin').length;
const monthlyCents = () => Math.max(binCount(), PR.minBins) * PR.binCents + state.bins.filter((b) => b.kind === 'oversized').length * api.OVERSIZED_CENTS;
const firstName = () => (state.profile.full_name || '').split(' ')[0] || 'there';
const binById = (id) => state.bins.find((b) => b.id === id);
const openRequests = () => state.requests.filter((r) => OPEN.includes(r.status));
const address = () => [state.profile.address_line1, state.profile.address_line2, state.profile.city, state.profile.postal_code].filter(Boolean).join(', ');
const hasAddress = () => !!(state.profile.address_line1 && state.profile.city);
/** The open request a bin is part of, if any. */
const pendingFor = (binId) => openRequests().find((r) => r.bin_ids.includes(binId));
const creditsLabel = () => state.profile.delivery_credits === null ? 'Unlimited' : String(state.profile.delivery_credits);
const reqTitle = (r) => {
  if (r.type === 'new_bins') return `${REQ_TYPE.new_bins.label} · ${r.quantity}`;
  return `${REQ_TYPE[r.type].label} · ${r.bin_ids.length} bin${r.bin_ids.length === 1 ? '' : 's'}`;
};
const when = (r) => `${fmtDate(r.scheduled_date || r.start_date)} · ${WINDOWS[r.time_window]?.time || ''}`;

function trackerHtml(r) {
  const labels = ['Requested', 'Scheduled', r.type === 'pickup' ? 'Picking up' : 'On the way', r.type === 'pickup' ? 'In storage' : 'Delivered'];
  const idx = { requested: 0, scheduled: 1, en_route: 2, completed: 4 }[r.status] ?? 0;
  return `<div class="tracker">${labels.map((l, i) => `<div class="tracker-step ${i < idx ? 'done' : i === idx ? 'current' : ''}">${l}</div>`).join('')}</div>`;
}

/* ----------------------------------------------------------------- shell */
function shell(title, sub, actions, body) {
  const r = route();
  const nav = [
    ['bins', 'My bins', 'box', state.bins.length],
    ['requests', 'Requests', 'truck', openRequests().length + state.bookings.filter((b) => OPEN.includes(b.status)).length || ''],
    ['rentals', 'Rentals', 'table', ''],
    ['account', 'Account', 'user', ''],
  ];
  const p = plan();
  const total = p.credits;
  const left = state.profile.delivery_credits;
  return `
  <div class="shell">
    <aside class="sidebar">
      <a class="logo" href="index.html"><span class="logo-mark">${icon.logo}</span>Fraktion</a>
      <nav class="nav" aria-label="Dashboard">
        ${nav.map(([k, l, ic, c]) => `<a href="#${k}" class="${r === k ? 'active' : ''}" ${r === k ? 'aria-current="page"' : ''}>${icon[ic]}${l}${c ? `<span class="count">${c}</span>` : ''}</a>`).join('')}
        ${state.profile.is_admin ? `<a href="admin.html">${icon.warehouse}Ops board</a>` : ''}
      </nav>
      <div class="plan-card">
        <span class="eyebrow">${Math.max(binCount(), PR.minBins)} bins · ${PR.name}</span>
        <h4>${money(monthlyCents())}<small style="font-size:13px;color:var(--muted-light);font-weight:500"> / month</small></h4>
        ${total === null ? `<div class="meter"><i style="width:100%"></i></div><small>Unlimited deliveries</small>`
          : `<div class="meter"><i style="width:${Math.max(0, Math.min(100, (left / total) * 100))}%"></i></div><small>${left} of ${total} free deliveries left this year</small>`}
        <a href="#account" class="btn btn-ghost-dark btn-sm btn-block" style="margin-top:14px">Manage plan</a>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
        <div class="topbar-actions">${actions || ''}</div>
      </header>
      <div class="content">${body}</div>
    </div>
    <nav class="mobile-nav" aria-label="Dashboard">
      ${nav.map(([k, l, ic]) => `<a href="#${k}" class="${r === k ? 'active' : ''}">${icon[ic]}${l}</a>`).join('')}
    </nav>
  </div>
  <div id="select-bar"></div>`;
}

function render() {
  const r = route();
  const view = { bins: viewBins, requests: viewRequests, rentals: viewRentals, account: viewAccount }[r] || viewBins;
  document.title = `${{ bins: 'My bins', requests: 'Requests', rentals: 'Rentals', account: 'Account' }[r] || 'My bins'} — Fraktion`;
  view();
  bindCommon();
}

function bindCommon() {
  $$('[data-act]').forEach((el) => el.addEventListener('click', onAction));
}

async function onAction(e) {
  const el = e.currentTarget;
  const { act, id } = el.dataset;
  e.preventDefault();
  if (act === 'edit') return editBin(binById(id));
  if (act === 'deliver') return requestModal('delivery', [id]);
  if (act === 'pickup') return requestModal('pickup', [id]);
  if (act === 'deliver-many') return requestModal('delivery', [...state.selected].filter((x) => binById(x)?.status === 'stored'));
  if (act === 'pickup-many') return requestModal('pickup', [...state.selected].filter((x) => binById(x)?.status === 'with_customer'));
  if (act === 'request-delivery') return requestModal('delivery', []);
  if (act === 'request-pickup') return requestModal('pickup', []);
  if (act === 'add-bins') return addBinsModal();
  if (act === 'clear-select') { state.selected.clear(); return render(); }
  if (act === 'cancel-req') {
    if (!(await confirmModal('Cancel this request?', 'If it used a delivery credit, we\'ll put it back.', 'Cancel request', true))) return;
    try { await api.cancelRequest(id); toast('Request cancelled.'); await refresh(); } catch (err) { toast(esc(err.message)); }
  }
  if (act === 'cancel-booking') {
    if (!(await confirmModal('Cancel this booking?', 'We\'ll release the items for those dates.', 'Cancel booking', true))) return;
    try { await api.cancelBooking(id); toast('Booking cancelled.'); await refresh(); } catch (err) { toast(esc(err.message)); }
  }
  if (act === 'pay-booking') { try { await api.startRentalCheckout(id); } catch (err) { toast(esc(err.message)); } }
  if (act === 'rent') return rentalModal(state.items.find((i) => i.id === id));
  if (act === 'billing') { setBusy(el, true); try { await api.openBillingPortal(); } catch (err) { setBusy(el, false); toast(esc(err.message)); } }
  if (act === 'change-plan') return planModal();
  if (act === 'signout') { await api.signOut(); location.href = 'index.html'; }
}

/* ============================================================ BINS VIEW */
function viewBins() {
  const bins = state.bins;
  const stored = bins.filter((b) => b.status === 'stored').length;
  const home = bins.filter((b) => b.status === 'with_customer').length;
  const nextReq = openRequests().sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))[0];
  const tags = [...new Set(bins.flatMap((b) => b.tags))].sort();

  const q = state.search.trim().toLowerCase();
  const visible = bins.filter((b) => {
    if (state.filter === 'stored' && b.status !== 'stored') return false;
    if (state.filter === 'home' && b.status !== 'with_customer') return false;
    if (state.filter === 'moving' && !['out_for_delivery', 'to_warehouse'].includes(b.status) && !pendingFor(b.id)) return false;
    if (state.tag && !b.tags.includes(state.tag)) return false;
    if (q && ![b.label, b.code, b.contents, b.tags.join(' ')].join(' ').toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => a.code.localeCompare(b.code));

  const actions = `
    <button class="btn btn-ghost" data-act="add-bins" aria-label="Add bins">${icon.plus}<span class="btn-label">Add bins</span></button>
    <button class="btn btn-primary" data-act="request-delivery" aria-label="Request delivery">${icon.truck}<span class="btn-label">Request delivery</span></button>`;

  const active = openRequests().sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  let body = '';

  if (!bins.length && !active.length) {
    body += `<div class="welcome-hero">
      <div><h2>Let's get your first bins to you, ${esc(firstName())}.</h2><p>Pick how many and when. We'll drop off empty bins, you fill them, then book a pickup.</p></div>
      <button class="btn btn-primary btn-lg" data-act="add-bins">${icon.box}Book my bin drop-off</button>
    </div>`;
  }

  body += `<div class="stats">
    <div class="card stat"><div class="stat-num">${stored}</div><div class="stat-label">In storage</div></div>
    <div class="card stat"><div class="stat-num">${home}</div><div class="stat-label">With you</div></div>
    <div class="card stat"><div class="stat-num">${creditsLabel()}</div><div class="stat-label">Free deliveries left</div></div>
    <div class="card stat"><div class="stat-num" style="font-size:20px;padding-top:8px">${nextReq ? fmtDate(nextReq.scheduled_date) : '—'}</div><div class="stat-label">${nextReq ? `Next visit · ${WINDOWS[nextReq.time_window].time}` : 'No visits booked'}</div></div>
  </div>`;

  if (active.length) {
    body += `<div class="section-head"><h2>On the schedule</h2><a href="#requests" class="hint" style="font-weight:600;color:var(--text)">All requests →</a></div>`;
    body += active.slice(0, 3).map((r) => `
      <div class="card active-req">
        <div class="req-head">
          <div><div class="row-title">${reqTitle(r)}</div><div class="row-meta">${when(r)} · ${esc(r.address || address())}</div></div>
          <div class="bin-actions"><span class="pill ${REQ_STATUS[r.status].cls}">${REQ_STATUS[r.status].label}</span>
          ${r.status === 'requested' ? `<button class="btn btn-ghost btn-sm" data-act="cancel-req" data-id="${r.id}">Cancel</button>` : ''}</div>
        </div>
        ${r.bin_ids.length ? `<div class="req-bins">${r.bin_ids.map((id) => binById(id)).filter(Boolean).map((b) => `<span>${b.emoji} ${esc(b.label)}</span>`).join('')}</div>` : ''}
        ${trackerHtml(r)}
      </div>`).join('');
  }

  body += `<div class="section-head"><h2>Your bins</h2>
    <div class="toolbar">
      <div class="search">${icon.search}<input class="input" id="bin-search" type="search" placeholder="Search labels, contents, tags…" value="${esc(state.search)}" aria-label="Search bins"></div>
      ${tags.length ? `<select class="select" id="tag-filter" aria-label="Filter by tag" style="width:auto;min-height:40px"><option value="">All tags</option>${tags.map((t) => `<option ${t === state.tag ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
    </div>
  </div>
  <div class="chips" role="group" aria-label="Filter bins" style="margin-bottom:16px">
    ${[['all', `All · ${bins.length}`], ['stored', `In storage · ${stored}`], ['home', `With you · ${home}`], ['moving', 'On the move']].map(([k, l]) => `<button class="chip" data-filter="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join('')}
  </div>`;

  if (!bins.length) {
    body += `<div class="empty"><h3>No bins yet</h3><p>Your bins appear here once we drop them off. Each one gets a serial number you can label.</p><button class="btn btn-dark" data-act="add-bins">${icon.plus}Get bins</button></div>`;
  } else if (!visible.length) {
    body += `<div class="empty"><h3>Nothing matches</h3><p>Try a different search or filter.</p></div>`;
  } else {
    body += `<div class="bin-grid">${visible.map(binCard).join('')}</div>`;
  }

  root.innerHTML = shell(`Hi, ${esc(firstName())}`, `${bins.length} bin${bins.length === 1 ? '' : 's'} · ${money(monthlyCents())}/month`, actions, body);

  $('#bin-search')?.addEventListener('input', (e) => {
    state.search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = $('#bin-search'); el.focus(); el.setSelectionRange(pos, pos);
  });
  $('#tag-filter')?.addEventListener('change', (e) => { state.tag = e.target.value; render(); });
  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; render(); }));
  $$('[data-select]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.select;
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    render();
  }));
  renderSelectBar();
}

function binCard(b) {
  const pend = pendingFor(b.id);
  const st = BIN_STATUS[b.status];
  let statusPill = `<span class="pill ${st.cls}">${st.label}</span>`;
  if (pend && pend.status !== 'en_route') statusPill = `<span class="pill pill-pending">${pend.type === 'delivery' ? 'Delivery' : 'Pickup'} booked · ${fmtDate(pend.scheduled_date, { weekday: 'short' })}</span>`;
  const selectable = !pend && ['stored', 'with_customer'].includes(b.status);
  const sel = state.selected.has(b.id);
  let primary = '';
  if (!pend && b.status === 'stored') primary = `<button class="btn btn-dark btn-sm" data-act="deliver" data-id="${b.id}">${icon.truck}Deliver to me</button>`;
  if (!pend && b.status === 'with_customer') primary = `<button class="btn btn-ghost btn-sm" data-act="pickup" data-id="${b.id}">${icon.arrowUp}Send to storage</button>`;
  const contents = b.contents.split('\n').map((x) => x.trim()).filter(Boolean);
  return `<article class="bin-card ${sel ? 'is-selected' : ''}">
    <div class="bin-lid ${b.kind === 'oversized' ? 'oversized' : ''}"></div>
    ${selectable ? `<button class="bin-select" data-select="${b.id}" aria-pressed="${sel}" aria-label="Select ${esc(b.label)}">${icon.check}</button>` : ''}
    <div class="bin-body">
      <div class="bin-head" style="padding-right:${selectable ? 30 : 0}px">
        <div class="bin-emoji">${esc(b.emoji)}</div>
        <div style="min-width:0"><div class="bin-title">${esc(b.label)}</div><div class="bin-code">${esc(b.code)}${b.kind === 'oversized' ? ' · OVERSIZED' : ''}</div></div>
      </div>
      <div class="bin-contents">${contents.length ? esc(contents.join(' · ')) : '<em>Nothing listed yet — tap edit to add what\'s inside.</em>'}</div>
      ${b.tags.length ? `<div class="bin-tags">${b.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="bin-cta">${primary}<button class="btn btn-ghost btn-sm" data-act="edit" data-id="${b.id}" aria-label="Edit ${esc(b.label)}">${icon.edit}Edit</button></div>
    </div>
    <div class="bin-foot">${statusPill}<span class="bin-barcode" aria-hidden="true"></span></div>
  </article>`;
}

function renderSelectBar() {
  const bar = $('#select-bar');
  if (!state.selected.size) { bar.innerHTML = ''; return; }
  const sel = [...state.selected].map(binById).filter(Boolean);
  const stored = sel.filter((b) => b.status === 'stored').length;
  const home = sel.filter((b) => b.status === 'with_customer').length;
  bar.innerHTML = `<div class="select-bar" role="region" aria-label="Selected bins">
    <span><b>${sel.length}</b> selected</span>
    ${stored ? `<button class="btn btn-primary btn-sm" data-act="deliver-many">${icon.truck}Deliver ${stored}</button>` : ''}
    ${home ? `<button class="btn btn-ghost-dark btn-sm" data-act="pickup-many">${icon.arrowUp}Store ${home}</button>` : ''}
    <button class="icon-btn" style="background:transparent;border-color:var(--ink-line);color:#fff" data-act="clear-select" aria-label="Clear selection">${icon.x}</button>
  </div>`;
  $$('[data-act]', bar).forEach((el) => el.addEventListener('click', onAction));
}

/* ---------------------------------------------------------- edit a bin */
function editBin(b) {
  let tags = [...b.tags];
  const emojis = EMOJIS.includes(b.emoji) ? EMOJIS : [b.emoji, ...EMOJIS];
  modal({
    title: 'Edit bin',
    subtitle: `<span class="mono">${esc(b.code)}</span> · ${BIN_STATUS[b.status].label}`,
    body: `
      <div class="field"><label class="label" for="e-label">Label</label><input class="input" id="e-label" name="label" value="${esc(b.label)}" maxlength="60" required autofocus></div>
      <div class="field"><span class="label">Icon</span><div class="emoji-grid">${emojis.map((e) => `<label><input type="radio" name="emoji" value="${e}" ${e === b.emoji ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div></div>
      <div class="field"><label class="label" for="e-contents">What's inside</label><textarea class="textarea" id="e-contents" name="contents" placeholder="One item per line">${esc(b.contents)}</textarea><span class="hint">One item per line. This is what search looks through.</span></div>
      <div class="field"><label class="label" for="e-tag">Tags</label><div class="tag-input" id="tag-box"><input id="e-tag" placeholder="Add a tag and press Enter" maxlength="20"></div><span class="hint">e.g. holiday, kids, summer</span></div>`,
    actions: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-dark" type="submit">Save bin</button>`,
    onMount: (m) => {
      const box = $('#tag-box', m.el), inp = $('#e-tag', m.el);
      const paint = () => {
        $$('.tag', box).forEach((t) => t.remove());
        inp.insertAdjacentHTML('beforebegin', tags.map((t, i) => `<span class="tag">${esc(t)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(t)}">×</button></span>`).join(''));
        $$('[data-rm]', box).forEach((x) => x.addEventListener('click', () => { tags.splice(+x.dataset.rm, 1); paint(); inp.focus(); }));
      };
      const add = () => { const v = inp.value.trim().toLowerCase().replace(/,/g, ''); if (v && !tags.includes(v) && tags.length < 8) tags.push(v); inp.value = ''; paint(); };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
        if (e.key === 'Backspace' && !inp.value && tags.length) { tags.pop(); paint(); }
      });
      inp.addEventListener('blur', add);
      paint();
      m.onSubmit = async (e) => {
        const btn = e.submitter || $('button[type="submit"]', m.el);
        const fd = new FormData(m.form);
        add();
        setBusy(btn, true, 'Saving…');
        try {
          await api.updateBin(b.id, { label: fd.get('label'), emoji: fd.get('emoji'), contents: fd.get('contents'), tags });
          m.close(); toast(`<b>${esc(fd.get('label'))}</b> saved.`); await refresh();
        } catch (err) { setBusy(btn, false); toast(esc(err.message)); }
      };
    },
  });
}

/* ------------------------------------------- delivery / pickup request */
function requestModal(type, preselected) {
  if (!hasAddress()) { toast('Add your address first so we know where to go.'); location.hash = 'account'; return; }
  const need = type === 'delivery' ? 'stored' : 'with_customer';
  const pool = state.bins.filter((b) => b.status === need && !pendingFor(b.id)).sort((a, b) => a.code.localeCompare(b.code));
  if (!pool.length) {
    toast(type === 'delivery' ? 'No bins in storage right now — book a pickup first.' : 'No bins at your place to send to storage.');
    return;
  }
  const isDelivery = type === 'delivery';
  const p = state.profile;
  const creditLine = () => {
    if (!isDelivery) return 'Pickups are always free.';
    if (p.delivery_credits === null) return 'Included in your plan.';
    if (p.delivery_credits > 0) return `Free — ${p.delivery_credits} of ${PR.deliveriesPerYear} free deliveries left this year.`;
    return `You've used this year's ${PR.deliveriesPerYear} free deliveries — this one is ${money(api.EXTRA_DELIVERY_CENTS)}.`;
  };
  modal({
    title: isDelivery ? 'Bring bins to me' : 'Send bins to storage',
    subtitle: isDelivery ? 'Pick the bins, then a day and time window.' : 'We\'ll collect them from your door.',
    body: `
      <div class="field"><span class="label">Bins</span>
        <div class="pick-list">${pool.map((b) => `<label class="pick"><input type="checkbox" name="bins" value="${b.id}" ${preselected.includes(b.id) || pool.length === 1 ? 'checked' : ''}><span class="bin-emoji">${esc(b.emoji)}</span><span style="flex:1;min-width:0"><b style="display:block;font-size:14px">${esc(b.label)}</b><span class="mono hint">${esc(b.code)}</span></span></label>`).join('')}</div>
      </div>
      <div class="field"><span class="label">Day</span>${dateStrip('date', serviceDays(10))}</div>
      <div class="field"><span class="label">Time window</span>${windowChoices('window')}</div>
      <div class="field"><label class="label" for="r-notes">Notes for the driver <span class="hint">(optional)</span></label><input class="input" id="r-notes" name="notes" maxlength="200" placeholder="${isDelivery ? 'e.g. Leave in the garage' : 'e.g. Bins are by the side door'}"></div>
      <div class="addr-box"><span>${icon.pin.replace('<svg', '<svg style="width:16px;height:16px;display:inline;vertical-align:-3px;margin-right:6px"')}${esc(address())}</span><a href="#account" data-close style="font-weight:600;font-size:13px">Change</a></div>
      <div class="modal-summary"><span id="r-count"></span><span>${creditLine()}</span></div>
      <div class="err" style="display:none"></div>`,
    actions: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">${isDelivery ? icon.truck + 'Book delivery' : icon.warehouse + 'Book pickup'}</button>`,
    onMount: (m) => {
      const count = () => { const n = $$('input[name="bins"]:checked', m.el).length; $('#r-count', m.el).innerHTML = `<b>${n}</b> bin${n === 1 ? '' : 's'} selected`; };
      m.el.addEventListener('change', count); count();
      m.onSubmit = async (e) => {
        const fd = new FormData(m.form);
        const bin_ids = fd.getAll('bins');
        if (!bin_ids.length) return toast('Choose at least one bin.');
        const btn = e.submitter || $('button[type="submit"]', m.el);
        setBusy(btn, true, 'Booking…');
        try {
          const r = await api.createRequest({ type, bin_ids, scheduled_date: fd.get('date'), time_window: fd.get('window'), notes: fd.get('notes') });
          m.close();
          state.selected.clear();
          toast(`<b>${isDelivery ? 'Delivery' : 'Pickup'} booked</b> — ${fmtDate(r.scheduled_date, { weekday: 'long', month: 'short', day: 'numeric' })}, ${WINDOWS[r.time_window].time}. We'll confirm the exact time.`);
          await refresh();
        } catch (err) { setBusy(btn, false); toast(esc(err.message)); }
      };
    },
  });
}

/* -------------------------------------------------------- add more bins */
function addBinsModal() {
  if (!hasAddress()) { toast('Add your address first so we know where to drop them off.'); location.hash = 'account'; return; }
  const owned = binCount();
  const coming = openRequests().filter((r) => r.type === 'new_bins').reduce((n, r) => n + r.quantity, 0);
  const minQty = Math.max(1, PR.minBins - owned - coming);
  let qty = owned + coming ? 2 : PR.standardBins;
  qty = Math.max(qty, minQty);
  const priceLine = () => {
    const total = Math.max(owned + coming + qty, PR.minBins);
    return `<span>${qty} × ${money(PR.binCents)}/month + ${money(qty * PR.depositCents)} refundable deposit</span><span>Bins total: <b>${money(total * PR.binCents)}/month</b> for ${total}</span>`;
  };
  modal({
    title: 'Get empty bins',
    subtitle: 'We drop them off, you fill them, then book a pickup.',
    body: `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
        <div><span class="label">How many bins?</span><p class="hint">102 L each, with snap-on lids. ${owned + coming ? '' : `Most homes start with ${PR.standardBins}; the minimum is ${PR.minBins}.`}</p></div>
        <div class="stepper"><button type="button" id="q-minus" aria-label="Fewer">−</button><output id="q-val">${qty}</output><button type="button" id="q-plus" aria-label="More">+</button></div>
      </div>
      <div class="field" style="margin-top:18px"><span class="label">Drop-off day</span>${dateStrip('date', serviceDays(10))}</div>
      <div class="field"><span class="label">Time window</span>${windowChoices('window', 'morning')}</div>
      <div class="field"><label class="label" for="nb-notes">Notes <span class="hint">(optional)</span></label><input class="input" id="nb-notes" name="notes" maxlength="200" placeholder="e.g. Leave on the porch"></div>
      <div class="modal-summary" id="q-price" style="flex-wrap:wrap"></div>`,
    actions: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">${icon.box}Book drop-off</button>`,
    onMount: (m) => {
      const paint = () => { $('#q-val', m.el).textContent = qty; $('#q-price', m.el).innerHTML = priceLine(); };
      $('#q-minus', m.el).onclick = () => { qty = Math.max(minQty, qty - 1); paint(); };
      $('#q-plus', m.el).onclick = () => { qty = Math.min(20, qty + 1); paint(); };
      paint();
      m.onSubmit = async (e) => {
        const fd = new FormData(m.form);
        const btn = e.submitter || $('button[type="submit"]', m.el);
        setBusy(btn, true, 'Booking…');
        try {
          const r = await api.createRequest({ type: 'new_bins', quantity: qty, scheduled_date: fd.get('date'), time_window: fd.get('window'), notes: fd.get('notes') });
          m.close();
          toast(`<b>${qty} bins on the way</b> — ${fmtDate(r.scheduled_date, { weekday: 'long', month: 'short', day: 'numeric' })}, ${WINDOWS[r.time_window].time}.`);
          await refresh();
          // Brand-new customer: start billing (with the founding-member free months) right after their first drop-off.
          if (api.billingEnabled() && state.profile.subscription_status !== 'active') planModal();
        } catch (err) { setBusy(btn, false); toast(esc(err.message)); }
      };
    },
  });
}

/* ======================================================== REQUESTS VIEW */
function viewRequests() {
  const rows = [
    ...state.requests.map((r) => ({ kind: 'req', date: r.scheduled_date, created: r.created_at, r })),
    ...state.bookings.map((b) => ({ kind: 'book', date: b.start_date, created: b.created_at, b })),
  ];
  const open = rows.filter((x) => OPEN.includes((x.r || x.b).status)).sort((a, b) => a.date.localeCompare(b.date));
  const past = rows.filter((x) => !OPEN.includes((x.r || x.b).status)).sort((a, b) => b.date.localeCompare(a.date));
  const itemName = (id) => state.items.find((i) => i.id === id)?.name || 'Rental';

  const row = (x) => {
    if (x.kind === 'req') {
      const r = x.r, st = REQ_STATUS[r.status];
      const bins = r.bin_ids.map(binById).filter(Boolean);
      return `<div class="card active-req">
        <div class="req-head">
          <div style="display:flex;gap:14px;align-items:center"><span class="row-icon">${icon[REQ_TYPE[r.type].icon]}</span>
            <div><div class="row-title">${reqTitle(r)}</div><div class="row-meta">${when(r)}${r.fee_cents ? ` · ${money(r.fee_cents)} delivery fee` : r.used_credit && r.type === 'delivery' ? ' · 1 credit' : ''}</div></div></div>
          <div class="bin-actions"><span class="pill ${st.cls}">${st.label}</span>${r.status === 'requested' ? `<button class="btn btn-ghost btn-sm" data-act="cancel-req" data-id="${r.id}">Cancel</button>` : ''}</div>
        </div>
        ${bins.length ? `<div class="req-bins">${bins.map((b) => `<span>${b.emoji} ${esc(b.label)}</span>`).join('')}</div>` : ''}
        ${OPEN.includes(r.status) ? trackerHtml(r) : ''}
        <div class="row-meta" style="margin-top:10px">Requested ${fmtRelative(r.created_at)}${r.notes ? ` · “${esc(r.notes)}”` : ''}</div>
      </div>`;
    }
    const b = x.b, st = REQ_STATUS[b.status];
    return `<div class="card active-req">
      <div class="req-head">
        <div style="display:flex;gap:14px;align-items:center"><span class="row-icon">${icon.table}</span>
          <div><div class="row-title">${esc(itemName(b.item_id))} × ${b.quantity}</div><div class="row-meta">${fmtDate(b.start_date)} → ${fmtDate(b.end_date)} · ${money(b.total_cents)} · ${b.paid ? 'Paid' : 'Unpaid'}</div></div></div>
        <div class="bin-actions"><span class="pill ${st.cls}">${st.label}</span>
          ${!b.paid && b.status !== 'cancelled' && api.billingEnabled() ? `<button class="btn btn-dark btn-sm" data-act="pay-booking" data-id="${b.id}">Pay now</button>` : ''}
          ${b.status === 'requested' ? `<button class="btn btn-ghost btn-sm" data-act="cancel-booking" data-id="${b.id}">Cancel</button>` : ''}</div>
      </div>
    </div>`;
  };

  let body = `<div class="section-head" style="margin-top:0"><h2>Upcoming</h2></div>`;
  body += open.length ? open.map(row).join('') : `<div class="empty"><h3>Nothing booked</h3><p>Request a delivery from your bins, or book a pickup for bins at your place.</p><button class="btn btn-dark" data-act="request-delivery">${icon.truck}Request delivery</button></div>`;
  if (past.length) body += `<div class="section-head"><h2>History</h2></div>${past.map(row).join('')}`;

  root.innerHTML = shell('Requests', 'Deliveries, pickups, bin drop-offs and rentals', `
    <button class="btn btn-ghost" data-act="request-pickup" aria-label="Book pickup">${icon.arrowUp}<span class="btn-label">Book pickup</span></button>
    <button class="btn btn-primary" data-act="request-delivery" aria-label="Request delivery">${icon.truck}<span class="btn-label">Request delivery</span></button>`, body);
}

/* ========================================================= RENTALS VIEW */
function viewRentals() {
  const mine = state.bookings.filter((b) => b.status !== 'cancelled');
  let body = `<p class="hint" style="font-size:15px;max-width:620px;margin-bottom:20px">Things you need a couple of times a year, delivered and picked up. Book at least a day ahead.</p>
  <div class="rental-grid">${state.items.map((it) => `
    <div class="rental-card">
      <div class="rental-art">${esc(it.emoji)}${it.active ? '' : '<span class="pill pill-plain" style="background:var(--ink);color:#fff">Coming soon</span>'}</div>
      <div class="rental-body">
        <h3>${esc(it.name)}</h3>
        <p class="hint">${esc(it.description)}</p>
        <div class="rental-price">${money(it.price_cents_per_day)}<small> / day each</small></div>
        ${it.active ? `<button class="btn btn-dark btn-block" data-act="rent" data-id="${it.id}" style="margin-top:6px">Book</button>` : `<button class="btn btn-ghost btn-block" disabled style="margin-top:6px">Coming soon</button>`}
      </div>
    </div>`).join('')}
  </div>`;
  if (mine.length) body += `<div class="section-head"><h2>Your bookings</h2><a href="#requests" class="hint" style="font-weight:600;color:var(--text)">See in requests →</a></div>
    <div class="list">${mine.map((b) => `<div class="row-card"><span class="row-icon">${esc(state.items.find((i) => i.id === b.item_id)?.emoji || '📦')}</span>
      <div><div class="row-title">${esc(state.items.find((i) => i.id === b.item_id)?.name || 'Rental')} × ${b.quantity}</div><div class="row-meta">${fmtDate(b.start_date)} → ${fmtDate(b.end_date)} · ${money(b.total_cents)}</div></div>
      <span class="pill ${REQ_STATUS[b.status].cls}">${REQ_STATUS[b.status].label}</span></div>`).join('')}</div>`;
  root.innerHTML = shell('Rentals', 'Delivered to your door, picked up after', '', body);
}

function rentalModal(it) {
  if (!hasAddress()) { toast('Add your address first so we know where to deliver.'); location.hash = 'account'; return; }
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const start0 = isoDate(tomorrow);
  let qty = Math.min(2, it.max_per_booking);
  modal({
    title: `Book ${it.name.toLowerCase()}`,
    subtitle: `${money(it.price_cents_per_day)} per day, each · delivered and picked up`,
    body: `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
        <span class="label">Quantity</span>
        <div class="stepper"><button type="button" id="rq-minus" aria-label="Fewer">−</button><output id="rq-val">${qty}</output><button type="button" id="rq-plus" aria-label="More">+</button></div>
      </div>
      <div class="field-row">
        <div class="field"><label class="label" for="rs">Delivery day</label><input class="input" type="date" id="rs" name="start" min="${start0}" value="${start0}" required></div>
        <div class="field"><label class="label" for="re">Pickup day</label><input class="input" type="date" id="re" name="end" min="${start0}" value="${start0}" required></div>
      </div>
      <div class="field" style="margin-top:14px"><span class="label">Delivery window</span>${windowChoices('window', 'morning')}</div>
      <div class="field"><label class="label" for="rn">Notes <span class="hint">(optional)</span></label><input class="input" id="rn" name="notes" maxlength="200" placeholder="e.g. Set up in the backyard"></div>
      <div class="modal-summary"><span id="r-avail" class="hint">Checking availability…</span><b id="r-total"></b></div>`,
    actions: `<button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" id="r-go">Book${api.billingEnabled() ? ' & pay' : ''}</button>`,
    onMount: (m) => {
      const s = $('#rs', m.el), e = $('#re', m.el);
      let avail = 0;
      const paint = async () => {
        if (e.value < s.value) e.value = s.value;
        e.min = s.value;
        $('#rq-val', m.el).textContent = qty;
        const days = Math.round((new Date(e.value) - new Date(s.value)) / 86400000) + 1;
        $('#r-total', m.el).textContent = `${money(it.price_cents_per_day * qty * days)} · ${days} day${days === 1 ? '' : 's'}`;
        try {
          avail = await api.rentalAvailable(it.id, s.value, e.value);
          $('#r-avail', m.el).innerHTML = avail >= qty ? `${icon.check.replace('<svg', '<svg style="width:15px;height:15px;display:inline;vertical-align:-2px;color:var(--green)"')} ${avail} available` : `<span style="color:var(--red)">Only ${avail} available for those dates</span>`;
          $('#r-go', m.el).disabled = avail < qty;
        } catch { $('#r-avail', m.el).textContent = ''; }
      };
      $('#rq-minus', m.el).onclick = () => { qty = Math.max(1, qty - 1); paint(); };
      $('#rq-plus', m.el).onclick = () => { qty = Math.min(it.max_per_booking, qty + 1); paint(); };
      s.addEventListener('change', paint); e.addEventListener('change', paint);
      paint();
      m.onSubmit = async (ev) => {
        const fd = new FormData(m.form);
        const btn = ev.submitter || $('#r-go', m.el);
        setBusy(btn, true, 'Booking…');
        try {
          const b = await api.createBooking({ item_id: it.id, quantity: qty, start_date: fd.get('start'), end_date: fd.get('end'), time_window: fd.get('window'), notes: fd.get('notes') });
          m.close();
          if (api.billingEnabled()) return api.startRentalCheckout(b.id);
          toast(`<b>Booked:</b> ${qty} × ${esc(it.name)} on ${fmtDate(b.start_date, { weekday: 'long', month: 'short', day: 'numeric' })}. We'll confirm shortly.`);
          await refresh();
        } catch (err) { setBusy(btn, false); toast(esc(err.message)); }
      };
    },
  });
}

/* ========================================================= ACCOUNT VIEW */
function viewAccount() {
  const p = state.profile;
  const subLabel = { active: 'Active', past_due: 'Payment due', canceled: 'Cancelled', none: 'Not billing yet' }[p.subscription_status] || p.subscription_status;
  const body = `<div class="acct-grid">
    <form class="card card-pad" id="acct-form" novalidate>
      <h2 style="font-size:18px;margin-bottom:4px">Delivery details</h2>
      <p class="hint" style="margin-bottom:18px">Where we drop off and pick up.</p>
      <div class="field-row" style="margin-top:0">
        <div class="field"><label class="label" for="a-name">Full name</label><input class="input" id="a-name" name="full_name" value="${esc(p.full_name)}" autocomplete="name" required></div>
        <div class="field"><label class="label" for="a-phone">Mobile</label><input class="input" id="a-phone" name="phone" type="tel" value="${esc(p.phone)}" autocomplete="tel" placeholder="For delivery texts"></div>
      </div>
      <div class="field" style="margin-top:14px"><label class="label" for="a-1">Street address</label><input class="input" id="a-1" name="address_line1" value="${esc(p.address_line1)}" autocomplete="address-line1" required></div>
      <div class="field"><label class="label" for="a-2">Unit / buzzer <span class="hint">(optional)</span></label><input class="input" id="a-2" name="address_line2" value="${esc(p.address_line2)}" autocomplete="address-line2"></div>
      <div class="field-row">
        <div class="field"><label class="label" for="a-city">City</label><select class="select" id="a-city" name="city" required>${['', 'Oakville', 'Burlington', 'Mississauga', 'Milton'].map((c) => `<option ${c === p.city ? 'selected' : ''} value="${c}">${c || 'Choose…'}</option>`).join('')}</select></div>
        <div class="field"><label class="label" for="a-postal">Postal code</label><input class="input" id="a-postal" name="postal_code" value="${esc(p.postal_code)}" autocomplete="postal-code" maxlength="7" required></div>
      </div>
      <div class="field" style="margin-top:14px"><label class="label" for="a-notes">Access notes</label><textarea class="textarea" id="a-notes" name="access_notes" style="min-height:80px" placeholder="Side door, garage code, dog in the yard…">${esc(p.access_notes)}</textarea><span class="hint">So we can drop off and pick up when you're not home.</span></div>
      <button class="btn btn-dark" style="margin-top:18px" type="submit">Save details</button>
    </form>

    <div style="display:grid;gap:18px">
      <div class="card card-pad">
        <div class="plan-now"><div><span class="eyebrow">Your plan</span><h3 style="margin-top:6px">${money(monthlyCents())}<span style="font-size:15px;font-weight:500;color:var(--muted)"> / month</span></h3><div class="hint">${PR.name} · ${money(PR.binCents)} per bin${binCount() < PR.minBins ? ` · ${PR.minBins}-bin minimum` : ''}</div></div><span class="pill ${p.subscription_status === 'active' ? 'pill-done' : 'pill-pending'}">${subLabel}</span></div>
        <dl class="kv">
          <dt>Bins</dt><dd>${binCount()} × ${money(PR.binCents)}</dd>
          <dt>Refundable deposit</dt><dd>${money(binCount() * PR.depositCents)}</dd>
          <dt>Oversized items</dt><dd>${state.bins.filter((b) => b.kind === 'oversized').length} × ${money(api.OVERSIZED_CENTS)}</dd>
          <dt>Free deliveries</dt><dd>${p.delivery_credits === null ? 'Unlimited' : `${p.delivery_credits} of ${PR.deliveriesPerYear} left this year`}</dd>
          <dt>Member since</dt><dd>${fmtDate(p.created_at, { month: 'long', year: 'numeric' })}</dd>
        </dl>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px">
          <button class="btn btn-primary btn-sm" data-act="change-plan">${p.subscription_status === 'active' ? 'Update billing' : 'Start billing'}</button>
          <button class="btn btn-ghost btn-sm" data-act="billing">${icon.card}Billing & invoices</button>
        </div>
      </div>
      <div class="card card-pad">
        <span class="eyebrow">Signed in as</span>
        <p style="margin-top:6px;font-weight:600">${esc(p.email)}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
          ${p.is_admin ? `<a class="btn btn-ghost btn-sm" href="admin.html">${icon.warehouse}Ops board</a>` : ''}
          <button class="btn btn-danger btn-sm" data-act="signout">${icon.logout}Sign out</button>
        </div>
      </div>
    </div>
  </div>`;
  root.innerHTML = shell('Account', 'Address, plan and billing', '', body);
  $('#acct-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.reportValidity()) return;
    const btn = $('button[type="submit"]', f);
    setBusy(btn, true, 'Saving…');
    try {
      const d = Object.fromEntries(new FormData(f));
      d.postal_code = d.postal_code.trim().toUpperCase().replace(/^(\w{3})\s*(\w{3})$/, '$1 $2');
      await api.updateProfile(d);
      toast('Details saved.');
      await refresh();
    } catch (err) { setBusy(btn, false); toast(esc(err.message)); }
  });
}

function planModal() {
  if (state.profile.subscription_status === 'active') { api.openBillingPortal().catch((err) => toast(esc(err.message))); return; }
  const bins = Math.max(binCount(), PR.minBins);
  modal({
    title: 'Start billing',
    subtitle: `Founding members pay nothing for the first ${PR.founderFreeMonths} months.`,
    body: `<div class="card card-pad" style="background:var(--paper)">
        <dl class="kv" style="margin-top:0">
          <dt>Bins</dt><dd>${bins} × ${money(PR.binCents)}/month</dd>
          <dt>Refundable deposit</dt><dd>${bins} × ${money(PR.depositCents)} = ${money(bins * PR.depositCents)}, charged today</dd>
          <dt>Free deliveries</dt><dd>${PR.deliveriesPerYear} a year, then ${money(api.EXTRA_DELIVERY_CENTS)} each</dd>
          <dt>Pickups</dt><dd>Always free</dd>
          <dt>First ${PR.founderFreeMonths} months</dt><dd style="color:var(--green)">$0</dd>
          <dt>After that</dt><dd>${money(monthlyCents())}/month</dd>
        </dl>
      </div>
      <p class="hint" style="margin-top:12px">Your bill follows your bin count — add bins and it goes up, send them home for good and it goes down. Cancel any time; the deposit comes back once your bins are returned.</p>
      ${api.billingEnabled() ? '' : '<p class="hint" style="margin-top:10px">Card payments go live once Stripe is connected. Until then, we\'ll invoice founding members directly.</p>'}`,
    actions: `<button type="button" class="btn btn-ghost" data-close>Not now</button><button class="btn btn-primary" type="submit">Add a card</button>`,
    onMount: (m) => {
      m.onSubmit = async (e) => {
        const btn = e.submitter || $('button[type="submit"]', m.el);
        setBusy(btn, true, 'Opening checkout…');
        try { await api.startPlanCheckout(); } catch (err) { setBusy(btn, false); m.close(); toast(esc(err.message)); }
      };
    },
  });
}

/* ------------------------------------------------- first-run onboarding */
function welcomeFlow() {
  const p = state.profile;
  modal({
    title: `Welcome to Fraktion, ${esc(firstName())}!`,
    subtitle: 'Two quick things and we\'ll book your first bin drop-off.',
    body: `
      <div class="field"><label class="label" for="w-1">Street address</label><input class="input" id="w-1" name="address_line1" value="${esc(p.address_line1)}" autocomplete="address-line1" required autofocus></div>
      <div class="field-row">
        <div class="field"><label class="label" for="w-city">City</label><select class="select" id="w-city" name="city" required>${['', 'Oakville', 'Burlington', 'Mississauga', 'Milton'].map((c) => `<option ${c === p.city ? 'selected' : ''} value="${c}">${c || 'Choose…'}</option>`).join('')}</select></div>
        <div class="field"><label class="label" for="w-postal">Postal code</label><input class="input" id="w-postal" name="postal_code" value="${esc(p.postal_code)}" maxlength="7" required></div>
      </div>
      <div class="field" style="margin-top:14px"><label class="label" for="w-phone">Mobile <span class="hint">— we text when the driver is close</span></label><input class="input" id="w-phone" name="phone" type="tel" value="${esc(p.phone)}" autocomplete="tel"></div>`,
    actions: `<button type="button" class="btn btn-ghost" data-close>Later</button><button class="btn btn-primary" type="submit">Next: book bins</button>`,
    onMount: (m) => {
      m.onSubmit = async (e) => {
        if (!m.form.reportValidity()) return;
        const btn = e.submitter || $('button[type="submit"]', m.el);
        setBusy(btn, true, 'Saving…');
        try {
          await api.updateProfile(Object.fromEntries(new FormData(m.form)));
          await loadAll();
          m.close();
          render();
          addBinsModal();
        } catch (err) { setBusy(btn, false); toast(esc(err.message)); }
      };
    },
  });
}
