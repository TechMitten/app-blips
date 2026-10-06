-- Billing: which plan each account is on, kept in sync with Stripe by the
-- webhook (functions/_lib/billing.js), plus one read the LLM proxy makes
-- before a build to compare usage against the plan's allowance.
--
-- Stripe is the source of truth for who pays; this table is a cache of it.
-- No row (or a cancelled subscription) means the free plan. Only the server
-- writes here, through upsert_subscription (service_role only); a signed-in
-- user can read their own row to show their plan.

create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'plus', 'pro')),
  -- Stripe's subscription status (active, trialing, past_due, canceled, ...).
  status text not null default 'none',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "read own subscription" on public.subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.subscriptions to authenticated, service_role;

-- Called by the Stripe webhook with the subscription's latest state (re-read
-- from Stripe, so out-of-order events can't leave a stale plan behind).
create or replace function public.upsert_subscription(
  target_user_id uuid,
  new_plan text,
  new_status text,
  customer_id text,
  subscription_id text,
  period_start timestamptz,
  period_end timestamptz,
  cancels_at_period_end boolean
)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions as s (
    user_id, plan, status, stripe_customer_id, stripe_subscription_id,
    current_period_start, current_period_end, cancel_at_period_end, updated_at
  ) values (
    target_user_id, new_plan, new_status, customer_id, subscription_id,
    period_start, period_end, coalesce(cancels_at_period_end, false), now()
  )
  on conflict (user_id) do update set
    plan = excluded.plan,
    status = excluded.status,
    stripe_customer_id = coalesce(excluded.stripe_customer_id, s.stripe_customer_id),
    stripe_subscription_id = excluded.stripe_subscription_id,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    updated_at = now()
  where
    s.stripe_subscription_id = excluded.stripe_subscription_id
    or excluded.status in ('active', 'trialing', 'past_due')
    or s.status not in ('active', 'trialing', 'past_due');
end $$;

revoke execute on function public.upsert_subscription(uuid, text, text, text, text, timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.upsert_subscription(uuid, text, text, text, text, timestamptz, timestamptz, boolean) to service_role;

-- The plan in effect and the tokens used against it, in one round trip.
-- A paid plan counts from the start of its Stripe billing period; the free
-- plan counts per UTC calendar month (its daily cap uses today_tokens).
-- Builder and deployed-app AI both draw on the account owner's allowance.
create or replace function public.billing_status(target_user_id uuid)
returns table (
  plan text,
  status text,
  period_start date,
  period_end timestamptz,
  cancel_at_period_end boolean,
  today_tokens bigint,
  period_tokens bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  sub public.subscriptions%rowtype;
  today date := (now() at time zone 'utc')::date;
  effective_plan text := 'free';
  start_date date := date_trunc('month', now() at time zone 'utc')::date;
begin
  select * into sub from public.subscriptions s where s.user_id = target_user_id;
  -- past_due keeps the plan while Stripe retries the card; anything else
  -- (canceled, unpaid, incomplete) falls back to free.
  if found and sub.status in ('active', 'trialing', 'past_due') and sub.plan <> 'free' then
    effective_plan := sub.plan;
    if sub.current_period_start is not null then
      start_date := (sub.current_period_start at time zone 'utc')::date;
    end if;
  end if;

  return query
  select
    effective_plan,
    coalesce(sub.status, 'none'),
    start_date,
    case when effective_plan = 'free' then null else sub.current_period_end end,
    coalesce(sub.cancel_at_period_end, false),
    coalesce((select u.builder_tokens + u.deployed_tokens from public.usage u
              where u.user_id = target_user_id and u.date = today), 0)::bigint,
    coalesce((select sum(u.builder_tokens + u.deployed_tokens) from public.usage u
              where u.user_id = target_user_id and u.date >= start_date), 0)::bigint;
end $$;

revoke execute on function public.billing_status(uuid) from public, anon, authenticated;
grant execute on function public.billing_status(uuid) to service_role;
