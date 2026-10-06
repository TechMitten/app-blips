-- Token reservations: the LLM proxy used to read usage, compare it with the
-- plan's allowance, and record the request's tokens only once its response
-- had finished (the deployed-app AI relay didn't compare at all). Requests sent at the same moment all read the same total, so
-- a script could run any number of them past the limit. Now each billed
-- request reserves an estimate first (checked and added in one locked step)
-- and settles it to the real count when the response ends. A reservation
-- that never settles (the worker died) stays charged at its estimate.

-- Checks the allowance and, if it isn't used up, adds `amount` to today's
-- builder or deployed tokens (`usage_kind`, as in record_usage). The limits
-- come from functions/_lib/plans.js (already including any build overdraft);
-- null means the plan has no such limit.
-- Locking today's row serializes reservations for the account, so each one
-- sees the others'. Returns whether it reserved, and the totals it compared.
create or replace function public.reserve_tokens(
  target_user_id uuid, usage_date date, period_start date,
  daily_limit bigint, period_limit bigint, amount bigint, usage_kind text default 'builder'
)
returns table (reserved boolean, today_tokens bigint, period_tokens bigint)
language plpgsql security definer set search_path = public as $$
declare
  today_used bigint;
  period_used bigint;
begin
  if usage_kind not in ('builder', 'deployed') then raise exception 'Invalid usage kind'; end if;
  insert into public.usage (user_id, date) values (target_user_id, usage_date)
  on conflict (user_id, date) do nothing;
  select u.builder_tokens + u.deployed_tokens into today_used from public.usage u
   where u.user_id = target_user_id and u.date = usage_date
   for update;
  select coalesce(sum(u.builder_tokens + u.deployed_tokens), 0) into period_used from public.usage u
   where u.user_id = target_user_id and u.date >= period_start;

  if (daily_limit is not null and today_used >= daily_limit)
     or (period_limit is not null and period_used >= period_limit) then
    return query select false, today_used, period_used;
    return;
  end if;

  update public.usage
     set builder_tokens = builder_tokens + case when usage_kind = 'builder' then greatest(amount, 0) else 0 end,
         deployed_tokens = deployed_tokens + case when usage_kind = 'deployed' then greatest(amount, 0) else 0 end,
         updated_at = now()
   where user_id = target_user_id and date = usage_date;
  return query select true, today_used + greatest(amount, 0), period_used + greatest(amount, 0);
end $$;

-- Replaces a reservation with what the request actually used, on the day it
-- was reserved, and records the request like record_usage does.
create or replace function public.settle_usage(
  target_user_id uuid, usage_date date, reserved bigint, token_count bigint,
  cost bigint default 0, cached bigint default 0, usage_kind text default 'builder'
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if usage_kind not in ('builder', 'deployed') then raise exception 'Invalid usage kind'; end if;
  update public.usage
     set builder_requests = builder_requests + case when usage_kind = 'builder' then 1 else 0 end,
         deployed_requests = deployed_requests + case when usage_kind = 'deployed' then 1 else 0 end,
         builder_tokens = case when usage_kind = 'builder'
           then greatest(builder_tokens - greatest(reserved, 0) + greatest(token_count, 0), 0) else builder_tokens end,
         deployed_tokens = case when usage_kind = 'deployed'
           then greatest(deployed_tokens - greatest(reserved, 0) + greatest(token_count, 0), 0) else deployed_tokens end,
         cost_micros = cost_micros + greatest(cost, 0),
         cached_tokens = cached_tokens + greatest(cached, 0),
         updated_at = now()
   where user_id = target_user_id and date = usage_date;
end $$;

revoke execute on function public.reserve_tokens(uuid, date, date, bigint, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.reserve_tokens(uuid, date, date, bigint, bigint, bigint, text) to service_role;
revoke execute on function public.settle_usage(uuid, date, bigint, bigint, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.settle_usage(uuid, date, bigint, bigint, bigint, bigint, text) to service_role;
