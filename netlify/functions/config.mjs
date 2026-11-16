// Public, browser-safe settings. Lets you configure the site from Netlify environment variables.
export default async () => new Response(JSON.stringify({
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  stripeEnabled: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_STARTER),
}), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
