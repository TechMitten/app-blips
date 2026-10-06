-- Free plan: a number of prompts per day (a Build or Ask message counts as
-- one, however many model requests it takes), on top of the token
-- allowance, which stays as a hidden backstop. Prompts are counted in the
-- usage table next to the token counters.

alter table public.usage add column if not exists builder_prompts bigint not null default 0;

-- Takes one prompt from today's allowance, atomically: the conditional
-- UPDATE row-locks, so prompts sent at the same moment can't both slip in
-- under the limit. Returns false once the limit is reached.
create or replace function public.claim_prompt(target_user_id uuid, usage_date date, prompt_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.usage (user_id, date) values (target_user_id, usage_date)
  on conflict (user_id, date) do nothing;
  update public.usage
     set builder_prompts = builder_prompts + 1, updated_at = now()
   where user_id = target_user_id and date = usage_date and builder_prompts < prompt_limit;
  return found;
end $$;

-- Gives a prompt back when it never got going (the AI provider refused or
-- failed on its first request), so a failure on our side doesn't cost one.
create or replace function public.release_prompt(target_user_id uuid, usage_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.usage
     set builder_prompts = greatest(builder_prompts - 1, 0), updated_at = now()
   where user_id = target_user_id and date = usage_date;
end $$;

revoke execute on function public.claim_prompt(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.claim_prompt(uuid, date, integer) to service_role;
revoke execute on function public.release_prompt(uuid, date) from public, anon, authenticated;
grant execute on function public.release_prompt(uuid, date) to service_role;

-- billing_status gains today's prompt count. Its result columns change, so
-- it has to be dropped and recreated rather than replaced.
drop function if exists public.billing_status(uuid);

create function public.billing_status(target_user_id uuid)
returns table (
  plan text,
  status text,
  period_start date,
  period_end timestamptz,
  cancel_at_period_end boolean,
  today_tokens bigint,
  period_tokens bigint,
  today_prompts bigint
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
              where u.user_id = target_user_id and u.date >= start_date), 0)::bigint,
    coalesce((select u.builder_prompts from public.usage u
              where u.user_id = target_user_id and u.date = today), 0)::bigint;
end $$;

revoke execute on function public.billing_status(uuid) from public, anon, authenticated;
grant execute on function public.billing_status(uuid) to service_role;
