-- The app's server acts as the signed-in admin (authenticated role) instead
-- of holding a service-role key. The admin_* functions run with INVOKER
-- rights, so every table access inside them still passes through RLS —
-- a non-admin authenticated caller fails at the is_admin() policies.
-- anon and public stay revoked.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'admin_create_owner(text,text,text,text,text,text,text[],boolean,text)',
    'admin_update_owner(uuid,text,text,text,text,text,text,text)',
    'admin_add_entries(uuid,text[],boolean,boolean,text)',
    'admin_update_entry(uuid,text,text,boolean,text)',
    'admin_remove_entry(uuid,text)',
    'admin_void_entry(uuid,text)',
    'admin_record_payment(uuid,int,text,date,text,text,uuid,text)',
    'admin_submit_pick(uuid,int,text,text,text)',
    'admin_set_result(uuid,int,text,text,text)',
    'admin_deadline_sweep(int,boolean,text)',
    'admin_apply_lynne_import(int,text,text,jsonb,int,int,jsonb,jsonb,jsonb,text)'
  ] loop
    begin
      execute format('grant execute on function %s to authenticated', fn);
    exception when undefined_object then
      null; -- role absent outside supabase-shaped databases
    end;
  end loop;
end $$;

-- The admin reads v_owner_finance through the authenticated role; keep anon
-- revoked (it was revoked in 0003) and make the authenticated grant explicit.
grant select on v_owner_finance to authenticated;
