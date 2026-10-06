-- Stripe can send events for an old, cancelled subscription after a new one
-- is active (resubscribing, out-of-order retries). Without this guard the
-- stale event overwrote the user's row and dropped them to a cancelled plan.
-- A row is now only replaced by the same subscription, by an active one, or
-- when the current row isn't active anyway.
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
