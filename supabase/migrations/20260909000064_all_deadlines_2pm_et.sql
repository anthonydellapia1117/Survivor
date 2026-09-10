-- Every week's boundaries at 2:00 PM ET, and the record of a change that was
-- already live before this file existed.
--
-- WHAT THIS IS. On 2026-09-09 at 19:03:42 UTC the eighteen weeks' early and
-- late boundaries were moved from 12:00 PM to 2:00 PM America/New_York --
-- 34 boundary timestamps and 17 legacy `deadline_at` timestamps. The change
-- is Anthony's and it is correct. It was applied to production as raw SQL,
-- unattended: no file in `supabase/migrations`, no smoke check at a
-- savepoint, and no row in `supabase_migrations.schema_migrations`. The only
-- trace it left is `audit_log` id 653, whose actor names a migration that did
-- not exist -- `migration:20260909000064_all_deadlines_2pm_et`. This file is
-- that migration, written afterwards and named as that row named it so the
-- two can be read together.
--
-- WHY IT HAD TO BE WRITTEN. `ci` builds a fresh database from this directory
-- and runs the SQL suites against it. With the change live in production and
-- absent here, that database kept noon while production held 2 PM, so the two
-- disagreed on the one value every deadline test turns on. A production
-- change with no file is not just a process breach; it is a fork.
--
-- IDEMPOTENT BY CONSTRUCTION. Every statement re-asserts 2:00 PM ET on each
-- week's existing ET dates. Against production it changes nothing and reports
-- 0 rows moved; against a fresh database built from this directory it moves
-- the seeded noon boundaries to 2 PM. Running it twice is the same as running
-- it once, which is what let it be added after the fact at all.
--
-- The dates are not touched, only the time of day, and each date is taken
-- from the stored value read in America/New_York -- never from UTC, where an
-- evening boundary stamps on the next calendar day. Because both boundaries
-- of a week move by the same amount, `late - early` is unchanged, so the
-- Friday-tier rule of 20260903000042 (late >= early + 1 day) still holds; it
-- is asserted at the end rather than assumed.

do $$
declare
  v_boundaries int;
  v_legacy int;
begin
  -- Counted BEFORE the update. An UPDATE ... RETURNING hands back the NEW
  -- row, so a "was it wrong?" test in RETURNING reads the value just written
  -- and is false for every row -- it would always report 0 moved.
  select coalesce(sum(
           ((early_deadline_at at time zone 'America/New_York')::time <> time '14:00')::int
         + ((late_deadline_at  at time zone 'America/New_York')::time <> time '14:00')::int), 0)
    into v_boundaries
    from weeks;

  select count(*) into v_legacy
    from weeks w
   where w.deadline_at is distinct from
         ((w.late_deadline_at at time zone 'America/New_York')::date
           + time '14:00') at time zone 'America/New_York';

  update weeks w
     set early_deadline_at =
           ((w.early_deadline_at at time zone 'America/New_York')::date
             + time '14:00') at time zone 'America/New_York',
         late_deadline_at =
           ((w.late_deadline_at at time zone 'America/New_York')::date
             + time '14:00') at time zone 'America/New_York'
   where (w.early_deadline_at at time zone 'America/New_York')::time <> time '14:00'
      or (w.late_deadline_at  at time zone 'America/New_York')::time <> time '14:00';

  -- `deadline_at` is the legacy single boundary every week still carries; it
  -- tracks the late boundary, exactly as admin_update_week keeps it.
  update weeks w
     set deadline_at = w.late_deadline_at
   where w.deadline_at is distinct from w.late_deadline_at;

  raise notice 'all_deadlines_2pm_et: % boundary timestamps and % legacy deadline timestamps moved', v_boundaries, v_legacy;
end $$;

-- Assert the result rather than trust it: every boundary reads 2:00 PM ET.
do $$
declare
  v_bad text;
begin
  select string_agg(week::text, ', ' order by week) into v_bad
    from weeks
   where (early_deadline_at at time zone 'America/New_York')::time <> time '14:00'
      or (late_deadline_at  at time zone 'America/New_York')::time <> time '14:00'
      or deadline_at is distinct from late_deadline_at;
  if v_bad is not null then
    raise exception 'week(s) % do not read 2:00 PM ET on both boundaries', v_bad;
  end if;
end $$;

-- And that no week with a Friday game lost its Friday tier to the move.
do $$
declare
  v_bad text;
begin
  select string_agg(w.week::text, ', ' order by w.week) into v_bad
    from weeks w
   where exists (select 1 from nfl_games g
                  where g.week = w.week and g.day_of_week = 'Friday')
     and w.late_deadline_at < w.early_deadline_at + interval '1 day';
  if v_bad is not null then
    raise exception 'week(s) % hold a Friday tier past their late boundary', v_bad;
  end if;
end $$;
