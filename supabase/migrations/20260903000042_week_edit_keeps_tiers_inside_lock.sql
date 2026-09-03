-- An edited week must still contain every deadline it governs.
--
-- 20260903000041 made the Friday-game tier `early_deadline_at + 1 day`. The
-- week editor only ever checked `p_late >= p_early`, so an admin could set the
-- two boundaries equal -- or less than a day apart -- and push that tier PAST
-- the late boundary. The late boundary is what admin_deadline_sweep uses, so
-- the sweep could then commit a missed loss against an entry whose Friday-team
-- pick was still legitimately open.
--
-- Reproduced against week 12, which has a Black Friday game, before fixing:
--
--   admin_update_week(12, early = late = Wed 11-25 12:00pm)
--     friday tier   : Thu 11-26 12:00pm
--     sweep boundary: Wed 11-25 12:00pm
--     -> the pick is on time a full day after the sweep may run
--
-- That is a wrongly recorded elimination, so it is refused rather than capped.
-- Silently moving a deadline to fit is the kind of auto-resolution this
-- project does not do: the admin is told what the week needs instead.
--
-- Only the Friday tier can exceed early_deadline_at -- Wednesday is a day
-- before it and Thursday is it -- so the Friday game is the only case to
-- check, and only for weeks that actually have one.

create or replace function admin_update_week(
  p_week int,
  p_early timestamptz,
  p_late timestamptz,
  p_confirmed boolean,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if p_late < p_early then
    raise exception 'late deadline must not precede the early deadline';
  end if;

  select to_jsonb(w) into v_before from weeks w where w.week = p_week;
  if v_before is null then
    raise exception 'week % does not exist', p_week;
  end if;

  -- A Friday game closes a day after the early boundary; the late boundary is
  -- the full lock and the sweep boundary, so it has to be at least that late.
  if exists (
    select 1 from nfl_games g
     where g.week = p_week and g.day_of_week = 'Friday'
  ) and p_late < p_early + interval '1 day' then
    raise exception
      'week % has a Friday game, whose picks close % (a day after the early deadline). The late deadline is the full lock and the sweep boundary, so it cannot be earlier than that - set it to % or later.',
      p_week, p_early + interval '1 day', p_early + interval '1 day';
  end if;

  update weeks
     set early_deadline_at = p_early,
         late_deadline_at = p_late,
         deadline_at = p_late,
         confirmed = p_confirmed
   where week = p_week;

  select to_jsonb(w) into v_after from weeks w where w.week = p_week;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'update_week', 'weeks', p_week::text, v_before, v_after);
end $$;

do $$
begin
  execute 'revoke execute on function admin_update_week(int,timestamptz,timestamptz,boolean,text) from public';
  begin
    execute 'revoke execute on function admin_update_week(int,timestamptz,timestamptz,boolean,text) from anon';
    execute 'grant execute on function admin_update_week(int,timestamptz,timestamptz,boolean,text) to authenticated';
  exception when undefined_object then
    null;
  end;
end $$;

-- The seeded weeks already satisfy this (late = early + 2 days everywhere), so
-- nothing is migrated; assert it rather than assume it.
do $$
declare
  v_bad text;
begin
  select string_agg(w.week::text, ', ') into v_bad
    from weeks w
   where exists (select 1 from nfl_games g
                  where g.week = w.week and g.day_of_week = 'Friday')
     and w.late_deadline_at < w.early_deadline_at + interval '1 day';
  if v_bad is not null then
    raise exception
      'week(s) % already hold a Friday tier past their late boundary', v_bad;
  end if;
end $$;
