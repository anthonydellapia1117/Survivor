-- Master List (20260908224500): her four figures through admin_set_pool_pot,
-- and v_master_list as the public read of the newest sheet. Everything here
-- rolls back.
--
-- What is asserted, and why each block fails without the migration:
--   * v_pot carries pool_free_count and pool_paid_count and still no money;
--   * the five-argument setter stores her figures as given, audits them, and
--     refuses a triple that does not add up with nothing changed;
--   * v_master_list has exactly five columns and none of the table's
--     provenance columns;
--   * it returns the NEWEST sheet only, every row, with entry_id set for a
--     row whose NO. is a live entry of ours and null otherwise;
--   * anon reads it while lynne_roster itself stays closed to anon.

begin;

-- ------------------------------------------------------------ v_pot shape
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'v_pot'
     and column_name in ('pool_free_count', 'pool_paid_count');
  if n <> 2 then raise exception 'v_pot must carry pool_free_count and pool_paid_count, found %', n; end if;
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'v_pot'
     and column_name ~ 'due|paid_cents|collected|amount|owed|remit|margin';
  if n <> 0 then raise exception 'v_pot carries a money column'; end if;
end $$;

-- --------------------------------------------------- her figures, as given
do $$
declare r record; n int; v_after jsonb;
begin
  perform admin_set_pool_pot(1318, 46, 1272, 2862000, 'test');
  select * into r from v_pot;
  if r.pool_entry_count <> 1318 or r.pool_free_count <> 46 or r.pool_paid_count <> 1272 or r.pool_pot_cents <> 2862000 then
    raise exception 'pool figures did not save: % / % / % / %', r.pool_entry_count, r.pool_free_count, r.pool_paid_count, r.pool_pot_cents;
  end if;
  select after into v_after from audit_log where action = 'set_pool_pot' order by id desc limit 1;
  if (v_after->>'pool_free_count')::int <> 46 or (v_after->>'pool_paid_count')::int <> 1272 then
    raise exception 'set_pool_pot audit must carry her two counts: %', v_after;
  end if;

  -- A triple that does not add up is refused and nothing moves.
  begin
    perform admin_set_pool_pot(1318, 40, 1272, 2862000, 'test');
    raise exception 'REFUSAL MISSING: a triple that fails the sum check was accepted';
  exception when raise_exception then
    if sqlerrm not like '%do not add up%' then raise; end if;
  end;
  select * into r from v_pot;
  if r.pool_free_count <> 46 then raise exception 'a refused save must change nothing, free is now %', r.pool_free_count; end if;

  -- Partial figures are fine: only the total and the pot, as before.
  perform admin_set_pool_pot(1318, null, null, 2862000, 'test');
  select * into r from v_pot;
  if r.pool_free_count is not null or r.pool_paid_count is not null then
    raise exception 'null counts must clear';
  end if;

  -- Her two counts refuse a negative like the others do.
  begin
    perform admin_set_pool_pot(1318, -1, 1319, 2862000, 'test');
    raise exception 'REFUSAL MISSING: a negative free count was accepted';
  exception when raise_exception then
    if sqlerrm not like '%cannot be negative%' then raise; end if;
  end;
  begin
    perform admin_set_pool_pot(1318, 1319, -1, 2862000, 'test');
    raise exception 'REFUSAL MISSING: a negative paid count was accepted';
  exception when raise_exception then
    if sqlerrm not like '%cannot be negative%' then raise; end if;
  end;

  -- The old three-argument form is gone: one signature, no PostgREST ambiguity.
  select count(*) into n from pg_proc where proname = 'admin_set_pool_pot';
  if n <> 1 then raise exception 'expected exactly one admin_set_pool_pot, found %', n; end if;
end $$;

-- --------------------------------------------------- v_master_list shape
do $$
declare n int; v_cols text;
begin
  select string_agg(column_name, ',' order by ordinal_position) into v_cols
    from information_schema.columns where table_schema = 'public' and table_name = 'v_master_list';
  if v_cols <> 'row_no,names,cells,sheet_loaded_at,entry_id' then
    raise exception 'v_master_list columns must be exactly row_no,names,cells,sheet_loaded_at,entry_id; got %', v_cols;
  end if;
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'v_master_list'
     and column_name ~ 'sha|source_file|gmail|loaded_by';
  if n <> 0 then raise exception 'v_master_list exposes a provenance column'; end if;
end $$;

-- ------------------------------------------ newest sheet only, ours marked
select set_config('app.admin_email', 'admin@test.local', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"admin@test.local"}', true);
select admin_load_lynne_roster(repeat('a', 64), 'older.xlsx', null,
  '[{"no":1,"names":"Old One","row":2},{"no":983,"names":"Old 983","row":3}]'::jsonb, 'admin@test.local');
select admin_load_lynne_roster(repeat('b', 64), 'newer.xlsx', null,
  '[{"no":1,"names":"Lynne P","row":2},{"no":983,"names":"Adriana Flacco ","row":3,"cells":{"Week 1":"Dallas"}},{"no":1319,"names":"Ian Lubin 1","row":4}]'::jsonb, 'admin@test.local');
reset role;
select set_config('request.jwt.claims', '', true);

-- Both loads share one transaction clock; the older sheet is dated back so
-- "newest" has something to choose between.
update lynne_roster set loaded_at = loaded_at - interval '1 day' where sheet_sha256 = repeat('a', 64);

do $$
declare n int; v_id uuid; v_names text; v_entry uuid; v_cells jsonb;
begin
  -- One live entry of ours takes NO. 983.
  select id into v_id from v_entry_public order by entry_name limit 1;
  update entries set lynne_number = 983 where id = v_id;

  select count(*) into n from v_master_list;
  if n <> 3 then raise exception 'v_master_list must show the newest sheet only (3 rows), got %', n; end if;
  select names, entry_id, cells into v_names, v_entry, v_cells from v_master_list where row_no = 983;
  if v_names <> 'Adriana Flacco ' then raise exception 'names must be the newest sheet, verbatim; got %', quote_literal(v_names); end if;
  if v_entry is distinct from v_id then raise exception 'entry_id must be our live entry at that NO.'; end if;
  if v_cells->>'Week 1' <> 'Dallas' then raise exception 'cells must ride along; got %', v_cells; end if;
  if (select entry_id from v_master_list where row_no = 1319) is not null then
    raise exception 'a NO. that is nobody of ours must carry no entry_id';
  end if;

  -- A voided entry at that NO. is not ours on the list.
  update entries set voided_at = now() where id = v_id;
  if (select entry_id from v_master_list where row_no = 983) is not null then
    raise exception 'a voided entry must not be marked ours';
  end if;
  update entries set voided_at = null where id = v_id;
end $$;

-- ------------------------------------------------------- anon reads the view
set local role anon;
do $$
declare n int;
begin
  select count(*) into n from v_master_list;
  if n <> 3 then raise exception 'anon must read the Master List, got % rows', n; end if;
  select count(*) into n from lynne_roster;
  if n <> 0 then raise exception 'anon must see no lynne_roster rows directly, saw %', n; end if;
end $$;
reset role;

-- ------------------------------------------- the reveal gate on her cells
-- The seed carries the real schedule, so the fixture owns weeks 1 to 3
-- outright (inside this rolled-back transaction): week 1's game has not
-- kicked off; week 2's is long over; week 3 has none.
delete from nfl_games where week in (1, 2, 3);
insert into nfl_games (id, week, kickoff_at, day_of_week, away_team, home_team) values
  ('ml-w1-phi-dal', 1, now() + interval '1 day', 'Sunday', 'PHI', 'DAL'),
  ('ml-w2-kc-buf', 2, now() - interval '7 day', 'Sunday', 'KC', 'BUF');
-- The newer sheet below has to be the newest: date the earlier ones back.
update lynne_roster set loaded_at = loaded_at - interval '1 hour';

select set_config('app.admin_email', 'admin@test.local', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"admin@test.local"}', true);
select admin_load_lynne_roster(repeat('c', 64), 'gated.xlsx', null,
  '[{"no":983,"names":"Adriana Flacco ","row":2,"cells":{"Week 1":"dallas ","Week 2":"OUT","Phone":"555-0100","Week 3":"Buffalo"}}]'::jsonb,
  'admin@test.local');
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare v_cells jsonb; n int;
begin
  select count(*) into n from v_master_list;
  if n <> 1 then raise exception 'the newest sheet has one row, the view shows %', n; end if;

  -- Before kickoff: Week 1 (a team, its game ahead) is held; Week 2 (OUT, a
  -- finished week) is served; Week 3 (a team with no game that week) stays
  -- locked, never guessed; Phone is not a week and never leaves the table.
  select cells into v_cells from v_master_list where row_no = 983;
  if v_cells <> '{"Week 2": "OUT"}'::jsonb then
    raise exception 'before kickoff the view must serve only the finished week, got %', v_cells;
  end if;

  -- After kickoff her Week 1 cell is served, as she wrote it.
  update nfl_games set kickoff_at = now() - interval '1 hour' where id = 'ml-w1-phi-dal';
  select cells into v_cells from v_master_list where row_no = 983;
  if v_cells <> '{"Week 1": "dallas ", "Week 2": "OUT"}'::jsonb then
    raise exception 'after kickoff her Week 1 cell must be served verbatim, got %', v_cells;
  end if;

  -- The admin reveal override masks it again, the same as the grid.
  update nfl_games set reveal_override = false where id = 'ml-w1-phi-dal';
  select cells into v_cells from v_master_list where row_no = 983;
  if v_cells ? 'Week 1' then raise exception 'a reveal override must hold her cell back too, got %', v_cells; end if;
end $$;

rollback;
