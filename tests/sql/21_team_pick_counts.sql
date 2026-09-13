-- Team pick counts (20260913000072): v_team_pick_counts, the aggregate the
-- Teams page reads, gated on the WEEK's late deadline and not on the pick's
-- kickoff. Everything here rolls back.
--
-- What is asserted, and why each block fails without the migration:
--   * the view exists, has exactly four columns, and anon can read it;
--   * a week whose late deadline is AHEAD serves no row at all, for either
--     scope, however many picks it holds;
--   * once the deadline is behind us every team with a pick is served, with
--     its count, whether its game has kicked off or not;
--   * while that count is served, the pick's own cell is STILL locked in
--     v_grid_cells and v_master_list until its kickoff - the aggregate does
--     not move the per-pick gate;
--   * a bye and a missed week count nothing; her non-team text counts
--     nothing; her sheet is counted from the newest sheet only.
--
-- Runs through scripts/db/test-db.sh like the other suites.

-- ------------------------------------------------------------ shape
begin;
do $$
declare n int;
begin
  if not exists (select 1 from information_schema.views where table_name = 'v_team_pick_counts') then
    raise exception 'v_team_pick_counts missing';
  end if;
  select count(*) into n from information_schema.columns where table_name = 'v_team_pick_counts';
  if n <> 4 then raise exception 'v_team_pick_counts must expose exactly four columns, found %', n; end if;
  if not exists (select 1 from information_schema.role_table_grants
                  where table_name = 'v_team_pick_counts' and grantee = 'anon' and privilege_type = 'SELECT') then
    raise exception 'anon must be able to read v_team_pick_counts';
  end if;
end $$;
rollback;

-- ------------------------------------------- the gate is the week's lock
begin;
select set_config('request.jwt.claims',
  '{"email":"anthonydellapia@gmail.com","role":"authenticated"}', true);
do $$
declare
  v_owner uuid;
  v_a uuid;
  v_b uuid;
  v_week int := 1;
  v_sha text := repeat('c', 64);
  v_n int;
  v_locked_team text;
  v_other text;
  v_cell text;
begin
  -- Two entries of ours. Week 1's late deadline is set a day AHEAD, and its
  -- games all kick off after that, so nothing has been revealed by kickoff
  -- either.
  v_owner := admin_create_owner('Count', 'Test', 'count-test@example.invalid', null,
    'test', 'team counts', array['Count #1', 'Count #2'], false, 'test');
  select id into v_a from entries where owner_id = v_owner order by entry_index limit 1;
  select id into v_b from entries where owner_id = v_owner order by entry_index desc limit 1;
  update weeks set early_deadline_at = now() + interval '1 day', late_deadline_at = now() + interval '1 day'
   where week = v_week;
  update nfl_games set kickoff_at = now() + interval '2 days', reveal_override = null where week = v_week;
  select home_team into v_locked_team from nfl_games where week = v_week order by kickoff_at, id limit 1;

  perform admin_submit_pick(v_a, v_week, v_locked_team, 'admin', 'test');
  perform admin_submit_pick(v_b, v_week, v_locked_team, 'admin', 'test');

  -- Her sheet, newest, with the same team on three rows and a note on a fourth.
  insert into lynne_roster (sheet_sha256, source_file, gmail_message_id, loaded_at, loaded_by, row_index, row_no, names, cells)
  values
    (v_sha, 'Football test.xlsx', null, now(), 'test', 1, 5001, 'Row A', jsonb_build_object('Week 1', 'Philadelphia')),
    (v_sha, 'Football test.xlsx', null, now(), 'test', 2, 5002, 'Row B', jsonb_build_object('Week 1', 'philadelphia ')),
    (v_sha, 'Football test.xlsx', null, now(), 'test', 3, 5003, 'Row C', jsonb_build_object('Week 1', 'Philadelphia')),
    (v_sha, 'Football test.xlsx', null, now(), 'test', 4, 5004, 'Row D', jsonb_build_object('Week 1', 'OUT'));

  -- Before the deadline: nothing for this week, in either scope.
  select count(*) into v_n from v_team_pick_counts where week = v_week;
  if v_n <> 0 then
    raise exception 'v_team_pick_counts served % rows for a week whose deadline is ahead', v_n;
  end if;

  -- The EARLY deadline passes and the late one is still ahead: the Sunday
  -- picks are still open, so the week has not locked and nothing is served.
  -- A gate on the early boundary would show a Thursday-team count to an
  -- undecided player; this is the block that catches it.
  update weeks set early_deadline_at = now() - interval '1 hour' where week = v_week;
  select count(*) into v_n from v_team_pick_counts where week = v_week;
  if v_n <> 0 then
    raise exception 'v_team_pick_counts served % rows on the early deadline alone - the gate is the LATE deadline', v_n;
  end if;

  -- The late deadline passes; the games have still not kicked off.
  update weeks set late_deadline_at = now() - interval '1 hour' where week = v_week;

  select n into v_n from v_team_pick_counts where week = v_week and scope = 'ours' and team = v_locked_team;
  if v_n is distinct from 2 then
    raise exception 'ours count for % must be 2 once the week has locked, got %', v_locked_team, v_n;
  end if;
  select n into v_n from v_team_pick_counts where week = v_week and scope = 'pool' and team = 'PHI';
  if v_n is distinct from 3 then
    raise exception 'pool count for PHI must be 3 (her three Philadelphia cells, one with edge space), got %', v_n;
  end if;
  -- Her OUT is not a team and counts nothing.
  if exists (select 1 from v_team_pick_counts where week = v_week and scope = 'pool' and team not in
             (select abbr from (values ('PHI')) t(abbr)) and team = 'OUT') then
    raise exception 'a non-team cell of hers was counted';
  end if;

  -- THE PER-PICK GATE IS UNTOUCHED: the count is served while the pick's own
  -- cell is still locked, because its game has not kicked off.
  select team into v_cell from v_grid_cells where entry_id = v_a and week = v_week;
  if v_cell is distinct from 'LOCKED' then
    raise exception 'v_grid_cells must still serve LOCKED before kickoff while the count is public, got %', v_cell;
  end if;
  select cells ->> 'Week 1' into v_cell from v_master_list where row_no = 5001;
  if v_cell is distinct from 'LOCKED' then
    raise exception 'v_master_list must still serve LOCKED before kickoff while the count is public, got %', v_cell;
  end if;

  -- A superseded pick drops out; only current picks count.
  select away_team into v_other from nfl_games where week = v_week order by kickoff_at, id limit 1;
  perform admin_submit_pick(v_b, v_week, v_other, 'admin', 'test');
  select n into v_n from v_team_pick_counts where week = v_week and scope = 'ours' and team = v_locked_team;
  if v_n is distinct from 1 then
    raise exception 'a superseded pick must drop out of the count, got %', v_n;
  end if;
  select n into v_n from v_team_pick_counts where week = v_week and scope = 'ours' and team = v_other;
  if v_n is distinct from 1 then
    raise exception 'the superseding pick must be counted, got %', v_n;
  end if;

  -- A bye and a missed week carry no count. A bye is only legal from week 8,
  -- so it is written straight to picks here, the way a missed week is.
  update weeks set late_deadline_at = now() - interval '1 hour' where week = 8;
  insert into picks (entry_id, week, team, source, is_current, result)
  values (v_a, 8, 'SKIP_WEEK', 'admin', true, 'bye'), (v_b, 8, 'MISSED', 'admin', true, 'missed');
  if exists (select 1 from v_team_pick_counts where team in ('SKIP_WEEK', 'MISSED')) then
    raise exception 'a bye or a missed week was counted as a team';
  end if;

  raise notice 'team pick counts: gate on the week lock ok, per-pick gate untouched';
end $$;
rollback;

-- --------------------------------------------------- newest sheet only
begin;
do $$
declare
  v_old text := repeat('d', 64);
  v_new text := repeat('e', 64);
  v_n int;
begin
  update weeks set late_deadline_at = now() - interval '1 hour' where week = 1;
  insert into lynne_roster (sheet_sha256, source_file, gmail_message_id, loaded_at, loaded_by, row_index, row_no, names, cells)
  values
    (v_old, 'old.xlsx', null, now() - interval '1 day', 'test', 1, 6001, 'Old', jsonb_build_object('Week 1', 'Dallas')),
    (v_old, 'old.xlsx', null, now() - interval '1 day', 'test', 2, 6002, 'Old', jsonb_build_object('Week 1', 'Dallas')),
    (v_new, 'new.xlsx', null, now(), 'test', 1, 6001, 'New', jsonb_build_object('Week 1', 'Dallas'));
  select n into v_n from v_team_pick_counts where week = 1 and scope = 'pool' and team = 'DAL';
  if v_n is distinct from 1 then
    raise exception 'pool counts must come from the newest sheet only, got %', v_n;
  end if;
end $$;
rollback;
