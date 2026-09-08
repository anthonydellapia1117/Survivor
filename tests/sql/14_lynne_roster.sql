-- lynne_roster (20260908214000): her master sheet as a read-only reference,
-- and admin_load_lynne_roster, its only write path. Everything here rolls
-- back.
--
-- What is asserted, and why each block fails without the migration:
--   * the table exists with RLS on and no write policy;
--   * anon has no privilege on it and cannot call the RPC;
--   * a signed-in NON-admin is refused by the RPC and sees zero rows;
--   * the admin cannot write the table directly - the RPC is the only path;
--   * a load writes every row verbatim (trailing space and her spelling
--     kept), the filled week cells, and one audit row, in one transaction;
--   * duplicate names are kept as separate rows, one per NO., never merged;
--   * the same sha256 cannot be loaded twice; a payload that repeats a NO.,
--     lacks a names text, or is not an array is refused with nothing written;
--   * loading creates no owner and no entry.
--
-- Runs through scripts/db/test-db.sh like the other suites.

begin;

-- ------------------------------------------------------------ shape
do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'lynne_roster') then
    raise exception 'lynne_roster table missing';
  end if;
  if not (select relrowsecurity from pg_class where relname = 'lynne_roster') then
    raise exception 'lynne_roster must have RLS enabled';
  end if;
  if exists (select 1 from pg_policies where tablename = 'lynne_roster' and cmd <> 'SELECT') then
    raise exception 'lynne_roster must have no write policy - the RPC is the only write path';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'lynne_roster'
                  and cmd = 'SELECT' and qual like '%is_admin()%') then
    raise exception 'lynne_roster select policy must be gated by is_admin()';
  end if;
  if not exists (select 1 from pg_proc where proname = 'admin_load_lynne_roster') then
    raise exception 'admin_load_lynne_roster missing';
  end if;
end $$;

create temp table _lr (k text primary key, v text) on commit drop;
grant select, insert on _lr to anon, authenticated;

-- ------------------------------------------------------------ anon: nothing
set local role anon;
do $$
begin
  begin
    perform admin_load_lynne_roster(repeat('a', 64), 'x.xlsx', null, '[{"no":1,"names":"a","row":2}]'::jsonb, 'anon');
    raise exception 'anon must not be able to call admin_load_lynne_roster';
  exception
    when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ------------------------------------------------------------ non-admin: refused, sees nothing
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', true);
do $$
declare v_n int;
begin
  begin
    perform admin_load_lynne_roster(repeat('a', 64), 'x.xlsx', null, '[{"no":1,"names":"a","row":2}]'::jsonb, 'stranger');
    raise exception 'a non-admin must be refused by admin_load_lynne_roster';
  exception
    when insufficient_privilege then null;
  end;
  select count(*) into v_n from lynne_roster;
  if v_n <> 0 then
    raise exception 'a non-admin must see no lynne_roster rows, saw %', v_n;
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ------------------------------------------------------------ admin
select set_config('app.admin_email', 'admin@test.local', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"admin@test.local"}', true);

-- The admin cannot write the table directly.
do $$
begin
  begin
    insert into lynne_roster (sheet_sha256, row_no, names, row_index, source_file, loaded_by)
    values (repeat('b', 64), 1, 'direct', 2, 'x.xlsx', 'admin');
    raise exception 'the admin must not be able to insert into lynne_roster directly';
  exception
    when insufficient_privilege then null;
  end;
end $$;

-- A load: verbatim names, duplicate names kept, cells carried, one audit row, no owner or entry created.
do $$
declare
  v_sha constant text := repeat('c', 64);
  v_res jsonb;
  v_owners_before int; v_entries_before int; v_audit_before int;
  v_n int;
  v_names text;
  v_cells jsonb;
begin
  select count(*) into v_owners_before from owners;
  select count(*) into v_entries_before from entries;
  select count(*) into v_audit_before from audit_log;

  v_res := admin_load_lynne_roster(v_sha, 'Football test.xlsx', 'msg123',
    '[{"no":674,"names":"Ian Lubin 1","row":2,"cells":{"Week 1":"Dallas"}},
      {"no":675,"names":"Ian Lubin 2","row":3},
      {"no":983,"names":"Adriana Flacco ","row":4},
      {"no":1089,"names":"Andrew Dicicco #1","row":5,"cells":{"Week 1":"OUT"}},
      {"no":1319,"names":"Ian Lubin 1","row":6},
      {"no":1320,"names":"Ian Lubin 2","row":7}]'::jsonb,
    'admin@test.local');

  if (v_res->>'rows')::int <> 6 then raise exception 'expected 6 rows loaded, got %', v_res->>'rows'; end if;
  if (v_res->>'duplicate_names')::int <> 2 then raise exception 'expected 2 duplicate names, got %', v_res->>'duplicate_names'; end if;

  select count(*) into v_n from lynne_roster where sheet_sha256 = v_sha;
  if v_n <> 6 then raise exception 'expected 6 rows in the table, found %', v_n; end if;
  select names into v_names from lynne_roster where sheet_sha256 = v_sha and row_no = 983;
  if v_names <> 'Adriana Flacco ' then raise exception 'names must be verbatim, trailing space kept; got %', quote_literal(v_names); end if;
  select names into v_names from lynne_roster where sheet_sha256 = v_sha and row_no = 1089;
  if v_names <> 'Andrew Dicicco #1' then raise exception 'her spelling must be kept; got %', v_names; end if;
  select count(*) into v_n from lynne_roster where sheet_sha256 = v_sha and names = 'Ian Lubin 1';
  if v_n <> 2 then raise exception 'duplicate names must stay two rows, found %', v_n; end if;
  select cells into v_cells from lynne_roster where sheet_sha256 = v_sha and row_no = 674;
  if v_cells->>'Week 1' <> 'Dallas' then raise exception 'week cells must be carried; got %', v_cells; end if;
  select cells into v_cells from lynne_roster where sheet_sha256 = v_sha and row_no = 675;
  if v_cells <> '{}'::jsonb then raise exception 'an empty row must carry no cells; got %', v_cells; end if;
  if (select gmail_message_id from lynne_roster where sheet_sha256 = v_sha and row_no = 674) <> 'msg123' then
    raise exception 'gmail_message_id must be carried';
  end if;

  select count(*) into v_n from audit_log;
  if v_n <> v_audit_before + 1 then raise exception 'expected exactly one audit row, got %', v_n - v_audit_before; end if;
  if not exists (select 1 from audit_log where action = 'load_lynne_roster' and target_id = v_sha
                   and (after->>'rows')::int = 6 and (after->>'duplicate_names')::int = 2) then
    raise exception 'the audit row must carry the sheet sha256, the row count and the duplicate count';
  end if;

  select count(*) into v_n from owners;
  if v_n <> v_owners_before then raise exception 'loading the roster must create no owner'; end if;
  select count(*) into v_n from entries;
  if v_n <> v_entries_before then raise exception 'loading the roster must create no entry'; end if;

  -- The same sha256 again: refused, nothing written.
  begin
    perform admin_load_lynne_roster(v_sha, 'Football test.xlsx', null, '[{"no":1,"names":"a","row":2}]'::jsonb, 'admin@test.local');
    raise exception 'a second load of the same sha256 must be refused';
  exception
    when raise_exception then
      if sqlerrm not like '%already loaded%' then raise; end if;
  end;
  select count(*) into v_n from lynne_roster where sheet_sha256 = v_sha;
  if v_n <> 6 then raise exception 'the refused second load must write nothing'; end if;
end $$;

-- Refusals that write nothing: a repeated NO., a row with no names, a payload that is not an array.
do $$
declare
  v_before int;
begin
  select count(*) into v_before from lynne_roster;
  begin
    perform admin_load_lynne_roster(repeat('d', 64), 'x.xlsx', null,
      '[{"no":7,"names":"a","row":2},{"no":7,"names":"b","row":3}]'::jsonb, 'admin@test.local');
    raise exception 'a payload that repeats a NO. must be refused';
  exception when raise_exception then
    if sqlerrm not like '%repeats a NO.%' then raise; end if;
  end;
  begin
    perform admin_load_lynne_roster(repeat('e', 64), 'x.xlsx', null,
      '[{"no":8,"names":"","row":2}]'::jsonb, 'admin@test.local');
    raise exception 'a row with no names text must be refused';
  exception when raise_exception then
    if sqlerrm not like '%lack an integer no, a names text%' then raise; end if;
  end;
  begin
    perform admin_load_lynne_roster(repeat('f', 64), 'x.xlsx', null, '{"no":1}'::jsonb, 'admin@test.local');
    raise exception 'a payload that is not an array must be refused';
  exception when raise_exception then
    if sqlerrm not like '%non-empty json array%' then raise; end if;
  end;
  begin
    perform admin_load_lynne_roster('not-a-sha', 'x.xlsx', null, '[{"no":1,"names":"a","row":2}]'::jsonb, 'admin@test.local');
    raise exception 'a malformed sha256 must be refused';
  exception when raise_exception then
    if sqlerrm not like '%64 lowercase hex%' then raise; end if;
  end;
  if (select count(*) from lynne_roster) <> v_before then
    raise exception 'a refused load must write nothing';
  end if;
end $$;

rollback;
