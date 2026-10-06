-- rls_auto_enable() is a helper Supabase creates in hosted projects (it is
-- not defined by these migrations). It is SECURITY DEFINER, so nobody but the
-- platform should be able to call it. Guarded because a local stack may not
-- have it.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
