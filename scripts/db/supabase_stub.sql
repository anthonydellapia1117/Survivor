-- Local-test stand-ins for the pieces Supabase provides in production.
-- Applied only by scripts/db/test-db.sh, never in a real migration.

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;

-- Mirrors supabase's auth.jwt(): claims come from request.jwt.claims.
create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant select on tables to anon, authenticated;
