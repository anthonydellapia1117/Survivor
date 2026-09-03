-- The pick deadline is tiered by game day in EVERY week, Week 1 included.
--
-- The rule Anthony set:
--
--   Wednesday game   -> Tuesday   12:00 PM ET
--   Thursday game    -> Wednesday 12:00 PM ET
--   Sat / Sun / Mon  -> Friday    12:00 PM ET
--
-- Saturday, Sunday and Monday share one window on purpose: that is where the
-- volume is and it needs a single cutoff.
--
-- TWO defects are fixed here, both seeded with the schedule in
-- 20260822000014 and both wrong.
--
-- 1. WEEK 1 CARRIED A SPECIAL CASE. `when w.week = 1 then early` collapsed
--    every Week 1 pick onto Tuesday 2026-09-08 noon regardless of game day,
--    and Week 1's row was seeded early = late = that Tuesday. There is no
--    special Week 1 rule; it is tiered like every other week. Week 1 is the
--    ONLY week seeded with an override -- weeks 2-18 all carry
--    early = Wednesday noon ET, late = Friday noon ET, checked row by row.
--
-- 2. WEDNESDAY AND THURSDAY WERE COLLAPSED INTO ONE TIER. Both mapped to
--    `early` (Wednesday noon), which for a Wednesday game is noon on the day
--    it is played. 2026 has four Wednesday games; the one this actually
--    reached is Week 12 GB@LAR, kicking off Wed 11-25 at 8:00 PM ET with its
--    picks closing that same day at noon -- eight hours, not the full day the
--    rule gives every other tier. It never let a pick land after kickoff, so
--    this was a latent break of the rule rather than a live hole, but it is
--    the same defect as (1) and is fixed with it.
--
-- The three tiers sit one day apart by construction, so they are derived
-- from early_deadline_at rather than given new columns. That keeps the Weeks
-- screen meaningful: move the early deadline and the Wednesday and Friday
-- tiers move with it, preserving the relationship the rule describes.
-- Interval arithmetic on timestamptz adds exactly 24h; US DST transitions
-- fall on Sundays, so Tue/Wed/Thu never straddle one and each tier stays at
-- noon ET.
--
-- FRIDAY is not one of the three tiers Anthony stated, and 2026 has six
-- Friday games (Week 12 Black Friday, Week 16 Christmas Day). They take
-- Thursday noon ET here, by the same day-before principle the stated tiers
-- follow. That is a change from the old behaviour (Wednesday noon) in the
-- generous direction while still landing a full day before kickoff. Flagged
-- to Anthony as the one tier he did not specify; it affects no game before
-- 2026-11-27, so it is safe to revise later.

-- Week 1 loses its override and takes the standard shape.
--   early = Wednesday 2026-09-09 12:00 ET  (Thursday-game picks)
--   late  = Friday    2026-09-11 12:00 ET  (Sat-Mon picks, and the sweep)
-- The Wednesday-game tier then derives to Tuesday 2026-09-08 12:00 ET, which
-- is the only thing Tuesday noon ever closed.
update weeks
   set early_deadline_at = '2026-09-09T16:00:00+00',
       late_deadline_at = '2026-09-11T16:00:00+00',
       deadline_at = '2026-09-11T16:00:00+00'
 where week = 1;

-- A bye/unknown team (SKIP_WEEK included) has no game row, so no WHEN
-- matches and it falls to ELSE -- the week's late deadline, its final
-- submission boundary. That behaviour is unchanged.
create or replace function pick_deadline(p_week int, p_team text)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select case g.day_of_week
    when 'Wednesday' then w.early_deadline_at - interval '1 day'
    when 'Thursday'  then w.early_deadline_at
    when 'Friday'    then w.early_deadline_at + interval '1 day'
    else w.late_deadline_at
  end
  from weeks w
  left join nfl_games g
    on g.week = w.week and (g.home_team = p_team or g.away_team = p_team)
  where w.week = p_week
$$;

-- No new grants: CREATE OR REPLACE keeps the ones 20260822000014 set on this
-- signature. Re-stated so a fresh replay lands them either way.
do $$
begin
  execute 'revoke execute on function pick_deadline(int,text) from public';
  begin
    execute 'grant execute on function pick_deadline(int,text) to anon, authenticated';
  exception when undefined_object then
    null;
  end;
end $$;

-- Every deadline must land strictly before the first kickoff it governs.
-- This is the property the old derivation broke, so it is asserted here
-- against the real schedule rather than left to the test suite alone.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s week %s %s@%s kicks off %s but its picks close %s',
                           g.id, g.week, g.away_team, g.home_team,
                           g.kickoff_at, d.deadline_at), '; ')
    into v_bad
    from nfl_games g
    cross join lateral (select pick_deadline(g.week, g.home_team) as deadline_at) d
   where d.deadline_at >= g.kickoff_at;
  if v_bad is not null then
    raise exception 'pick deadline falls at or after kickoff: %', v_bad;
  end if;
end $$;
