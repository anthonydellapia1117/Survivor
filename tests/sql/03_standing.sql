-- v_entry_standing: lives, status, and elimination fully derived from picks.
-- Uses a scratch owner; everything rolls back.

begin;

do $$
declare
  scratch uuid;
  e_active uuid; e_atrisk uuid; e_elim uuid; e_tie uuid; e_missed uuid;
  e_bye_el uuid; e_bye_used uuid; e_single uuid; e_teams uuid;
  s record;
begin
  insert into owners (first_name, last_name) values ('Scratch','Owner') returning id into scratch;

  insert into entries (owner_id, entry_index, entry_name) values
    (scratch, 1, 'T active')    returning id into e_active;
  insert into entries (owner_id, entry_index, entry_name) values
    (scratch, 2, 'T atrisk')    returning id into e_atrisk;
  insert into entries (owner_id, entry_index, entry_name) values
    (scratch, 3, 'T elim')      returning id into e_elim;
  insert into entries (owner_id, entry_index, entry_name) values
    (scratch, 4, 'T tie')       returning id into e_tie;
  insert into entries (owner_id, entry_index, entry_name) values
    (scratch, 5, 'T missed')    returning id into e_missed;
  insert into entries (owner_id, entry_index, entry_name) values
    (scratch, 6, 'T bye elig')  returning id into e_bye_el;
  insert into entries (owner_id, entry_index, entry_name) values
    (scratch, 7, 'T bye used')  returning id into e_bye_used;
  insert into entries (owner_id, entry_index, entry_name) values
    (scratch, 8, 'T single')    returning id into e_single;
  insert into entries (owner_id, entry_index, entry_name) values
    (scratch, 9, 'T teams')     returning id into e_teams;

  -- No picks: active with 2 lives.
  select * into s from v_entry_standing where entry_id = e_active;
  if s.status <> 'active' or s.lives_remaining <> 2 then
    raise exception 'no-pick entry should be active/2, got %/%', s.status, s.lives_remaining;
  end if;

  -- One loss in weeks 1-7: at risk, 1 life.
  insert into picks (entry_id, week, team, result) values (e_atrisk, 1, 'DAL', 'win');
  insert into picks (entry_id, week, team, result) values (e_atrisk, 2, 'NYJ', 'loss');
  select * into s from v_entry_standing where entry_id = e_atrisk;
  if s.status <> 'at_risk' or s.lives_remaining <> 1 then
    raise exception 'one-loss entry should be at_risk/1, got %/%', s.status, s.lives_remaining;
  end if;

  -- Two losses: eliminated, 0 lives.
  insert into picks (entry_id, week, team, result) values (e_elim, 1, 'NYG', 'loss');
  insert into picks (entry_id, week, team, result) values (e_elim, 2, 'CHI', 'loss');
  select * into s from v_entry_standing where entry_id = e_elim;
  if s.status <> 'eliminated' or s.lives_remaining <> 0 then
    raise exception 'two-loss entry should be eliminated/0, got %/%', s.status, s.lives_remaining;
  end if;

  -- A tie is a loss, always.
  insert into picks (entry_id, week, team, result) values (e_tie, 1, 'PHI', 'tie_loss');
  select * into s from v_entry_standing where entry_id = e_tie;
  if s.status <> 'at_risk' or s.losses <> 1 then
    raise exception 'tie_loss must count as a loss';
  end if;

  -- A missed pick is a loss.
  insert into picks (entry_id, week, team, result) values (e_missed, 1, 'MISSED', 'missed');
  select * into s from v_entry_standing where entry_id = e_missed;
  if s.status <> 'at_risk' or s.losses <> 1 then
    raise exception 'missed pick must count as a loss';
  end if;

  -- Loss-free through week 7, bye unused: bye eligible.
  for wk in 1..7 loop
    insert into picks (entry_id, week, team, result) values (e_bye_el, wk, 'W' || wk, 'win');
  end loop;
  select * into s from v_entry_standing where entry_id = e_bye_el;
  if s.status <> 'bye_eligible' then
    raise exception 'loss-free through week 7 should be bye_eligible, got %', s.status;
  end if;

  -- Bye used in week 8: advances with no win or loss, not in teams_used.
  for wk in 1..7 loop
    insert into picks (entry_id, week, team, result) values (e_bye_used, wk, 'X' || wk, 'win');
  end loop;
  insert into picks (entry_id, week, team, result) values (e_bye_used, 8, 'SKIP_WEEK', 'bye');
  select * into s from v_entry_standing where entry_id = e_bye_used;
  if s.status <> 'active' then
    raise exception 'bye-used entry should be active, got %', s.status;
  end if;
  if s.bye_used is not true then
    raise exception 'bye_used flag not set';
  end if;
  if 'SKIP_WEEK' = any(s.teams_used) then
    raise exception 'SKIP_WEEK leaked into teams_used';
  end if;
  if s.losses <> 0 or s.wins <> 7 then
    raise exception 'bye must add neither a win nor a loss';
  end if;

  -- Week 8+: single elimination. One loss at week 8 is terminal even with 2 lives.
  for wk in 1..7 loop
    insert into picks (entry_id, week, team, result) values (e_single, wk, 'Y' || wk, 'win');
  end loop;
  insert into picks (entry_id, week, team, result) values (e_single, 8, 'MIA', 'loss');
  select * into s from v_entry_standing where entry_id = e_single;
  if s.status <> 'eliminated' or s.lives_remaining <> 0 then
    raise exception 'week-8 loss must eliminate immediately, got %/% ', s.status, s.lives_remaining;
  end if;

  -- teams_used is ordered by week and only counts scored picks.
  insert into picks (entry_id, week, team, result) values (e_teams, 1, 'KC', 'win');
  insert into picks (entry_id, week, team, result) values (e_teams, 2, 'BUF', 'loss');
  insert into picks (entry_id, week, team, result) values (e_teams, 3, 'SF', 'pending');
  select * into s from v_entry_standing where entry_id = e_teams;
  if s.teams_used is distinct from array['KC','BUF','SF'] then
    -- pending picks have a result row, so they appear; only NULL results are excluded
    raise exception 'teams_used mismatch: %', s.teams_used;
  end if;

  -- Supersession: only the current pick counts.
  update picks set is_current = false where entry_id = e_teams and week = 3;
  insert into picks (entry_id, week, team, result, supersedes_id)
    select e_teams, 3, 'DET', 'pending', id from picks where entry_id = e_teams and week = 3 and not is_current;
  select * into s from v_entry_standing where entry_id = e_teams;
  if s.teams_used is distinct from array['KC','BUF','DET'] then
    raise exception 'superseded pick still counted: %', s.teams_used;
  end if;
end $$;

rollback;

-- One current pick per entry-week is enforced by the database.
begin;
do $$
declare
  scratch uuid; e uuid;
  rejected boolean := false;
begin
  insert into owners (first_name, last_name) values ('Scratch','Two') returning id into scratch;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 1, 'T dupe') returning id into e;
  insert into picks (entry_id, week, team) values (e, 1, 'KC');
  begin
    insert into picks (entry_id, week, team) values (e, 1, 'BUF');
  exception when unique_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'two current picks for the same entry-week were accepted';
  end if;
end $$;
rollback;
