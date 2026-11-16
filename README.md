# Fraktion — storage from your doorstep

Marketing site, customer dashboard and ops board for Fraktion. Plain HTML, CSS and JavaScript — no build step — hosted on Netlify, with **Supabase** for accounts and data and **Stripe** for billing.

| Page | What it is |
|---|---|
| `index.html` | Marketing site + founding-member waitlist |
| `auth.html` (`/login`, `/signup`) | Sign up, log in, password reset |
| `app.html` (`/app`) | Customer dashboard — bins, relabel, deliveries, pickups, new bins, rentals, account |
| `admin.html` (`/admin`) | Ops board — daily run sheet, customers, bin shelf locations, rental catalogue, waitlist |

## It works right now, in demo mode

With no keys set, the whole site runs on sample data stored in the visitor's browser. Book a delivery in `/app`, then open `/admin` and confirm it — the bins move through the same states they will in production. **Reset demo** in the yellow banner starts over.

Demo mode switches off automatically the moment Supabase keys are added.

---

## Going live

### 1. Supabase (accounts + database) — about 10 minutes

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine; pick the **Canada (Central)** region).
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**. Safe to re-run after edits.
3. **Authentication → URL Configuration**
   - Site URL: `https://YOUR-SITE.netlify.app` (or your domain)
   - Redirect URLs: add `https://YOUR-SITE.netlify.app/**`
4. **Authentication → Providers → Email**: keep "Confirm email" on.
5. **Project Settings → API**: copy the **Project URL**, the **anon public** key and the **service_role** key.

### 2. Netlify environment variables

**Site configuration → Environment variables** — add, then redeploy:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon public key (safe in the browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key — **server only, never put it in a file** |

### 3. Make yourself staff

Sign up on the live site, then in the Supabase SQL Editor run:

```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```

`/admin` now shows the ops board, and an **Ops board** link appears in your dashboard.

### 4. Stripe (billing) — when you're ready to charge

Until this is set up, plan and rental buttons tell customers that card payment is coming — bookings still save, so you can invoice founding members directly.

1. In Stripe (start in **Test mode**), create three **recurring monthly prices in CAD**:
   - Starter — $5.00 **per unit** (quantity = number of bins)
   - Family — $35.00
   - Pro — $79.00
2. Add to Netlify:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` (later `sk_live_…`) |
| `STRIPE_PRICE_STARTER` / `_FAMILY` / `_PRO` | the three `price_…` IDs |
| `STRIPE_WEBHOOK_SECRET` | from step 3 |
| `STRIPE_FOUNDING_TRIAL_DAYS` | optional, e.g. `30` for "first month free" |
| `STRIPE_AUTOMATIC_TAX` | optional, `true` if Stripe Tax is set up for HST |

3. **Developers → Webhooks → Add endpoint**: `https://YOUR-SITE/.netlify/functions/stripe-webhook`, events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. **Settings → Billing → Customer portal**: turn it on (lets customers update cards, see invoices, switch plans).

The webhook sets each customer's plan, subscription status and yearly delivery credits, and marks rentals paid.

---

## How the business rules work

All rules live in the database (`supabase/schema.sql`), so they hold no matter what the browser sends:

- **Customers can** relabel bins (name, icon, tags, contents), edit their address, and create or cancel *unconfirmed* requests and bookings. They can't change bin status, plans, credits or anyone else's data.
- **Delivery credits**: Starter 4/yr, Family 10/yr, Pro unlimited. A delivery spends one credit; with none left it carries a $9.99 fee (shown on the run sheet). Cancelling refunds the credit. Pickups are always free.
- **Request flow** (ops board buttons): Requested → **Confirm** → Scheduled → **Start trip** → On the way → **Mark done**. Bins update automatically: out for delivery → with customer, or heading to storage → stored. Completing a **new bins** drop-off creates that many serial-numbered bins (`FRK-0001`…) on the customer's account.
- **Rentals** check availability day by day against units owned. Change prices, quantities and "bookable / coming soon" right on the ops board's Rentals tab — e.g. bump table count when you buy more, or flip chairs to bookable.

## Where to change things

| To change… | Edit |
|---|---|
| Plan names, prices, credits shown on the site | `PLANS` at the top of `assets/js/api.js` (keep Stripe prices and `PLAN_CREDITS` in `netlify/lib/shared.mjs` in step) |
| Extra delivery fee | `EXTRA_DELIVERY_CENTS` in `api.js` and `999` in `prepare_request()` in the schema |
| Service-area cities | the city lists in `assets/js/app.js` |
| Colours and type | tokens at the top of `assets/css/fraktion.css` |
| Marketing copy, FAQ | `index.html` |

## Project layout

```
index.html  auth.html  app.html  admin.html
assets/css/fraktion.css     shared design system
assets/js/api.js            data layer (demo + Supabase) — the only file that talks to the backend
assets/js/ui.js             icons, modals, toasts, formatting
assets/js/{site,auth,app,admin}.js   one per page
assets/js/config.js         optional local keys (Netlify env vars are preferred)
netlify/functions/          config, checkout, billing-portal, stripe-webhook
netlify/lib/shared.mjs      helpers for those functions
supabase/schema.sql         tables, rules, row level security, rental catalogue
```

## Previewing locally

Any static server works, e.g. `python3 -m http.server` and open `http://localhost:8000` — it runs in demo mode. To test against Supabase locally, fill in `assets/js/config.js` (anon key only).
