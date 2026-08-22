-- Row-level security (spec 2.4).
-- Public (anon) may read entries, picks, weeks, and Lynne import metadata.
-- Payments, owner contact info, config, and the audit log are admin-only.
-- The server's service-role key bypasses RLS for trusted route handlers.

-- The admin identity. The app.admin_email GUC wins when set; the literal
-- fallback matches the ADMIN_EMAIL env var (hosted roles cannot ALTER DATABASE).
create or replace function is_admin() returns boolean
language sql stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') <> ''
     and auth.jwt() ->> 'email' = coalesce(
           nullif(current_setting('app.admin_email', true), ''),
           'anthonydellapia@gmail.com'
         )
$$;

alter table owners enable row level security;
alter table entries enable row level security;
alter table picks enable row level security;
alter table payments enable row level security;
alter table weeks enable row level security;
alter table config enable row level security;
alter table audit_log enable row level security;
alter table lynne_imports enable row level security;

-- Public read: entries, picks, weeks, lynne imports. NOT payments, NOT owner emails or phones.
create policy public_read_entries on entries for select using (true);
create policy public_read_picks on picks for select using (true);
create policy public_read_weeks on weeks for select using (true);
create policy public_read_lynne_imports on lynne_imports for select using (true);

-- Admin: everything.
create policy admin_all_owners on owners for all using (is_admin()) with check (is_admin());
create policy admin_write_entries on entries for all using (is_admin()) with check (is_admin());
create policy admin_write_picks on picks for all using (is_admin()) with check (is_admin());
create policy admin_all_payments on payments for all using (is_admin()) with check (is_admin());
create policy admin_write_weeks on weeks for all using (is_admin()) with check (is_admin());
create policy admin_all_config on config for all using (is_admin()) with check (is_admin());
create policy admin_all_audit on audit_log for all using (is_admin()) with check (is_admin());
create policy admin_write_lynne_imports on lynne_imports for all using (is_admin()) with check (is_admin());

-- Owner rows are never publicly readable; the public path is v_public_owners
-- (id + name only). Owner financials are admin/server-only.
revoke select on v_owner_finance from anon;
