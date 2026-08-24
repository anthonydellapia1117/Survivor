-- Part D: a game's result is the source of truth for pick results.

begin;
do $$
declare
  scratch uuid; e_home uuid; e_away uuid;
  g record;
  n int;
begin
  -- Any week-6 Sunday game from the seeded schedule.
  select * into g from nfl_games where week = 6 and day_of_week = 'Sunday' limit 1;

  insert into owners (first_name, last_name) values ('Score','Test') returning id into scratch;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 1, 'ST home') returning id into e_home;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 2, 'ST away') returning id into e_away;
  insert into picks (entry_id, week, team, result) values (e_home, 6, g.home_team, 'pending');
  insert into picks (entry_id, week, team, result) values (e_away, 6, g.away_team, 'pending');

  -- Home wins: home pickers win, away pickers lose.
  select admin_set_game_score(g.id, 27, 14, 'final', 'test') into n;
  if n <> 2 then raise exception 'expected 2 picks recomputed, got %', n; end if;
  if (select result from picks where entry_id = e_home and is_current) <> 'win' then
    raise exception 'home picker should have a win';
  end if;
  if (select result from picks where entry_id = e_away and is_current) <> 'loss' then
    raise exception 'away picker should have a loss';
  end if;
  if (select result_source from picks where entry_id = e_home and is_current) <> 'game' then
    raise exception 'result_source must be game';
  end if;

  -- Standings follow the derived results.
  if (select losses from v_entry_standing where entry_id = e_away) <> 1 then
    raise exception 'standing did not pick up the derived loss';
  end if;

  -- CORRECTION: the score flips — every affected pick recomputes.
  perform admin_set_game_score(g.id, 14, 27, 'final', 'test');
  if (select result from picks where entry_id = e_home and is_current) <> 'loss' then
    raise exception 'corrected score did not flip the home pick to loss';
  end if;
  if (select result from picks where entry_id = e_away and is_current) <> 'win' then
    raise exception 'corrected score did not flip the away pick to win';
  end if;
  if (select losses from v_entry_standing where entry_id = e_home) <> 1 then
    raise exception 'standing did not follow the correction';
  end if;

  -- Tie: a loss for BOTH sides.
  perform admin_set_game_score(g.id, 20, 20, 'final', 'test');
  if (select result from picks where entry_id = e_home and is_current) <> 'tie_loss'
     or (select result from picks where entry_id = e_away and is_current) <> 'tie_loss' then
    raise exception 'tie must count as a loss for both pickers';
  end if;

  -- Clearing the score reverts game-derived results to pending.
  perform admin_set_game_score(g.id, null, null, 'scheduled', 'test');
  if (select result from picks where entry_id = e_home and is_current) <> 'pending' then
    raise exception 'cleared score should revert picks to pending';
  end if;

  -- A final game requires both scores.
  begin
    perform admin_set_game_score(g.id, 21, null, 'final', 'test');
    raise exception 'final without both scores was accepted';
  exception when others then
    if sqlerrm not like '%both scores%' then raise; end if;
  end;
end $$;
rollback;
