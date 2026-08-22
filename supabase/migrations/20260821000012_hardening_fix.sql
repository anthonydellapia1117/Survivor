-- The invoker switch on v_owner_finance / v_entry_standing broke the
-- definer views built on top of them (a nested security_invoker view checks
-- the ORIGINAL caller, so anon's v_pot aggregated zero rows). Correct
-- construction: keep the derived views definer (their public consumers are
-- the deliberate boundary), close the authenticated-user leak by revoking
-- direct access to v_owner_finance and exposing a JWT-filtered admin view.

alter view v_owner_finance set (security_invoker = off);
alter view v_entry_standing set (security_invoker = off);
-- v_grid_cells stays invoker: picks are public via RLS, output identical.

do $$
begin
  execute 'revoke select on v_owner_finance from authenticated';
exception when undefined_object then
  null; -- role absent outside supabase-shaped databases
end $$;

-- Admin read path: definer over the finance view, rows only for the admin JWT.
create view v_owner_finance_admin as
select * from v_owner_finance where is_admin();

do $$
begin
  execute 'revoke select on v_owner_finance_admin from anon';
  execute 'grant select on v_owner_finance_admin to authenticated';
exception when undefined_object then
  null;
end $$;
