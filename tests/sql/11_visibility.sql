-- Per-game pick visibility: locked picks are absent from the public
-- payload (masked in v_grid_cells, filtered by RLS on picks), admin sees
-- everything, the manual override wins in both directions, and teams_used
-- only reveals teams whose games have started. Also the regression test
-- for the latent nfl_games write-policy bug: admin_set_game_score must
-- actually persist the game row when called as the authenticated admin.

begin;

-- ------------------------------------------------------------ fixture
create temp table _vis (k text primary key, v text);
grant select on _vis to anon, authenticated;

do $$
declare
  o uuid; e uuid; g record; g7 record;
begin
  select * into g from nfl_games where week = 6 and day_of_week = 'Sunday' limit 1;
  select * into g7 from nfl_games where week = 7 limit 1;

  insert into owners (first_name, last_name) values ('Vis','Test') returning id into o;
  insert into entries (owner_id, entry_index, entry_name) values (o, 1, 'Vis 1') returning id into e;
  -- Week 6: a real team pick on a game that has NOT kicked off (2026 dates
  -- are in the future relative to the test run).
  insert into picks (entry_id, week, team, result) values (e, 6, g.home_team, 'pending');
  -- Week 7: a bye — no team info, reveals when the week's first game starts.
  insert into picks (entry_id, week, team, result) values (e, 7, 'SKIP_WEEK', 'pending');

  insert into _vis values ('entry', e::text), ('game', g.id),
                          ('team', g.home_team), ('g7', g7.id);
end $$;

-- ------------------------------------------------------------ anon, pre-kickoff
set local role anon;
do $$
declare
  e uuid := (select v from _vis where k = 'entry')::uuid;
  team text := (select v from _vis where k = 'team');
  r record;
begin
  select * into r from v_grid_cells where entry_id = e and week = 6;
  if r.entry_id is null then
    raise exception 'locked pick row should exist (cell renders LOCKED)';
  end if;
  if r.team <> 'LOCKED' or r.result is not null or r.source <> 'locked' then
    raise exception 'pre-kickoff pick must be masked, got team=% result=%', r.team, r.result;
  end if;

  if exists (select 1 from picks where entry_id = e and week = 6) then
    raise exception 'raw picks must be RLS-hidden from anon before kickoff';
  end if;

  if exists (select 1 from unnest(coalesce(
       (select teams_used from v_entry_public where id = e), '{}'::text[])) t
     where t = team) then
    raise exception 'teams_used must not reveal a team before its game starts';
  end if;
  if (select bye_used from v_entry_public where id = e) then
    raise exception 'future-week bye must not show publicly';
  end if;
end $$;
reset role;

-- ------------------------------------------------------------ admin sees all
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare
  e uuid := (select v from _vis where k = 'entry')::uuid;
  team text := (select v from _vis where k = 'team');
begin
  if (select p.team from picks p where p.entry_id = e and p.week = 6) is distinct from team then
    raise exception 'admin must see the raw pick before kickoff';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ------------------------------------------------------------ kickoff passes
update nfl_games set kickoff_at = now() - interval '1 hour'
 where id = (select v from _vis where k = 'game');

set local role anon;
do $$
declare
  e uuid := (select v from _vis where k = 'entry')::uuid;
  team text := (select v from _vis where k = 'team');
begin
  if (select c.team from v_grid_cells c where c.entry_id = e and c.week = 6) is distinct from team then
    raise exception 'pick must reveal automatically once kickoff passes';
  end if;
  if not exists (select 1 from picks where entry_id = e and week = 6) then
    raise exception 'raw pick should pass RLS after kickoff';
  end if;
  if not exists (select 1 from unnest(
       (select teams_used from v_entry_public where id = e)) t
     where t = team) then
    raise exception 'teams_used should include the team once its game started';
  end if;
end $$;
reset role;

-- ------------------------------------------------------------ override: force lock
update nfl_games set reveal_override = false
 where id = (select v from _vis where k = 'game');

set local role anon;
do $$
declare
  e uuid := (select v from _vis where k = 'entry')::uuid;
begin
  if (select c.team from v_grid_cells c where c.entry_id = e and c.week = 6) <> 'LOCKED' then
    raise exception 'override=false must keep the pick locked past kickoff';
  end if;
end $$;
reset role;

-- ------------------------------------------------------------ override: force reveal
update nfl_games
   set reveal_override = true, kickoff_at = now() + interval '3 days'
 where id = (select v from _vis where k = 'game');

set local role anon;
do $$
declare
  e uuid := (select v from _vis where k = 'entry')::uuid;
  team text := (select v from _vis where k = 'team');
begin
  if (select c.team from v_grid_cells c where c.entry_id = e and c.week = 6) is distinct from team then
    raise exception 'override=true must reveal the pick before kickoff';
  end if;
end $$;
reset role;

-- ------------------------------------------------------------ bye reveals at week start
update nfl_games set kickoff_at = now() - interval '1 hour'
 where id = (select v from _vis where k = 'g7');

set local role anon;
do $$
declare
  e uuid := (select v from _vis where k = 'entry')::uuid;
begin
  if (select c.team from v_grid_cells c where c.entry_id = e and c.week = 7) <> 'SKIP_WEEK' then
    raise exception 'bye should reveal once the week has started';
  end if;
  if not (select bye_used from v_entry_public where id = e) then
    raise exception 'bye_used should show once the week has started';
  end if;
end $$;
reset role;

-- ------------------------------------------------------------ reveal RPC: admin + audit
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare
  gid text := (select v from _vis where k = 'game');
begin
  perform admin_set_game_reveal(gid, null, 'test');
  if (select reveal_override from nfl_games where id = gid) is not null then
    raise exception 'reveal RPC should clear the override back to automatic';
  end if;
  if not exists (select 1 from audit_log
     where action = 'set_game_reveal' and target_id = gid) then
    raise exception 'reveal change must be audited';
  end if;
end $$;

-- Regression: the authenticated ADMIN's score write must persist (the
-- nfl_games write policy was missing before 20260824000018).
do $$
declare
  gid text := (select v from _vis where k = 'game');
begin
  perform admin_set_game_score(gid, 31, 10, 'final', 'test');
  if (select home_score from nfl_games where id = gid) is distinct from 31 then
    raise exception 'admin score write silently failed to persist';
  end if;
  perform admin_set_game_score(gid, null, null, 'scheduled', 'test');
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ------------------------------------------------------------ non-admin refused
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', true);
do $$
declare
  gid text := (select v from _vis where k = 'game');
  ok boolean := false;
begin
  begin
    perform admin_set_game_reveal(gid, true, 'stranger');
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'non-admin must not be able to change game visibility';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ------------------------------------------------------------ raw base guarded
-- (At this point the W6 pick is locked again: override cleared, kickoff
-- pushed back into the future by the override step.)
set local role anon;
do $$
begin
  begin
    perform 1 from v_entry_standing limit 1;
    raise exception 'anon must not read v_entry_standing directly';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', true);
do $$
begin
  if exists (select 1 from v_entry_admin) then
    raise exception 'non-admin authenticated must get zero rows from v_entry_admin';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare
  e uuid := (select v from _vis where k = 'entry')::uuid;
  team text := (select v from _vis where k = 'team');
begin
  if not exists (select 1 from unnest(
       (select teams_used from v_entry_admin where id = e)) t
     where t = team) then
    raise exception 'admin summary must carry raw teams_used while the pick is publicly locked';
  end if;
end $$;
reset role;

rollback;
