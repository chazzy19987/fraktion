// Marketing site interactions.
import { icon, esc, toast, dateStrip, windowChoices, serviceDays, EMOJIS } from './ui.js?v=5';
import { PRICING, joinWaitlist, init } from './api.js?v=5';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Icons
$$('[data-icon]').forEach((el) => { el.innerHTML = icon[el.dataset.icon] || ''; });
$$('[data-icon-before]').forEach((el) => { el.insertAdjacentHTML('afterbegin', icon[el.dataset.iconBefore] || ''); });
$('#yr').textContent = new Date().getFullYear();

// Mobile menu
const menuBtn = $('.menu-btn');
menuBtn?.addEventListener('click', () => {
  const open = $('#nav-links').classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', String(open));
});
$$('#nav-links a').forEach((a) => a.addEventListener('click', () => $('#nav-links').classList.remove('open')));

// Pricing calculator
const range = $('#calc-range');
const renderCalc = () => {
  const n = +range.value;
  const monthly = n * PRICING.binCents / 100;
  $('#calc-n').textContent = n;
  $('#calc-l').textContent = (n * 102).toLocaleString('en-CA');
  $('#calc-m').textContent = `$${monthly}`;
  $('#calc-s').textContent = `$${monthly * PRICING.founderFreeMonths}`;
  $('#calc-stack').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < PRICING.standardBins ? 'std' : ''}"></i>`).join('');
};
range.addEventListener('input', renderCalc);
renderCalc();

/* ---------- Hero mockup: a bin goes from storage to your door ---------- */
(function heroLoop() {
  const hot = $('#mock-hot'), pill = $('#mock-pill'), btn = $('#mock-btn'), toastEl = $('#mock-toast'), driver = $('#mock-driver'), credits = $('#mock-credits');
  const states = [
    () => { hot.classList.remove('hot'); pill.className = 'pill pill-stored'; pill.textContent = 'In storage'; btn.textContent = 'Deliver to me'; btn.className = 'btn btn-dark go'; toastEl.classList.add('hide'); driver.classList.add('hide'); credits.textContent = '8'; },
    () => { hot.classList.add('hot'); btn.className = 'btn btn-primary go'; btn.textContent = 'Deliver to me ✓'; },
    () => { pill.className = 'pill pill-pending'; pill.textContent = 'Delivery booked · Thu'; btn.className = 'btn btn-ghost go'; btn.textContent = 'Booked'; toastEl.classList.remove('hide'); credits.textContent = '7'; },
    () => { pill.className = 'pill pill-transit'; pill.textContent = 'On the way to you'; toastEl.classList.add('hide'); driver.classList.remove('hide'); },
    () => { hot.classList.remove('hot'); pill.className = 'pill pill-home'; pill.textContent = 'With you'; driver.classList.add('hide'); btn.className = 'btn btn-ghost go'; btn.textContent = 'Send back to storage'; },
  ];
  if (reduceMotion) { states[1](); states[2](); return; }
  let i = 0;
  states[0]();
  setInterval(() => { i = (i + 1) % states.length; states[i](); }, 2200);
})();

/* ---------- Dashboard showcase tabs ---------- */
const tabs = $$('.show-tab');
let tabTimer;
function selectTab(tab, fromUser) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $('#' + t.getAttribute('aria-controls')).hidden = !on;
  });
  if (tab.id === 't-track') runTracker();
  if (fromUser) clearInterval(tabTimer);
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t, true));
  t.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = tabs[(i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus(); selectTab(next, true);
    }
  });
});

// 01 — live relabel
const emojiGrid = $('#demo-emoji');
emojiGrid.innerHTML = EMOJIS.slice(0, 12).map((e, i) => `<label><input type="radio" name="demo-emoji" value="${e}" ${i === 1 ? 'checked' : ''}><span>${e}</span></label>`).join('');
const renderPreview = () => {
  $('#pv-label').textContent = $('#demo-label').value.trim() || 'Untitled bin';
  $('#pv-contents').textContent = $('#demo-contents').value.split('\n').filter(Boolean).join(' · ');
  $('#pv-emoji').textContent = $('input[name="demo-emoji"]:checked').value;
};
['#demo-label', '#demo-contents'].forEach((s) => $(s).addEventListener('input', renderPreview));
emojiGrid.addEventListener('change', renderPreview);
renderPreview();

// 02 — delivery picker
$('#demo-days').innerHTML = dateStrip('demo-day', serviceDays(7, 2));
$('#demo-windows').innerHTML = windowChoices('demo-win');
$('#demo-book').addEventListener('click', () => {
  const day = $('input[name="demo-day"]:checked');
  const d = new Date(day.value + 'T00:00');
  const win = $('input[name="demo-win"]:checked').closest('label').querySelector('small').textContent;
  toast(`<b>Delivery booked</b> — ${d.toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' })}, ${esc(win)}. (Demo — nothing was sent.)`);
});

// 03 — add bins price calc
let qty = 3;
const renderQty = () => {
  $('#add-qty').textContent = qty;
  $('#add-price').textContent = `$${qty * PRICING.binCents / 100}`;
  $('#add-stack').innerHTML = Array.from({ length: Math.min(qty, 6) }, () => `<div style="height:14px;border-radius:4px;background:var(--yellow);box-shadow:inset 0 -5px 0 rgba(0,0,0,.18)"></div>`).join('') + (qty > 6 ? `<small style="text-align:center;color:var(--muted)">+${qty - 6} more</small>` : '');
};
$('#add-minus').addEventListener('click', () => { qty = Math.max(1, qty - 1); renderQty(); });
$('#add-plus').addEventListener('click', () => { qty = Math.min(20, qty + 1); renderQty(); });
renderQty();

// 04 — tracker animation
let trackRun;
function runTracker() {
  const steps = $$('#demo-tracker .tracker-step');
  const labels = ['Requested', 'Scheduled', 'On the way', 'Delivered'];
  const pills = ['pill-pending', 'pill-pending', 'pill-transit', 'pill-done'];
  let i = 0;
  clearInterval(trackRun);
  const paint = () => {
    steps.forEach((s, j) => { s.className = 'tracker-step' + (j < i ? ' done' : j === i ? ' current' : ''); });
    if (i === 3) steps[3].className = 'tracker-step done';
    $('#track-pill').className = 'pill ' + pills[i];
    $('#track-pill').textContent = labels[i];
  };
  paint();
  if (reduceMotion) return;
  trackRun = setInterval(() => { i = (i + 1) % 4; paint(); }, 1400);
}

// Auto-advance tabs until the visitor interacts
if (!reduceMotion) {
  let t = 0;
  const section = $('#dashboard');
  const io = new IntersectionObserver(([e]) => {
    clearInterval(tabTimer);
    if (e.isIntersecting) tabTimer = setInterval(() => { t = (t + 1) % tabs.length; selectTab(tabs[t]); }, 6500);
  }, { threshold: 0.35 });
  io.observe(section);
  section.addEventListener('pointerdown', () => { clearInterval(tabTimer); io.disconnect(); }, { once: true });
  section.addEventListener('focusin', () => { clearInterval(tabTimer); io.disconnect(); }, { once: true });
}

/* ---------- Founding member waitlist ---------- */
$('#wl-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  if (!form.reportValidity()) return;
  const btn = form.querySelector('button');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await init();
    const fd = new FormData(form);
    await joinWaitlist({ email: String(fd.get('email')).trim(), postal_code: String(fd.get('postal_code')).trim().toUpperCase() });
    form.style.display = 'none';
    $('#wl-done').classList.add('show');
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Claim my founding spot';
    toast(esc(err.message || 'Something went wrong — please try again.'));
  }
});
