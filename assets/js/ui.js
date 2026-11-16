// Shared UI helpers: icons, escaping, formatting, toasts and modals.

const s = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icon = {
  logo: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7.5 12 3l9 4.5v1.2H3z"/><rect x="3" y="10.2" width="18" height="10.8" rx="1.6"/><rect x="9" y="13" width="6" height="2" rx="1" fill="#F5C800"/></svg>`,
  box: s('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>'),
  truck: s('<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>'),
  home: s('<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  list: s('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>'),
  table: s('<path d="M3 9h18"/><path d="M5 9v10M19 9v10"/><path d="M8 9l-2-4h12l-2 4"/>'),
  user: s('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  edit: s('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  check: s('<path d="m5 12 5 5 9-10"/>'),
  x: s('<path d="M6 6l12 12M18 6 6 18"/>'),
  search: s('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  arrowUp: s('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  arrowRight: s('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  calendar: s('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  card: s('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
  logout: s('<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h11"/>'),
  warehouse: s('<path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-8h10v8"/><path d="M7 17h10"/>'),
  users: s('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .7 3.2 2.5 3.8 5.5"/>'),
  clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  pin: s('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  mail: s('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  sparkle: s('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  phone: s('<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>'),
  tag: s('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>'),
};

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const money = (cents) => (cents / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: cents % 100 ? 2 : 0 });

export function parseDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d;
  // Treat plain YYYY-MM-DD as a local date, not UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day); }
  return new Date(d);
}
export const fmtDate = (d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => parseDate(d)?.toLocaleDateString('en-CA', opts) ?? '';
export const fmtRelative = (d) => {
  const diff = (Date.now() - parseDate(d).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return fmtDate(d, { month: 'short', day: 'numeric' });
};
export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Next N service days (Mon–Sat), starting tomorrow. */
export function serviceDays(n = 10, startOffset = 1) {
  const out = [];
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + startOffset);
  while (out.length < n) { if (d.getDay() !== 0) out.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return out;
}

export const WINDOWS = {
  morning: { label: 'Morning', time: '8am – 12pm' },
  afternoon: { label: 'Afternoon', time: '12pm – 4pm' },
  evening: { label: 'Evening', time: '4pm – 8pm' },
};

export const BIN_STATUS = {
  stored: { label: 'In storage', cls: 'pill-stored' },
  with_customer: { label: 'With you', cls: 'pill-home' },
  out_for_delivery: { label: 'On the way to you', cls: 'pill-transit' },
  to_warehouse: { label: 'Heading to storage', cls: 'pill-transit' },
};

export const REQ_STATUS = {
  requested: { label: 'Requested', cls: 'pill-pending' },
  scheduled: { label: 'Scheduled', cls: 'pill-pending' },
  en_route: { label: 'On the way', cls: 'pill-transit' },
  completed: { label: 'Completed', cls: 'pill-done' },
  cancelled: { label: 'Cancelled', cls: 'pill-cancel' },
};

export const REQ_TYPE = {
  delivery: { label: 'Delivery to you', icon: 'truck' },
  pickup: { label: 'Pickup to storage', icon: 'warehouse' },
  new_bins: { label: 'New empty bins', icon: 'box' },
  rental: { label: 'Rental', icon: 'table' },
};

export const EMOJIS = ['📦', '🎄', '🎃', '🐣', '👶', '🧸', '📚', '📸', '🧥', '👟', '⛺', '🏕️', '🎣', '🏒', '⛳', '🚲', '🍽️', '🔧', '🎨', '🎮', '💼', '🧵', '🌱', '🏖️', '🎁', '🗂️', '🪩', '🧳'];

/* ---------- Toasts ---------- */
let toastWrap;
export function toast(html, ms = 3800) {
  if (!toastWrap) { toastWrap = document.createElement('div'); toastWrap.className = 'toast-wrap'; toastWrap.setAttribute('role', 'status'); document.body.append(toastWrap); }
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span class="toast-icon">✓</span><div>${html}</div>`;
  toastWrap.append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------- Modal ---------- */
export function modal({ title, subtitle = '', body, actions, onMount, size }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ${size ? `style="width:min(${size}px,100%)"` : ''}>
        <form method="dialog" novalidate>
          <div class="modal-head">
            <div><h2 id="modal-title">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
            <button type="button" class="icon-btn" data-close aria-label="Close">${icon.x}</button>
          </div>
          <div class="modal-body">${body}</div>
          <div class="modal-foot">${actions}</div>
        </form>
      </div>`;
    const prevFocus = document.activeElement;
    const close = (val) => { back.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(null); });
    const form = back.querySelector('form');
    document.body.append(back);
    const api = { el: back, form, close };
    form.addEventListener('submit', (e) => { e.preventDefault(); api.onSubmit ? api.onSubmit(e) : close(new FormData(form)); });
    onMount?.(api);
    (back.querySelector('[autofocus]') || back.querySelector('input, select, textarea, button:not([data-close])'))?.focus();
  });
}

export function confirmModal(title, text, confirmLabel = 'Confirm', danger = false) {
  return modal({
    title, body: `<p style="color:var(--muted)">${text}</p>`,
    actions: `<button type="button" class="btn btn-ghost" data-close>Keep it</button><button class="btn ${danger ? 'btn-danger' : 'btn-dark'}" value="ok">${confirmLabel}</button>`,
    onMount: (m) => { m.onSubmit = () => m.close(true); },
  });
}

export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = label || 'Working…'; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

export function dateStrip(name, days, checked) {
  return `<div class="date-strip" role="radiogroup">${days.map((d, i) => {
    const v = isoDate(d);
    return `<label class="choice"><input type="radio" name="${name}" value="${v}" ${(checked ? checked === v : i === 0) ? 'checked' : ''} required>
      <span><small>${d.toLocaleDateString('en-CA', { weekday: 'short' })}</small><b>${d.getDate()}</b><small>${d.toLocaleDateString('en-CA', { month: 'short' })}</small></span></label>`;
  }).join('')}</div>`;
}

export function windowChoices(name, checked = 'afternoon') {
  return `<div class="choices">${Object.entries(WINDOWS).map(([k, w]) => `
    <label class="choice"><input type="radio" name="${name}" value="${k}" ${k === checked ? 'checked' : ''}><span>${w.label}<small>${w.time}</small></span></label>`).join('')}</div>`;
}
