import { icon, esc, setBusy } from './ui.js?v=5';
import { init, getUser, signIn, signUp, sendPasswordReset, updatePassword, PRICING, getMode } from './api.js?v=5';

const $ = (s) => document.querySelector(s);
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon[el.dataset.icon] || ''; });

const params = new URLSearchParams(location.search);
let view = params.get('mode') || 'login';
const next = params.get('next') || '';

const card = $('#card');
const logo = `<a class="logo mobile-logo" href="index.html"><span class="logo-mark">${icon.logo}</span>Fraktion</a>`;
const goApp = () => { location.href = `app.html${next ? `#${next}` : ''}`; };

const views = {
  login: () => `${logo}
    <h1>Welcome back</h1>
    <p class="sub">Log in to see your bins and book a delivery.</p>
    <form id="f" novalidate>
      <div class="field"><label class="label" for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label class="label" for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" required></div>
      <div style="text-align:right;margin-top:8px"><button type="button" class="link-btn" data-go="forgot" style="font-size:14px">Forgot password?</button></div>
      <div class="err" id="err" role="alert"></div>
      <button class="btn btn-dark btn-lg btn-block" style="margin-top:18px">Log in</button>
    </form>
    <p class="switch">New to Fraktion? <button type="button" data-go="signup">Create an account</button></p>`,

  signup: () => `${logo}
    <h1>Get your first bins</h1>
    <p class="sub">Create your account — we'll book your bin drop-off next.</p>
    <form id="f" novalidate>
      <div class="field"><label class="label" for="full_name">Full name</label><input class="input" id="full_name" name="full_name" autocomplete="name" required></div>
      <div class="field"><label class="label" for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
      <div class="field-row">
        <div class="field"><label class="label" for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters</span></div>
        <div class="field"><label class="label" for="postal_code">Postal code</label><input class="input" id="postal_code" name="postal_code" autocomplete="postal-code" maxlength="7" required placeholder="L6M 2V4"></div>
      </div>
      <div class="notice" style="margin-top:16px;padding:14px 16px;font-size:14px">
        <b>$5 per bin, per month.</b> Most homes start with ${PRICING.standardBins} bins (minimum ${PRICING.minBins}). ${PRICING.deliveriesPerYear} free deliveries a year, pickups always free.
        <div style="margin-top:6px;font-weight:650">Founding members: first ${PRICING.founderFreeMonths} months free.</div>
      </div>
      <div class="err" id="err" role="alert"></div>
      <button class="btn btn-primary btn-lg btn-block" style="margin-top:18px">Create account</button>
      <p class="hint" style="margin-top:12px;text-align:center">By signing up you agree to our storage terms.</p>
    </form>
    <p class="switch">Already have an account? <button type="button" data-go="login">Log in</button></p>`,

  forgot: () => `${logo}
    <h1>Reset your password</h1>
    <p class="sub">We'll email you a link to set a new one.</p>
    <form id="f" novalidate>
      <div class="field"><label class="label" for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
      <div class="err" id="err" role="alert"></div>
      <button class="btn btn-dark btn-lg btn-block" style="margin-top:18px">Send reset link</button>
    </form>
    <p class="switch"><button type="button" data-go="login">Back to log in</button></p>`,

  reset: () => `${logo}
    <h1>Choose a new password</h1>
    <p class="sub">You're almost back in.</p>
    <form id="f" novalidate>
      <div class="field"><label class="label" for="password">New password</label><input class="input" id="password" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="err" id="err" role="alert"></div>
      <button class="btn btn-dark btn-lg btn-block" style="margin-top:18px">Save password</button>
    </form>`,

  sent: (email) => `${logo}
    <div class="notice">
      <h1 style="font-size:24px">Check your inbox</h1>
      <p style="margin-top:8px">We sent a link to <b>${esc(email)}</b>. Open it on this device to continue.</p>
    </div>
    <p class="switch"><button type="button" data-go="login">Back to log in</button></p>`,
};

const POSTAL = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

function render(v, arg) {
  view = v;
  card.innerHTML = views[v](arg);
  document.title = { login: 'Log in', signup: 'Create account', forgot: 'Reset password', reset: 'New password', sent: 'Check your email' }[v] + ' — Fraktion';
  card.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { history.replaceState(null, '', `?mode=${b.dataset.go}`); render(b.dataset.go); }));
  const f = card.querySelector('#f');
  f?.addEventListener('submit', onSubmit);
  if (getMode() === 'demo' && f) {
    // Demo mode: prefill so it's one click to look around.
    const fill = { email: 'alex@example.com', password: 'demo-password', full_name: 'Alex Morgan', postal_code: 'L6M 2V4' };
    Object.entries(fill).forEach(([k, val]) => { const el = f.querySelector(`[name="${k}"]`); if (el && !el.value) el.value = val; });
  }
  card.querySelector('input')?.focus();
}

function showErr(msg) { const e = $('#err'); e.textContent = msg; e.classList.add('show'); }

async function onSubmit(e) {
  e.preventDefault();
  const f = e.currentTarget;
  $('#err').classList.remove('show');
  if (!f.reportValidity()) return;
  const d = Object.fromEntries(new FormData(f));
  const btn = f.querySelector('button[type="submit"], button:not([type])');
  setBusy(btn, true, 'One moment…');
  try {
    if (view === 'login') { await signIn({ email: d.email.trim(), password: d.password }); goApp(); }
    if (view === 'signup') {
      const postal = d.postal_code.trim().toUpperCase();
      if (!POSTAL.test(postal)) throw new Error('That postal code doesn’t look right — try the format L6M 2V4.');
      const { needsConfirmation } = await signUp({ email: d.email.trim(), password: d.password, full_name: d.full_name.trim(), postal_code: postal.replace(/^(\w{3})(\w{3})$/, '$1 $2') });
      if (needsConfirmation) render('sent', d.email.trim());
      else location.href = 'app.html?welcome=1';
    }
    if (view === 'forgot') { await sendPasswordReset(d.email.trim()); render('sent', d.email.trim()); }
    if (view === 'reset') { await updatePassword(d.password); goApp(); }
  } catch (err) {
    setBusy(btn, false);
    showErr(err.message || 'Something went wrong. Please try again.');
  }
}

(async () => {
  const { mode } = await init();
  if (mode === 'demo') {
    $('#demo-banner').innerHTML = `<div class="demo-banner">Demo mode — no real accounts yet. Any details work, and sample data is saved in this browser.</div>`;
  }
  // Already signed in? Skip straight to the dashboard (except when setting a new password).
  if (view !== 'reset' && mode === 'live' && await getUser()) return goApp();
  render(views[view] ? view : 'login');
})();
