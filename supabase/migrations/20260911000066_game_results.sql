-- Game results from the free ESPN scoreboard feed, written by one audited RPC.
--
-- Set by Anthony on 2026-09-11. The feed is READ-ONLY to us and this function
-- is WRITE-ONLY to nfl_games: it never touches picks, entries or lynne_roster,
-- and it cannot, because it names no other table.
--
-- Four rules, all enforced here rather than in the script that calls it, so
-- they hold for a hand-run, a Routine and SQL typed by a person:
--
--   1. MATCH, NEVER CREATE. Every incoming row must match exactly one
--      nfl_games row on (week, home_team, away_team). One that does not stops
--      the whole call before anything is written and names the game. There is
--      no insert in this function at all - the schedule is seeded and a game
--      the feed knows that we do not means the schedule moved, which is a
--      person's problem, not a row to invent.
--   2. A FINAL IS NEVER OVERWRITTEN. Once a game is final its scores stand.
--      A later feed correction is Anthony's to apply by hand, deliberately,
--      the same way a payment correction is a new row rather than an edit.
--   3. IDEMPOTENT. A row whose status and both scores already match writes
--      nothing and audits nothing, so a re-run in the same window is a no-op.
--   4. AUDITED PER WRITE, in the same transaction as the write.
--
-- A tie stays a loss in this pool. Nothing here decides that - it is
-- picks.result and the standings view that do - and this function deliberately
-- does not compute a winner at all. It records the two scores; who won is
-- derived wherever it is needed.

create or replace function admin_apply_game_results(
  p_rows jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row        jsonb;
  v_week       int;
  v_home       text;
  v_away       text;
  v_home_score int;
  v_away_score int;
  v_status     text;
  v_id         text;
  v_before     jsonb;
  v_matches    int;
  v_unmatched  text[] := '{}';
  v_written    int := 0;
  v_unchanged  int := 0;
  v_kept_final int := 0;
  v_games      jsonb := '[]'::jsonb;
begin
  if not is_admin() then
    raise exception 'admin_apply_game_results: not the admin'
      using errcode = 'insufficient_privilege';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'admin_apply_game_results: p_rows must be a JSON array';
  end if;
  if coalesce(btrim(p_actor), '') = '' then
    raise exception 'admin_apply_game_results: p_actor is required';
  end if;

  -- ---- pass one: shape and match. Nothing is written in this loop.
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_week   := (v_row ->> 'week')::int;
    v_home   := upper(btrim(coalesce(v_row ->> 'home_team', '')));
    v_away   := upper(btrim(coalesce(v_row ->> 'away_team', '')));
    v_status := btrim(coalesce(v_row ->> 'status', ''));

    if v_week is null or v_week < 1 or v_week > 18 then
      raise exception 'admin_apply_game_results: week % is not 1-18', coalesce(v_row ->> 'week', 'null');
    end if;
    if v_home = '' or v_away = '' then
      raise exception 'admin_apply_game_results: week % has a row with no team', v_week;
    end if;
    if v_status not in ('scheduled', 'in_progress', 'final') then
      raise exception 'admin_apply_game_results: % is not a status', coalesce(v_status, 'null');
    end if;
    if v_status = 'final'
       and ((v_row ->> 'home_score') is null or (v_row ->> 'away_score') is null) then
      raise exception 'admin_apply_game_results: week % % at % is final with no score',
        v_week, v_away, v_home;
    end if;

    select count(*) into v_matches
      from nfl_games g
     where g.week = v_week and g.home_team = v_home and g.away_team = v_away;

    if v_matches <> 1 then
      v_unmatched := v_unmatched
        || format('week %s %s at %s (%s rows)', v_week, v_away, v_home, v_matches);
    end if;
  end loop;

  if array_length(v_unmatched, 1) is not null then
    raise exception 'admin_apply_game_results: % game(s) match no single nfl_games row and NOTHING was written: %',
      array_length(v_unmatched, 1), array_to_string(v_unmatched, '; ');
  end if;

  -- ---- pass two: write, one audited row per game actually changed
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_week       := (v_row ->> 'week')::int;
    v_home       := upper(btrim(v_row ->> 'home_team'));
    v_away       := upper(btrim(v_row ->> 'away_team'));
    v_status     := btrim(v_row ->> 'status');
    v_home_score := nullif(v_row ->> 'home_score', '')::int;
    v_away_score := nullif(v_row ->> 'away_score', '')::int;

    select g.id,
           jsonb_build_object('status', g.status, 'home_score', g.home_score, 'away_score', g.away_score)
      into v_id, v_before
      from nfl_games g
     where g.week = v_week and g.home_team = v_home and g.away_team = v_away;

    -- rule 2: a final stands.
    if v_before ->> 'status' = 'final' then
      v_kept_final := v_kept_final + 1;
      continue;
    end if;

    -- rule 3: nothing to say.
    if v_before ->> 'status' = v_status
       and v_before -> 'home_score' = to_jsonb(v_home_score)
       and v_before -> 'away_score' = to_jsonb(v_away_score) then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    update nfl_games
       set status = v_status, home_score = v_home_score, away_score = v_away_score
     where id = v_id;

    -- rule 4: the audit row commits with the update or neither does.
    insert into audit_log (actor, action, target_table, target_id, before, after, note)
    values (
      p_actor,
      'game_result',
      'nfl_games',
      v_id,
      v_before,
      jsonb_build_object('status', v_status, 'home_score', v_home_score, 'away_score', v_away_score),
      format('week %s %s at %s: %s %s-%s', v_week, v_away, v_home, v_status,
             coalesce(v_away_score::text, '-'), coalesce(v_home_score::text, '-'))
    );

    v_written := v_written + 1;
    v_games := v_games || jsonb_build_object(
      'week', v_week, 'away_team', v_away, 'home_team', v_home,
      'away_score', v_away_score, 'home_score', v_home_score, 'status', v_status);
  end loop;

  return jsonb_build_object(
    'written', v_written,
    'unchanged', v_unchanged,
    'kept_final', v_kept_final,
    'considered', jsonb_array_length(p_rows),
    'games', v_games);
end;
$$;

revoke all on function admin_apply_game_results(jsonb, text) from public;
grant execute on function admin_apply_game_results(jsonb, text) to authenticated;

comment on function admin_apply_game_results(jsonb, text) is
  'Scores from the ESPN feed onto nfl_games, matched on (week, home_team, away_team). '
  'Matches and never creates; refuses the whole call if any row matches no single game; '
  'never overwrites a game already final; writes nothing when nothing changed; '
  'audits each write in the same transaction. Touches no other table.';
