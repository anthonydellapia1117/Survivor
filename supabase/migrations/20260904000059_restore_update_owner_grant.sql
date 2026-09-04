-- Two defects in 20260904000058, both found by review and both reproduced.
--
-- 1. THE GRANT. Dropping the eight-argument admin_update_owner dropped its
--    grants with it. 58 re-applied the revokes and no grant, so the new
--    nine-argument function landed as {postgres=X,service_role=X} while every
--    sibling carries authenticated as well. The app holds no service-role key
--    by design and calls this RPC as the signed-in admin, so /admin owner edit
--    -- including the CC field 58 exists to add -- fails with "permission
--    denied for function admin_update_owner" in production. Confirmed against
--    the live database, not inferred.
--
--    This is the SECOND time the class has bitten: 20260903000034 exists
--    solely to restore a grant lost the same way. The suite only ever asserted
--    that PUBLIC and anon CANNOT call the admin family, never that the app's
--    own role still can, so both losses shipped green. tests/sql/05_admin_rpcs
--    now asserts the positive direction too, which is the part that actually
--    stops the next one.
--
-- 2. THE TRIM. `nullif(p_cc_email, '')` treats only the empty string as "none",
--    while ccAddress in src/lib/emails/pick-request.ts uses JS trim(). A CC of
--    " " therefore stored as a non-null value that every SQL reader counts as
--    a second contact and the generator silently drops. Same app-vs-RPC drift
--    that 20260903000035 introduced trim_name_ws to end, so use trim_name_ws:
--    it spells out the ECMAScript whitespace set, so the two layers agree by
--    construction rather than by coincidence.
--
--    p_email and p_phone keep their existing plain nullif. The drift is real
--    there too -- buildPickRequests trims the address it mails -- but that is
--    pre-existing behaviour on columns this change does not touch, and
--    widening the fix would rewrite how every owner's address normalises on
--    their next save. Noted, deliberately not bundled.

create or replace function admin_update_owner(
  p_owner_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_cc_email text,
  p_phone text,
  p_participation_status text,
  p_notes text,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select to_jsonb(o) - 'created_at' - 'updated_at' into v_before from owners o where id = p_owner_id;
  if v_before is null then
    raise exception 'owner % not found', p_owner_id;
  end if;

  update owners
     set first_name = p_first_name,
         last_name = p_last_name,
         email = nullif(p_email, ''),
         -- trim_name_ws, not nullif alone: the app decides whether to emit a
         -- Cc with JS trim(), and a value only one layer calls blank is a
         -- contact the database thinks exists and the mail never reaches.
         cc_email = nullif(trim_name_ws(p_cc_email), ''),
         phone = nullif(p_phone, ''),
         participation_status = p_participation_status,
         notes = nullif(p_notes, ''),
         updated_at = now()
   where id = p_owner_id;

  select to_jsonb(o) - 'created_at' - 'updated_at' into v_after from owners o where id = p_owner_id;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'update_owner', 'owners', p_owner_id::text, v_before, v_after);
end $$;

-- Restore the full gate: PUBLIC and anon out, the app's role in. `create or
-- replace` above preserved the ACL, which is exactly the problem -- it
-- preserved the one 58 left incomplete.
revoke execute on function
  admin_update_owner(uuid,text,text,text,text,text,text,text,text) from public;

do $$
begin
  revoke execute on function
    admin_update_owner(uuid,text,text,text,text,text,text,text,text) from anon;
  grant execute on function
    admin_update_owner(uuid,text,text,text,text,text,text,text,text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;

-- Any owner whose cc_email is already whitespace-only was stored before the
-- trim went in. There are none today; this is here so replaying the
-- migrations onto a database that has some converges on the same state.
update owners
   set cc_email = null
 where cc_email is not null
   and trim_name_ws(cc_email) = '';
