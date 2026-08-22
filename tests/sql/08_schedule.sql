-- The 2026 schedule table and the per-pick deadline engine.

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

-- Window resolution: Thursday team -> Wednesday noon; Sunday team ->
-- Friday noon; bye/unknown team -> the late boundary; week 1 -> Tuesday
-- for everyone, whatever day their team plays.
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

  select home_team into sun from nfl_games where week = 1 and day_of_week = 'Sunday' limit 1;
  if pick_deadline(1, sun) <> '2026-09-08 16:00:00+00'::timestamptz then
    raise exception 'week 1 is Tuesday noon ET for everyone';
  end if;
  -- The Wednesday opener kicks off AFTER the Tuesday deadline.
  if exists (
    select 1 from nfl_games where week = 1 and kickoff_at <= '2026-09-08 16:00:00+00'
  ) then
    raise exception 'a week 1 game kicks off before the Tuesday deadline';
  end if;
end $$;

-- Late flags come from the pick's own window: with week 6 sitting between
-- its windows (early passed, late not), a Thursday-team pick is late and a
-- Sunday-team pick is not. Week 1 past Tuesday: late for everyone.
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

  -- Week 1: Tuesday rule applies to a Sunday team too.
  select home_team into sun from nfl_games where week = 1 and day_of_week = 'Sunday' limit 1;
  update weeks set early_deadline_at = now() - interval '1 hour',
                   late_deadline_at = now() - interval '1 hour',
                   deadline_at = now() - interval '1 hour'
   where week = 1;
  perform admin_submit_pick(e, 1, sun, 'admin', 'test');
  if not (select late from picks where entry_id = e and week = 1 and is_current) then
    raise exception 'week 1 pick after Tuesday noon must be late, Sunday team included';
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
