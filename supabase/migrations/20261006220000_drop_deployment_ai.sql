-- AI inside generated apps is retired: deployed apps no longer get an AI
-- bridge and the /ai/* relays are gone, so the per-deployment AI switch and
-- token have nothing left to do. Dropping ai_token also ends its public
-- readability. The usage table's deployed_* counters stay as history.
alter table public.deployments
  drop column if exists ai_enabled,
  drop column if exists ai_token,
  drop column if exists ai_token_generation;
