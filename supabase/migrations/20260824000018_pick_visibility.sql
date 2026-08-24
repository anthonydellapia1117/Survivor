-- Per-game pick visibility. Nobody logs in; the public site is read-only.
-- A pick becomes publicly visible when its team's game kicks off — per
-- GAME, not per week (a Thursday pick shows Thursday night while a Sunday
-- pick stays hidden until Sunday). Enforced SERVER-SIDE: locked picks are
-- masked in the public views and blocked by RLS on the raw table, so the
-- payload never contains them. Admin (is_admin()) always sees everything.
--
-- Also fixes a latent bug found while building this: nfl_games had only a
-- SELECT policy, so admin_set_game_score's update of the game row was
-- silently ignored by RLS for the real (non-superuser) admin. Local SQL
-- tests run as superuser and could not catch it.

-- ------------------------------------------------------------ schema
alter table nfl_games add column reveal_override boolean; -- null = automatic
alter table nfl_games add column network text;            -- CBS/FOX/NBC/…

-- The missing admin write path (latent scores bug).
create policy admin_write_nfl_games on nfl_games
  for all using (is_admin()) with check (is_admin());
grant update on nfl_games to authenticated;

-- ------------------------------------------------------------ visibility
-- One rule, one place. Team picks: revealed once the team's game this week
-- has kicked off, unless the game's reveal_override forces it either way.
-- BYE / MISSED picks carry no team information; they reveal when the
-- week's first game kicks off (no per-game override applies).
create or replace function pick_is_public(p_team text, p_week int)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p_team in ('SKIP_WEEK', 'MISSED') then exists (
      select 1 from nfl_games g
       where g.week = p_week and g.kickoff_at <= now())
    else coalesce(
      (select coalesce(g.reveal_override, g.kickoff_at <= now())
         from nfl_games g
        where g.week = p_week
          and (g.home_team = p_team or g.away_team = p_team)
        limit 1),
      false)  -- no game found for team+week: stay locked, never guess
  end
$$;
grant execute on function pick_is_public(text, int) to anon, authenticated;

-- ------------------------------------------------------------ public views
-- The grid view masks locked picks: the row exists (the public sees an
-- entry HAS picked — the cell renders LOCKED) but the team, result, and
-- source are absent from the payload entirely.
create or replace view v_grid_cells as
select
  p.entry_id,
  p.week,
  case when pick_is_public(p.team, p.week) then p.team else 'LOCKED' end as team,
  case when pick_is_public(p.team, p.week) then p.result else null end as result,
  case when pick_is_public(p.team, p.week) then p.late else false end as late,
  p.submitted_at,
  case when pick_is_public(p.team, p.week) then p.source else 'locked' end as source,
  case when pick_is_public(p.team, p.week) then p.result_source else null end as result_source
from picks p
where p.is_current;

-- Public entry projection: teams_used and bye_used must only reflect
-- games already underway. Wins/losses/status derive from results, which
-- only exist after games — no leak there. (v_entry_standing stays raw:
-- it is the internal base and the admin's source of truth.)
create or replace view v_entry_public as
select
  e.id,
  e.entry_name,
  e.name_is_default,
  e.is_free_entry,
  e.owner_id,
  o.first_name || ' ' || o.last_name as owner_name,
  s.wins,
  s.losses,
  s.lives_remaining,
  s.status,
  coalesce(pv.bye_used_public, false) as bye_used,
  pv.teams_used_public as teams_used,
  s.last_scored_week
from entries e
join owners o on o.id = e.owner_id
join v_entry_standing s on s.entry_id = e.id
left join lateral (
  select
    bool_or(p.team = 'SKIP_WEEK') as bye_used_public,
    array_agg(p.team order by p.week)
      filter (where p.team not in ('SKIP_WEEK', 'MISSED')) as teams_used_public
  from picks p
  where p.entry_id = e.id
    and p.is_current
    and pick_is_public(p.team, p.week)
) pv on true
where o.participation_status = 'confirmed'
  and o.deleted_at is null
  and e.voided_at is null;

-- Raw table: anyone hitting /rest/v1/picks with the anon key gets only
-- revealed picks. Admin sees all.
drop policy public_read_picks on picks;
create policy public_read_picks on picks
  for select using (is_admin() or pick_is_public(team, week));

-- v_entry_standing is the raw base (definer view — it bypasses the picks
-- RLS). Keep it out of direct client reach; admin gets a guarded
-- projection instead.
revoke select on v_entry_standing from anon, authenticated;

create view v_entry_admin as
select
  e.id,
  e.entry_name,
  e.name_is_default,
  e.is_free_entry,
  e.owner_id,
  o.first_name || ' ' || o.last_name as owner_name,
  s.wins,
  s.losses,
  s.lives_remaining,
  s.status,
  s.bye_used,
  s.teams_used,
  s.last_scored_week
from entries e
join owners o on o.id = e.owner_id
join v_entry_standing s on s.entry_id = e.id
where is_admin()
  and o.participation_status = 'confirmed'
  and o.deleted_at is null
  and e.voided_at is null;
revoke select on v_entry_admin from anon;
grant select on v_entry_admin to authenticated;

-- ------------------------------------------------------------ reveal RPC
-- Manual override per game: true = reveal now (kickoff time wrong, game
-- moved up), false = keep locked past kickoff, null = back to automatic.
create or replace function admin_set_game_reveal(
  p_game_id text,
  p_override boolean,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_game nfl_games%rowtype;
  n int;
begin
  select * into v_game from nfl_games where id = p_game_id;
  if v_game.id is null then
    raise exception 'game % not found', p_game_id;
  end if;

  update nfl_games set reveal_override = p_override where id = p_game_id;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'not authorized to change game visibility';
  end if;

  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'set_game_reveal', 'nfl_games', p_game_id,
          jsonb_build_object('reveal_override', v_game.reveal_override),
          jsonb_build_object('reveal_override', p_override),
          case
            when p_override is null then 'back to automatic (kickoff time)'
            when p_override then 'picks force-revealed before kickoff'
            else 'picks kept locked past kickoff'
          end);
end $$;

do $$
begin
  execute 'revoke execute on function admin_set_game_reveal(text,boolean,text) from public';
  begin
    execute 'revoke execute on function admin_set_game_reveal(text,boolean,text) from anon';
    execute 'grant execute on function admin_set_game_reveal(text,boolean,text) to authenticated';
  exception when undefined_object then
    null;
  end;
end $$;

-- Same silent-no-op guard for the scores writer, now that the policy
-- exists: if RLS ever blocks the game update again, fail loudly.
create or replace function admin_set_game_score(
  p_game_id text,
  p_home_score int,
  p_away_score int,
  p_status text,
  p_actor text
) returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_game nfl_games%rowtype;
  v_before jsonb;
  v_home_result text;
  v_away_result text;
  v_updated int := 0;
  n int;
begin
  select * into v_game from nfl_games where id = p_game_id;
  if v_game.id is null then
    raise exception 'game % not found', p_game_id;
  end if;
  if p_status not in ('scheduled', 'in_progress', 'final') then
    raise exception 'status must be scheduled, in_progress, or final';
  end if;
  if p_status = 'final' and (p_home_score is null or p_away_score is null) then
    raise exception 'a final game needs both scores';
  end if;

  v_before := to_jsonb(v_game);

  update nfl_games
     set home_score = p_home_score,
         away_score = p_away_score,
         status = p_status
   where id = p_game_id;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'not authorized to set scores';
  end if;

  if p_status = 'final' then
    -- Tie counts as a loss for BOTH sides in this pool.
    if p_home_score > p_away_score then
      v_home_result := 'win';  v_away_result := 'loss';
    elsif p_away_score > p_home_score then
      v_home_result := 'loss'; v_away_result := 'win';
    else
      v_home_result := 'tie_loss'; v_away_result := 'tie_loss';
    end if;

    update picks p
       set result = v_home_result, result_source = 'game'
     where p.is_current and p.week = v_game.week and p.team = v_game.home_team
       and (p.result is distinct from v_home_result or p.result_source is distinct from 'game');
    get diagnostics n = row_count; v_updated := v_updated + n;

    update picks p
       set result = v_away_result, result_source = 'game'
     where p.is_current and p.week = v_game.week and p.team = v_game.away_team
       and (p.result is distinct from v_away_result or p.result_source is distinct from 'game');
    get diagnostics n = row_count; v_updated := v_updated + n;
  else
    update picks p
       set result = 'pending', result_source = null
     where p.is_current and p.week = v_game.week
       and p.team in (v_game.home_team, v_game.away_team)
       and p.result_source = 'game';
    get diagnostics n = row_count; v_updated := v_updated + n;
  end if;

  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'set_game_score', 'nfl_games', p_game_id,
          v_before, (select to_jsonb(g) from nfl_games g where g.id = p_game_id),
          format('%s pick results recomputed', v_updated));

  return v_updated;
end $$;
