-- =====================================================================
-- FRAKTION — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to re-run: it drops and recreates policies, triggers and functions.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Profiles (one row per customer, created automatically on sign-up)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  postal_code text,
  access_notes text,                          -- buzzer, side door, dog in yard…
  plan text not null default 'standard' check (plan in ('standard','starter','family','pro')),
  delivery_credits integer default 10,        -- free deliveries left this year; null = unlimited
  credits_reset_on date default (current_date + interval '1 year'),
  subscription_status text default 'none',    -- none | active | past_due | canceled (set by Stripe webhook)
  stripe_customer_id text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Bins — serialized, owned by one customer
-- ---------------------------------------------------------------------
create sequence if not exists public.bin_code_seq start 1;

create table if not exists public.bins (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('FRK-' || lpad(nextval('public.bin_code_seq')::text, 4, '0')),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'bin' check (kind in ('bin','oversized')),
  label text not null default 'New bin',
  emoji text not null default '📦',
  tags text[] not null default '{}',
  contents text not null default '',           -- one item per line
  status text not null default 'with_customer'
    check (status in ('stored','with_customer','out_for_delivery','to_warehouse')),
  location text,                               -- warehouse slot, e.g. A-03-2 (staff only edit)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bins_owner_idx on public.bins(owner_id);

-- ---------------------------------------------------------------------
-- Requests — deliveries, pickups and new-bin drop-offs
-- ---------------------------------------------------------------------
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('delivery','pickup','new_bins')),
  bin_ids uuid[] not null default '{}',
  quantity integer not null default 0,         -- for new_bins
  scheduled_date date not null,
  time_window text not null check (time_window in ('morning','afternoon','evening')),
  address text,                                -- snapshot at request time
  notes text,
  status text not null default 'requested'
    check (status in ('requested','scheduled','en_route','completed','cancelled')),
  used_credit boolean not null default false,
  fee_cents integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists requests_customer_idx on public.requests(customer_id);
create index if not exists requests_status_idx on public.requests(status, scheduled_date);

-- ---------------------------------------------------------------------
-- Rentals — catalogue + bookings (folding tables, chairs, bounce castle…)
-- ---------------------------------------------------------------------
create table if not exists public.rental_items (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text not null default '',
  emoji text not null default '📦',
  price_cents_per_day integer not null,
  quantity_total integer not null default 0,
  max_per_booking integer not null default 10,
  active boolean not null default true,        -- false = shows as "Coming soon"
  sort integer not null default 0
);

create table if not exists public.rental_bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.rental_items(id),
  quantity integer not null check (quantity > 0),
  start_date date not null,
  end_date date not null,
  time_window text not null default 'afternoon',
  address text,
  notes text,
  total_cents integer not null default 0,
  status text not null default 'requested'
    check (status in ('requested','scheduled','en_route','completed','cancelled')),
  paid boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists bookings_item_idx on public.rental_bookings(item_id, start_date, end_date);

-- ---------------------------------------------------------------------
-- Early-access waitlist (marketing site form, open to the public)
-- ---------------------------------------------------------------------
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  postal_code text,
  source text default 'website',
  created_at timestamptz not null default now()
);

-- Upgrade from the earlier three-tier plans (safe to re-run)
alter table public.profiles alter column plan set default 'standard';
alter table public.profiles alter column delivery_credits set default 10;
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('standard','starter','family','pro'));

-- =====================================================================
-- Helpers
-- =====================================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- True for a signed-in customer. Staff, the service key (Stripe webhook)
-- and the SQL editor (no signed-in user) are not restricted.
create or replace function public.restricted() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not public.is_admin()
     and coalesce(current_setting('fraktion.internal', true), '') <> '1';
$$;

-- New auth user → profile row
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, postal_code)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'postal_code')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Customers may edit their contact details, but never plan / credits / admin flags
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.restricted() then
    new.plan := old.plan;
    new.delivery_credits := old.delivery_credits;
    new.credits_reset_on := old.credits_reset_on;
    new.subscription_status := old.subscription_status;
    new.stripe_customer_id := old.stripe_customer_id;
    new.is_admin := old.is_admin;
    new.email := old.email;
  end if;
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- Customers may relabel bins, but not move them, re-own them or change status
create or replace function public.guard_bin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.restricted() then
    new.code := old.code;
    new.owner_id := old.owner_id;
    new.kind := old.kind;
    new.status := old.status;
    new.location := old.location;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_bin on public.bins;
create trigger guard_bin before update on public.bins
  for each row execute function public.guard_bin();

-- New request: validate bins, snapshot address, spend a delivery credit or add the fee
create or replace function public.prepare_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
  bad_count integer;
begin
  select * into p from public.profiles where id = new.customer_id;

  if public.restricted() then
    new.status := 'requested';
    new.used_credit := false;
    new.fee_cents := 0;
  end if;

  if new.scheduled_date < current_date then
    raise exception 'Pick a date from tomorrow onward';
  end if;

  if new.type in ('delivery','pickup') then
    if coalesce(array_length(new.bin_ids, 1), 0) = 0 then raise exception 'Choose at least one bin'; end if;
    select count(*) into bad_count from unnest(new.bin_ids) b(id)
      where not exists (
        select 1 from public.bins x where x.id = b.id and x.owner_id = new.customer_id
          and x.status = case when new.type = 'delivery' then 'stored' else 'with_customer' end
      );
    if bad_count > 0 then raise exception 'One or more bins are not available for this request'; end if;
  elsif new.type = 'new_bins' then
    if new.quantity < 1 or new.quantity > 20 then raise exception 'Choose between 1 and 20 bins'; end if;
    -- Accounts start at 3 bins (owned + already on the way + this request)
    if (select count(*) from public.bins where owner_id = new.customer_id and kind = 'bin')
       + coalesce((select sum(quantity) from public.requests where customer_id = new.customer_id and type = 'new_bins'
                   and status in ('requested','scheduled','en_route')), 0)
       + new.quantity < 3 then
      raise exception 'Accounts start at 3 bins';
    end if;
  end if;

  if new.address is null then
    new.address := concat_ws(', ', p.address_line1, nullif(p.address_line2, ''), p.city, p.postal_code);
  end if;

  if new.type = 'delivery' and public.restricted() then
    if p.delivery_credits is null then
      new.used_credit := true;                          -- unlimited plan
    elsif p.delivery_credits > 0 then
      perform set_config('fraktion.internal', '1', true);
      update public.profiles set delivery_credits = delivery_credits - 1 where id = p.id;
      perform set_config('fraktion.internal', '', true);
      new.used_credit := true;
    else
      new.fee_cents := 999;                             -- $9.99 extra delivery
    end if;
  end if;
  return new;
end $$;
drop trigger if exists prepare_request on public.requests;
create trigger prepare_request before insert on public.requests
  for each row execute function public.prepare_request();

-- Customers can only cancel, and only before the request is scheduled.
-- Status changes by staff move bins along automatically.
create or replace function public.on_request_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.restricted() then
    if new.status <> 'cancelled' or old.status <> 'requested' then
      raise exception 'Only requests that are not yet scheduled can be cancelled';
    end if;
    new := old; new.status := 'cancelled';
  end if;

  -- Refund the delivery credit on cancellation
  if new.status = 'cancelled' and old.status <> 'cancelled' and old.used_credit then
    perform set_config('fraktion.internal', '1', true);
    update public.profiles set delivery_credits = delivery_credits + 1
      where id = old.customer_id and delivery_credits is not null;
    perform set_config('fraktion.internal', '', true);
  end if;

  if new.status = 'en_route' and old.status <> 'en_route' then
    update public.bins set status = case when new.type = 'delivery' then 'out_for_delivery' else 'to_warehouse' end
      where id = any(new.bin_ids);
  end if;

  if new.status = 'completed' and old.status <> 'completed' then
    if new.type = 'delivery' then
      update public.bins set status = 'with_customer' where id = any(new.bin_ids);
    elsif new.type = 'pickup' then
      update public.bins set status = 'stored' where id = any(new.bin_ids);
    elsif new.type = 'new_bins' then
      insert into public.bins (owner_id, label, status)
        select new.customer_id, 'New bin', 'with_customer' from generate_series(1, new.quantity);
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;
drop trigger if exists on_request_update on public.requests;
create trigger on_request_update before update on public.requests
  for each row execute function public.on_request_update();

-- Rental availability: how many units are free across a date range
create or replace function public.rental_available(p_item uuid, p_start date, p_end date) returns integer
language sql stable security definer set search_path = public as $$
  select greatest(0, i.quantity_total - coalesce((
    select max(booked) from (
      select d::date as day, sum(b.quantity) as booked
      from generate_series(p_start, p_end, interval '1 day') d
      join public.rental_bookings b
        on b.item_id = p_item and b.status <> 'cancelled' and d::date between b.start_date and b.end_date
      group by d
    ) t), 0))::integer
  from public.rental_items i where i.id = p_item;
$$;

create or replace function public.prepare_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  it public.rental_items;
  p public.profiles;
begin
  select * into it from public.rental_items where id = new.item_id;
  select * into p from public.profiles where id = new.customer_id;
  if not it.active then raise exception 'That item is not available yet'; end if;
  if new.start_date <= current_date then raise exception 'Rentals need at least one day of notice'; end if;
  if new.quantity > it.max_per_booking then raise exception 'Maximum % per booking', it.max_per_booking; end if;
  if public.rental_available(new.item_id, new.start_date, new.end_date) < new.quantity then
    raise exception 'Only % available for those dates', public.rental_available(new.item_id, new.start_date, new.end_date);
  end if;
  if public.restricted() then new.status := 'requested'; new.paid := false; end if;
  new.total_cents := it.price_cents_per_day * new.quantity * ((new.end_date - new.start_date) + 1);
  if new.address is null then
    new.address := concat_ws(', ', p.address_line1, nullif(p.address_line2, ''), p.city, p.postal_code);
  end if;
  return new;
end $$;
drop trigger if exists prepare_booking on public.rental_bookings;
create trigger prepare_booking before insert on public.rental_bookings
  for each row execute function public.prepare_booking();

create or replace function public.guard_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.restricted() then
    if new.status <> 'cancelled' or old.status <> 'requested' then
      raise exception 'Only unconfirmed bookings can be cancelled';
    end if;
    new := old; new.status := 'cancelled';
  end if;
  return new;
end $$;
drop trigger if exists guard_booking on public.rental_bookings;
create trigger guard_booking before update on public.rental_bookings
  for each row execute function public.guard_booking();

-- =====================================================================
-- Row level security — customers see only their own rows; staff see all
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.bins enable row level security;
alter table public.requests enable row level security;
alter table public.rental_items enable row level security;
alter table public.rental_bookings enable row level security;
alter table public.waitlist enable row level security;

drop policy if exists "profile read" on public.profiles;
drop policy if exists "profile update" on public.profiles;
create policy "profile read" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profile update" on public.profiles for update using (id = auth.uid() or public.is_admin());

drop policy if exists "bins read" on public.bins;
drop policy if exists "bins update" on public.bins;
drop policy if exists "bins admin insert" on public.bins;
drop policy if exists "bins admin delete" on public.bins;
create policy "bins read" on public.bins for select using (owner_id = auth.uid() or public.is_admin());
create policy "bins update" on public.bins for update using (owner_id = auth.uid() or public.is_admin());
create policy "bins admin insert" on public.bins for insert with check (public.is_admin());
create policy "bins admin delete" on public.bins for delete using (public.is_admin());

drop policy if exists "requests read" on public.requests;
drop policy if exists "requests insert" on public.requests;
drop policy if exists "requests update" on public.requests;
create policy "requests read" on public.requests for select using (customer_id = auth.uid() or public.is_admin());
create policy "requests insert" on public.requests for insert with check (customer_id = auth.uid() or public.is_admin());
create policy "requests update" on public.requests for update using (customer_id = auth.uid() or public.is_admin());

drop policy if exists "items read" on public.rental_items;
drop policy if exists "items admin" on public.rental_items;
create policy "items read" on public.rental_items for select using (true);
create policy "items admin" on public.rental_items for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "bookings read" on public.rental_bookings;
drop policy if exists "bookings insert" on public.rental_bookings;
drop policy if exists "bookings update" on public.rental_bookings;
create policy "bookings read" on public.rental_bookings for select using (customer_id = auth.uid() or public.is_admin());
create policy "bookings insert" on public.rental_bookings for insert with check (customer_id = auth.uid() or public.is_admin());
create policy "bookings update" on public.rental_bookings for update using (customer_id = auth.uid() or public.is_admin());

drop policy if exists "waitlist insert" on public.waitlist;
drop policy if exists "waitlist admin read" on public.waitlist;
create policy "waitlist insert" on public.waitlist for insert with check (true);
create policy "waitlist admin read" on public.waitlist for select using (public.is_admin());

grant execute on function public.rental_available(uuid, date, date) to anon, authenticated;

-- =====================================================================
-- Starter rental catalogue — edit prices and quantities any time
-- =====================================================================
insert into public.rental_items (slug, name, description, emoji, price_cents_per_day, quantity_total, max_per_booking, active, sort) values
  ('folding-table-6ft', '6 ft grey folding table', 'Seats 6–8. Sturdy, wipe-clean top. Great for birthdays, garage sales and holiday overflow.', '🪑', 2500, 6, 6, true, 1),
  ('folding-chair', 'Folding chair', 'Matching grey folding chairs. Pairs with the 6 ft table.', '💺', 300, 0, 40, false, 2),
  ('bounce-castle', 'Bounce castle', 'Delivered, set up and taken down by our crew.', '🏰', 6500, 0, 1, false, 3)
on conflict (slug) do nothing;

-- =====================================================================
-- Make yourself staff: sign up on the site first, then run
--   update public.profiles set is_admin = true where email = 'you@example.com';
-- =====================================================================

-- Price update (Nov 2026): tables are $25/day. Safe to re-run.
update public.rental_items set price_cents_per_day = 2500 where slug = 'folding-table-6ft' and price_cents_per_day = 1500;
