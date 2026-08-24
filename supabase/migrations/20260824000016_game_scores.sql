-- V2 Part D: game scores drive everything downstream. A pick's win/loss
-- derives from its game — admin_set_game_score is the ONLY writer of
-- game-derived results, and correcting a score recomputes every affected
-- current pick (entry standings are views, so they follow automatically).

alter table nfl_games add column home_score int;
alter table nfl_games add column away_score int;
alter table nfl_games add column status text not null default 'scheduled'
  check (status in ('scheduled', 'in_progress', 'final'));
alter table nfl_games add constraint nfl_games_final_scores
  check (status <> 'final' or (home_score is not null and away_score is not null));

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
    -- Score cleared or game not final: any game-derived results for these
    -- teams revert to pending so nothing drifts from its game.
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

do $$
begin
  execute 'revoke execute on function admin_set_game_score(text,int,int,text,text) from public';
  begin
    execute 'revoke execute on function admin_set_game_score(text,int,int,text,text) from anon';
    execute 'grant execute on function admin_set_game_score(text,int,int,text,text) to authenticated';
  exception when undefined_object then
    null;
  end;
end $$;
