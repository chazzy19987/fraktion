// Optional local overrides. On Netlify, set these as environment variables instead
// (SUPABASE_URL, SUPABASE_ANON_KEY, STRIPE_SECRET_KEY …) — see README.md.
// Leave blank to run the whole site in demo mode with sample data saved in your browser.
window.FRAKTION_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',   // the public "anon" key — safe to expose in the browser
  stripeEnabled: false,
};
