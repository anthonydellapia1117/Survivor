-- admin_apply_game_results: the four rules, each exercised and each shown to
-- refuse. Run inside one transaction and rolled back, so it leaves nothing.
--
--   1. match, never create      an unmatched game stops the WHOLE call
--   2. a final is never overwritten
--   3. idempotent               a re-run writes nothing and audits nothing
--   4. audited per write, in the same transaction as the write
--
-- It also proves the negative Anthony asked for: the function touches picks,
-- entries and lynne_roster nowhere, checked against the function body rather
-- than by reading it.

begin;

-- Act as the admin, the way every other suite here does: the authenticated
-- role with the admin's address on the JWT claim is_admin() reads.
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

do $$
declare
  v_out    jsonb;
  v_week   int;
  v_home   text;
  v_away   text;
  v_id     text;
  v_audit0 bigint;
  v_audit1 bigint;
  v_n      int;
begin
  -- a real scheduled game to work on
  select g.week, g.home_team, g.away_team, g.id
    into v_week, v_home, v_away, v_id
    from nfl_games g where g.status = 'scheduled' order by g.week, g.id limit 1;
  if v_id is null then raise exception 'no scheduled game to test with'; end if;

  select max(id) into v_audit0 from audit_log;

  -- ---------------------------------------------- 1. match, never create
  begin
    v_out := admin_apply_game_results(
      jsonb_build_array(jsonb_build_object(
        'week', v_week, 'home_team', 'ZZZ', 'away_team', v_away,
        'home_score', 3, 'away_score', 0, 'status', 'final')),
      'test');
    raise exception 'FAIL: an unmatched game was accepted';
  exception when others then
    if sqlerrm not like '%match no single nfl_games row and NOTHING was written%' then raise; end if;
  end;
  -- and it created nothing
  select count(*) into v_n from nfl_games where home_team = 'ZZZ';
  if v_n <> 0 then raise exception 'FAIL: a game was created'; end if;

  -- one bad row poisons the whole call: the good row beside it is not written
  begin
    v_out := admin_apply_game_results(
      jsonb_build_array(
        jsonb_build_object('week', v_week, 'home_team', v_home, 'away_team', v_away,
                           'home_score', 21, 'away_score', 17, 'status', 'final'),
        jsonb_build_object('week', v_week, 'home_team', 'ZZZ', 'away_team', v_away,
                           'home_score', 3, 'away_score', 0, 'status', 'final')),
      'test');
    raise exception 'FAIL: a batch with an unmatched game was accepted';
  exception when others then
    if sqlerrm not like '%NOTHING was written%' then raise; end if;
  end;
  select count(*) into v_n from nfl_games where id = v_id and status = 'scheduled';
  if v_n <> 1 then raise exception 'FAIL: the good row of a refused batch was written'; end if;

  -- ---------------------------------------------------- 4. audited write
  v_out := admin_apply_game_results(
    jsonb_build_array(jsonb_build_object(
      'week', v_week, 'home_team', v_home, 'away_team', v_away,
      'home_score', 21, 'away_score', 17, 'status', 'final')),
    'test');
  if (v_out ->> 'written')::int <> 1 then raise exception 'FAIL: expected 1 written, got %', v_out; end if;

  select count(*) into v_n from nfl_games
   where id = v_id and status = 'final' and home_score = 21 and away_score = 17;
  if v_n <> 1 then raise exception 'FAIL: the score was not written'; end if;

  select count(*) into v_n from audit_log
   where action = 'game_result' and target_table = 'nfl_games' and target_id = v_id
     and actor = 'test' and (after ->> 'home_score') = '21' and (before ->> 'status') = 'scheduled';
  if v_n <> 1 then raise exception 'FAIL: no audit row for the write'; end if;

  -- ------------------------------------------------------- 3. idempotent
  -- On a row that is NOT final, so this tests idempotency and not rule 2.
  -- It was written the other way round first, and the never-overwrite branch
  -- returned before the unchanged branch was ever reached - so removing the
  -- unchanged check left the suite green. A guard shadowed by an earlier
  -- guard is not a guard.
  declare
    v_w2 int; v_h2 text; v_a2 text; v_id2 text; v_audit2 bigint;
  begin
    select g.week, g.home_team, g.away_team, g.id into v_w2, v_h2, v_a2, v_id2
      from nfl_games g where g.status = 'scheduled' and g.id <> v_id order by g.week, g.id limit 1;

    v_out := admin_apply_game_results(
      jsonb_build_array(jsonb_build_object(
        'week', v_w2, 'home_team', v_h2, 'away_team', v_a2,
        'home_score', 7, 'away_score', 3, 'status', 'in_progress')),
      'test');
    if (v_out ->> 'written')::int <> 1 then raise exception 'FAIL: in_progress was not written: %', v_out; end if;

    select max(id) into v_audit2 from audit_log;
    v_out := admin_apply_game_results(
      jsonb_build_array(jsonb_build_object(
        'week', v_w2, 'home_team', v_h2, 'away_team', v_a2,
        'home_score', 7, 'away_score', 3, 'status', 'in_progress')),
      'test');
    if (v_out ->> 'written')::int <> 0 then raise exception 'FAIL: an identical re-run wrote something: %', v_out; end if;
    if (v_out ->> 'unchanged')::int <> 1 then raise exception 'FAIL: expected unchanged 1, got %', v_out; end if;
    if (v_out ->> 'kept_final')::int <> 0 then raise exception 'FAIL: an in_progress row was counted as final: %', v_out; end if;
    select count(*) into v_n from audit_log where id > v_audit2;
    if v_n <> 0 then raise exception 'FAIL: an identical re-run wrote % audit rows', v_n; end if;

    -- and a CHANGED score on the same non-final row is still written
    v_out := admin_apply_game_results(
      jsonb_build_array(jsonb_build_object(
        'week', v_w2, 'home_team', v_h2, 'away_team', v_a2,
        'home_score', 14, 'away_score', 3, 'status', 'in_progress')),
      'test');
    if (v_out ->> 'written')::int <> 1 then raise exception 'FAIL: a changed live score was not written: %', v_out; end if;
  end;

  -- the same call on the FINAL row is rule 2, counted separately
  select max(id) into v_audit1 from audit_log;
  v_out := admin_apply_game_results(
    jsonb_build_array(jsonb_build_object(
      'week', v_week, 'home_team', v_home, 'away_team', v_away,
      'home_score', 21, 'away_score', 17, 'status', 'final')),
    'test');
  if (v_out ->> 'written')::int <> 0 then raise exception 'FAIL: a re-run wrote something: %', v_out; end if;
  if (v_out ->> 'kept_final')::int <> 1 then raise exception 'FAIL: expected kept_final 1, got %', v_out; end if;
  select count(*) into v_n from audit_log where id > v_audit1;
  if v_n <> 0 then raise exception 'FAIL: a re-run wrote % audit rows', v_n; end if;

  -- --------------------------------------- 2. a final is never overwritten
  v_out := admin_apply_game_results(
    jsonb_build_array(jsonb_build_object(
      'week', v_week, 'home_team', v_home, 'away_team', v_away,
      'home_score', 99, 'away_score', 0, 'status', 'final')),
    'test');
  if (v_out ->> 'written')::int <> 0 then raise exception 'FAIL: a final was overwritten'; end if;
  select count(*) into v_n from nfl_games where id = v_id and home_score = 21;
  if v_n <> 1 then raise exception 'FAIL: the original final did not stand'; end if;

  -- ------------------------------------------------------- a TIE is stored
  -- Equal scores are recorded as they happened. Nothing here decides what a
  -- tie COSTS: picks.result carries tie_loss and the standings view counts it
  -- with the losses, which is where that rule lives and stays.
  select g.week, g.home_team, g.away_team, g.id
    into v_week, v_home, v_away, v_id
    from nfl_games g where g.status = 'scheduled' order by g.week desc, g.id limit 1;
  v_out := admin_apply_game_results(
    jsonb_build_array(jsonb_build_object(
      'week', v_week, 'home_team', v_home, 'away_team', v_away,
      'home_score', 20, 'away_score', 20, 'status', 'final')),
    'test');
  if (v_out ->> 'written')::int <> 1 then raise exception 'FAIL: a tie was not written'; end if;
  select count(*) into v_n from nfl_games where id = v_id and home_score = away_score;
  if v_n <> 1 then raise exception 'FAIL: the tie was not stored as equal scores'; end if;

  -- ------------------------------------------- it refuses a bad status
  begin
    v_out := admin_apply_game_results(
      jsonb_build_array(jsonb_build_object(
        'week', 1, 'home_team', 'SEA', 'away_team', 'NE', 'status', 'postponed')),
      'test');
    raise exception 'FAIL: a status outside the three was accepted';
  exception when others then
    if sqlerrm not like '%is not a status%' then raise; end if;
  end;

  -- ------------------------------------------- it refuses a missing actor
  begin
    v_out := admin_apply_game_results(jsonb_build_array(), '   ');
    raise exception 'FAIL: a blank actor was accepted';
  exception when others then
    if sqlerrm not like '%p_actor is required%' then raise; end if;
  end;

  raise notice 'admin_apply_game_results: all rules hold';
end $$;

-- It writes to nfl_games and nothing else. Read off the function body, so a
-- later edit that reaches into picks fails here rather than in production.
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_apply_game_results';
  if v_src is null then raise exception 'FAIL: admin_apply_game_results is not installed'; end if;
  if v_src ~* '\m(picks|entries|lynne_roster|payments|owners)\M' then
    raise exception 'FAIL: admin_apply_game_results names a table it must not touch';
  end if;
  if v_src !~* 'insert into audit_log' then raise exception 'FAIL: it does not audit'; end if;
  if v_src ~* '\minsert into nfl_games\M' then raise exception 'FAIL: it can create a game'; end if;
end $$;

rollback;
