-- What each account's requests actually cost us, next to the token counters,
-- so the operator dashboard can show margin per plan instead of raw tokens.
-- Observability only: allowances stay in tokens (see functions/_lib/plans.js).
--
-- cost_micros is the provider's reported cost in millionths of a dollar
-- (OpenRouter's usage.cost); providers that don't report it leave it at 0.
-- It's recorded even for responses that weren't charged to the allowance
-- (a provider error mid-stream), because the provider may still bill us.
-- cached_tokens is the part of the input served from the provider's prompt
-- cache, which is billed at a fraction of the normal input price.

alter table public.usage add column if not exists cost_micros bigint not null default 0;
alter table public.usage add column if not exists cached_tokens bigint not null default 0;

-- A new function rather than a changed increment_usage: changing its
-- arguments would mean dropping it, and code still deployed when this runs
-- calls the old signature. increment_usage stays until nothing calls it.
create or replace function public.record_usage(
  target_user_id uuid, usage_date date, usage_kind text, token_count bigint default 0,
  cost bigint default 0, cached bigint default 0
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if usage_kind not in ('builder', 'deployed') then raise exception 'Invalid usage kind'; end if;
  insert into public.usage(user_id, date, builder_requests, deployed_requests, builder_tokens, deployed_tokens, cost_micros, cached_tokens)
  values (
    target_user_id, usage_date,
    case when usage_kind = 'builder' then 1 else 0 end,
    case when usage_kind = 'deployed' then 1 else 0 end,
    case when usage_kind = 'builder' then greatest(token_count, 0) else 0 end,
    case when usage_kind = 'deployed' then greatest(token_count, 0) else 0 end,
    greatest(cost, 0),
    greatest(cached, 0)
  )
  on conflict (user_id, date) do update set
    builder_requests = usage.builder_requests + case when usage_kind = 'builder' then 1 else 0 end,
    deployed_requests = usage.deployed_requests + case when usage_kind = 'deployed' then 1 else 0 end,
    builder_tokens = usage.builder_tokens + case when usage_kind = 'builder' then greatest(token_count, 0) else 0 end,
    deployed_tokens = usage.deployed_tokens + case when usage_kind = 'deployed' then greatest(token_count, 0) else 0 end,
    cost_micros = usage.cost_micros + greatest(cost, 0),
    cached_tokens = usage.cached_tokens + greatest(cached, 0),
    updated_at = now();
end $$;

revoke execute on function public.record_usage(uuid, date, text, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_usage(uuid, date, text, bigint, bigint, bigint) to service_role;

-- The initial schema grants this, but the live project had lost it, which
-- broke the operator dashboard (npm run usage). Re-stated so it holds.
grant select on public.usage to service_role;
