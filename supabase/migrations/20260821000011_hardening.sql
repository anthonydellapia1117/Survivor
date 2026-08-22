-- Security hardening from the Supabase advisors.
--
-- Views: v_owner_finance carried per-owner money readable by ANY
-- authenticated user (signups are open by default). security_invoker makes
-- RLS govern it — non-admins see zero rows, the admin sees everything, and
-- v_pot (definer) still serves anon the public aggregates through it.
-- v_grid_cells / v_entry_standing likewise inherit their tables' policies.
-- v_public_owners, v_entry_public, and v_pot REMAIN definer on purpose:
-- they are the deliberate public projections over admin-only tables.
alter view v_owner_finance set (security_invoker = on);
alter view v_grid_cells set (security_invoker = on);
alter view v_entry_standing set (security_invoker = on);

-- Functions: pin search_path (advisor 0011).
alter function is_admin() set search_path = public, pg_temp;
alter function admin_create_owner(text,text,text,text,text,text,text[],boolean,text) set search_path = public, pg_temp;
alter function admin_update_owner(uuid,text,text,text,text,text,text,text) set search_path = public, pg_temp;
alter function admin_add_entries(uuid,text[],boolean,boolean,text) set search_path = public, pg_temp;
alter function admin_update_entry(uuid,text,text,boolean,text) set search_path = public, pg_temp;
alter function admin_remove_entry(uuid,text) set search_path = public, pg_temp;
alter function admin_void_entry(uuid,text) set search_path = public, pg_temp;
alter function admin_record_payment(uuid,int,text,date,text,text,uuid,text) set search_path = public, pg_temp;
alter function admin_submit_pick(uuid,int,text,text,text) set search_path = public, pg_temp;
alter function admin_set_result(uuid,int,text,text,text) set search_path = public, pg_temp;
alter function admin_deadline_sweep(int,boolean,text) set search_path = public, pg_temp;
alter function admin_apply_lynne_import(int,text,text,jsonb,int,int,jsonb,jsonb,jsonb,text) set search_path = public, pg_temp;
