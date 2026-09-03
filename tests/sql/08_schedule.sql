-- The 2026 schedule table and the per-pick deadline engine.

-- Per-week game counts, cross-verified against BOTH nflverse and ESPN
-- (independent sources agreed on all 272 games). A re-seed that drops or
-- duplicates games fails here rather than silently removing a team from a
-- week and making it unpickable.
do $$
declare
  expected int[][] := array[
    [1,16],[2,16],[3,16],[4,16],[5,15],[6,14],[7,14],[8,14],[9,15],
    [10,14],[11,13],[12,16],[13,14],[14,15],[15,16],[16,16],[17,16],[18,16]
  ];
  i int;
  n int;
begin
  for i in 1 .. array_length(expected, 1) loop
    select count(*) into n from nfl_games where week = expected[i][1];
    if n <> expected[i][2] then
      raise exception 'week % has % games, expected %', expected[i][1], n, expected[i][2];
    end if;
  end loop;
end $$;

-- Week 17 shape: the 2026 season has NO January 1 game. Its late deadline
-- (Fri Jan 1 noon) governs the Sun Jan 3 / Mon Jan 4 slate — a deadline day
-- with no game on it is normal, not evidence of dropped rows.
do $$
declare
  n int;
begin
  if exists (
    select 1 from nfl_games
    where (kickoff_at at time zone 'America/New_York')::date = date '2027-01-01'
  ) then
    raise exception 'a game on 2027-01-01 appeared; week 17 windows need review';
  end if;

  select count(*) into n from nfl_games where week = 17 and day_of_week = 'Thursday';
  if n <> 1 then raise exception 'week 17 should have exactly 1 Thursday game, got %', n; end if;
  select count(*) into n from nfl_games where week = 17 and day_of_week = 'Friday';
  if n <> 0 then raise exception 'week 17 should have no Friday game, got %', n; end if;
  select count(*) into n from nfl_games where week = 17 and day_of_week in ('Saturday','Sunday','Monday');
  if n <> 15 then raise exception 'week 17 should have 15 Sat-Mon games, got %', n; end if;
end $$;

-- Every stored day_of_week must equal the ET calendar day of its kickoff.
-- The tag drives the deadline bucket, so a drifted tag moves a deadline.
do $$
declare
  r record;
begin
  for r in
    select id, day_of_week,
           to_char(kickoff_at at time zone 'America/New_York', 'FMDay') as et_day
    from nfl_games
  loop
    if r.day_of_week <> r.et_day then
      raise exception 'game % tagged % but kicks off on a % in ET', r.id, r.day_of_week, r.et_day;
    end if;
  end loop;
end $$;

-- Integrity: 272 regular-season games across 18 weeks; all 32 app team
-- codes present (nflverse's LA mapped to LAR); every team plays 17 with
-- exactly one bye; no team plays twice in a week.
do $$
declare
  n int;
  r record;
begin
  select count(*) into n from nfl_games;
  if n <> 272 then raise exception 'expected 272 games, got %', n; end if;

  select count(distinct week) into n from nfl_games;
  if n <> 18 then raise exception 'expected 18 weeks, got %', n; end if;

  with teams as (
    select home_team as t from nfl_games union select away_team from nfl_games
  )
  select count(*) into n from teams;
  if n <> 32 then raise exception 'expected 32 teams, got %', n; end if;

  if exists (select 1 from nfl_games where home_team = 'LA' or away_team = 'LA') then
    raise exception 'nflverse LA must be mapped to app code LAR';
  end if;
  if not exists (select 1 from nfl_games where home_team = 'LAR' or away_team = 'LAR') then
    raise exception 'LAR is missing from the schedule';
  end if;

  for r in
    with appearances as (
      select home_team as t, week from nfl_games
      union all
      select away_team, week from nfl_games
    )
    select t, count(*) as games, count(distinct week) as wks
    from appearances group by t
  loop
    if r.games <> 17 or r.wks <> 17 then
      raise exception 'team % plays % games in % weeks (want 17/17)', r.t, r.games, r.wks;
    end if;
  end loop;
end $$;

-- Every game's pick deadline lands strictly before its kickoff — including
-- the week 1 Wednesday opener and the Thanksgiving/Christmas oddballs.
do $$
declare
  r record;
begin
  for r in
    select g.id, g.kickoff_at, pick_deadline(g.week, g.home_team) as dl
    from nfl_games g
  loop
    if r.dl is null or r.dl >= r.kickoff_at then
      raise exception 'game % deadline % not before kickoff %', r.id, r.dl, r.kickoff_at;
    end if;
  end loop;
end $$;

-- Window resolution, the same in EVERY week including Week 1: the deadline
-- follows the day the picked team plays.
--   Wednesday -> Tuesday noon    Thursday -> Wednesday noon
--   Friday    -> Thursday noon   Sat/Sun/Mon and bye -> Friday noon
-- Week 1 used to collapse onto Tuesday for everyone; it does not any more.
do $$
declare
  thu text; sun text;
  w record;
begin
  select home_team into thu from nfl_games where week = 6 and day_of_week = 'Thursday' limit 1;
  select home_team into sun from nfl_games where week = 6 and day_of_week = 'Sunday' limit 1;
  select * into w from weeks where week = 6;

  if pick_deadline(6, thu) <> w.early_deadline_at then
    raise exception 'week 6 Thursday team must lock at the early deadline';
  end if;
  if pick_deadline(6, sun) <> w.late_deadline_at then
    raise exception 'week 6 Sunday team must lock at the late deadline';
  end if;
  if pick_deadline(6, 'SKIP_WEEK') <> w.late_deadline_at then
    raise exception 'a bye pick must lock at the late boundary';
  end if;

  -- Week 1, the week the special case used to govern. Anthony's three cases,
  -- asserted against the real 2026 openers rather than synthetic rows.
  --   NE@SEA  Wed 09-09 -> Tue 09-08 noon ET
  --   SF@LAR  Thu 09-10 -> Wed 09-09 noon ET
  --   Sat 09-12 onward  -> Fri 09-11 noon ET
  if pick_deadline(1, 'SEA') <> '2026-09-08 16:00:00+00'::timestamptz then
    raise exception 'week 1 Wednesday game must close Tuesday noon ET, got %',
      pick_deadline(1, 'SEA');
  end if;
  if pick_deadline(1, 'LAR') <> '2026-09-09 16:00:00+00'::timestamptz then
    raise exception 'week 1 Thursday game must close Wednesday noon ET, got %',
      pick_deadline(1, 'LAR');
  end if;
  select home_team into sun from nfl_games where week = 1 and day_of_week = 'Sunday' limit 1;
  if pick_deadline(1, sun) <> '2026-09-11 16:00:00+00'::timestamptz then
    raise exception 'week 1 Sunday game must close Friday noon ET, got %',
      pick_deadline(1, sun);
  end if;
  -- ...and Tuesday noon closes ONLY the Wednesday game, not the week.
  if (select count(*) from nfl_games g
       where g.week = 1
         and pick_deadline(1, g.home_team) = '2026-09-08 16:00:00+00'::timestamptz) <> 1 then
    raise exception 'Tuesday noon must close exactly the one Wednesday game';
  end if;

  -- Week 12 carries all four tiers at once: a Wednesday game, Thanksgiving,
  -- Black Friday, and the Sunday slate. It is the week that proves the
  -- Wednesday and Thursday tiers are genuinely a day apart.
  select * into w from weeks where week = 12;
  if pick_deadline(12, 'LAR') <> w.early_deadline_at - interval '1 day' then
    raise exception 'week 12 Wednesday game must close a day before the Thursday tier';
  end if;
  select home_team into thu from nfl_games where week = 12 and day_of_week = 'Thursday' limit 1;
  if pick_deadline(12, thu) <> w.early_deadline_at then
    raise exception 'week 12 Thursday game must close at the early deadline';
  end if;
  if pick_deadline(12, 'PIT') <> w.early_deadline_at + interval '1 day' then
    raise exception 'week 12 Friday game must close a day after the Thursday tier';
  end if;
end $$;

-- Late flags come from the pick's own window: with week 6 sitting between
-- its windows (early passed, late not), a Thursday-team pick is late and a
-- Sunday-team pick is not. Week 1 behaves identically -- that is the whole
-- point of removing its special case.
begin;
do $$
declare
  scratch uuid; e uuid;
  thu text; sun text;
begin
  insert into owners (first_name, last_name) values ('Window','Test') returning id into scratch;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 1, 'WT 1') returning id into e;

  select home_team into thu from nfl_games where week = 6 and day_of_week = 'Thursday' limit 1;
  select home_team into sun from nfl_games where week = 6 and day_of_week = 'Sunday' limit 1;

  update weeks set early_deadline_at = now() - interval '1 hour',
                   late_deadline_at = now() + interval '1 hour',
                   deadline_at = now() + interval '1 hour'
   where week = 6;

  perform admin_submit_pick(e, 6, thu, 'admin', 'test');
  if not (select late from picks where entry_id = e and week = 6 and is_current) then
    raise exception 'Thursday-team pick after Wednesday noon must be late';
  end if;

  perform admin_submit_pick(e, 6, sun, 'admin', 'test');
  if (select late from picks where entry_id = e and week = 6 and is_current) then
    raise exception 'Sunday-team pick before Friday noon must NOT be late';
  end if;

  -- Week 1 is tiered like any other week. Put it between its windows: the
  -- Wednesday tier (early - 1 day) and the Thursday tier (early) have passed,
  -- the Sat-Mon tier has not. Under the old special case every one of these
  -- would have been late together.
  select home_team into sun from nfl_games where week = 1 and day_of_week = 'Sunday' limit 1;
  update weeks set early_deadline_at = now() - interval '1 hour',
                   late_deadline_at = now() + interval '1 hour',
                   deadline_at = now() + interval '1 hour'
   where week = 1;

  perform admin_submit_pick(e, 1, 'SEA', 'admin', 'test');   -- Wednesday game
  if not (select late from picks where entry_id = e and week = 1 and is_current) then
    raise exception 'week 1 Wednesday-game pick past its tier must be late';
  end if;

  perform admin_submit_pick(e, 1, 'LAR', 'admin', 'test');   -- Thursday game
  if not (select late from picks where entry_id = e and week = 1 and is_current) then
    raise exception 'week 1 Thursday-game pick past its tier must be late';
  end if;

  perform admin_submit_pick(e, 1, sun, 'admin', 'test');     -- Sunday game
  if (select late from picks where entry_id = e and week = 1 and is_current) then
    raise exception 'week 1 Sunday-game pick before Friday noon must NOT be late — this is the Tuesday-locks-everything bug';
  end if;
end $$;
rollback;

-- The sweep boundary is the LATE deadline: between the windows it refuses
-- to commit (a pickless entry could still submit a Sat-Mon team); after the
-- late deadline it commits.
begin;
do $$
declare
  scratch uuid; e uuid;
begin
  insert into owners (first_name, last_name) values ('Sweep','Late') returning id into scratch;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 1, 'SL 1') returning id into e;

  update weeks set early_deadline_at = now() - interval '1 hour',
                   late_deadline_at = now() + interval '1 hour',
                   deadline_at = now() + interval '1 hour'
   where week = 6;
  begin
    perform admin_deadline_sweep(6, true, 'test');
    raise exception 'sweep committed between the windows';
  exception when others then
    if sqlerrm not like '%late deadline has not passed%' then raise; end if;
  end;

  update weeks set late_deadline_at = now() - interval '1 minute',
                   deadline_at = now() - interval '1 minute'
   where week = 6;
  perform admin_deadline_sweep(6, true, 'test');
  if (select count(*) from picks where entry_id = e and week = 6 and result = 'missed') <> 1 then
    raise exception 'sweep after the late deadline did not apply the loss';
  end if;
end $$;
rollback;
