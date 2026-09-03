-- Lock down EXECUTE on admin_mark_resent_as_new.
--
-- Postgres grants EXECUTE to PUBLIC on a newly created function unless it is
-- revoked, and `create or replace` only preserves whatever the first CREATE
-- left behind. 20260903000032 introduced this function without the revoke/grant
-- block every other admin RPC carries, so it landed with PUBLIC and anon able
-- to call it, and 33 inherited that.
--
-- RLS on entries and audit_log still stood in the way, so this was a missing
-- layer rather than an open door — but the whole point of the pattern is that
-- the gate does not rest on RLS alone.

revoke execute on function admin_mark_resent_as_new(uuid[], text, text) from public;

do $$
begin
  revoke execute on function admin_mark_resent_as_new(uuid[], text, text) from anon;
  grant execute on function admin_mark_resent_as_new(uuid[], text, text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
