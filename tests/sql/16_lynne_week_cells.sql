-- Her week picks in both shapes (20260910000065): the weekly sheet and the
-- plain-text email, into lynne_roster.cells, never into picks.
--
-- What is asserted, and why each block fails without the migration:
--   * cell_sources exists and is admin-only - v_master_list still serves
--     exactly five columns and provenance is not one of them;
--   * anon and a signed-in non-admin cannot call the email RPC;
--   * an email applies only what she states: a NO. she did not name gets
--     nothing, a NO. that is not on her sheet is reported and never invented;
--   * her word is stored VERBATIM ("Seattle", not "SEA"), because the public
--     view matches her vocabulary on that text to decide the reveal;
--   * every applied cell carries source "email" and her Gmail message id;
--   * a second run on the same message writes nothing at all;
--   * a variance stops that row and leaves the cell alone - both when her
--     email contradicts her own sheet cell, and when it contradicts the pick
--     this group holds for one of its 121;
--   * NOTHING is ever written to picks;
--   * a new sheet carries email-written cells forward only into the weeks it
--     leaves blank, keeps its own cells where it states one, and never
--     invents a NO. it does not carry;
--   * the reveal gate is the view's: a cell for a game that has not kicked
--     off does not leave v_master_list.
--
-- Runs through scripts/db/test-db.sh like the other suites.

-- ------------------------------------------------------------ shape
begin;
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'lynne_roster' and column_name = 'cell_sources') then
    raise exception 'lynne_roster.cell_sources missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'admin_apply_lynne_email_cells') then
    raise exception 'admin_apply_lynne_email_cells missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'lynne_cell_week') then
    raise exception 'lynne_cell_week missing';
  end if;
  -- The public view is five columns and provenance is not one of them.
  if exists (select 1 from information_schema.columns
              where table_name = 'v_master_list' and column_name = 'cell_sources') then
    raise exception 'v_master_list must not expose cell_sources';
  end if;
  if (select count(*) from information_schema.columns where table_name = 'v_master_list') <> 5 then
    raise exception 'v_master_list must expose exactly five columns';
  end if;
end $$;
rollback;

-- ------------------------------------------------- the week key, both copies
begin;
do $$
begin
  if lynne_cell_week('Week 1') <> 1 then raise exception 'lynne_cell_week("Week 1") must be 1'; end if;
  if lynne_cell_week('WEEK 12') <> 12 then raise exception 'lynne_cell_week is not case-insensitive'; end if;
  if lynne_cell_week('  wk 3 ') <> 3 then raise exception 'lynne_cell_week must accept her "wk" form and edge space'; end if;
  if lynne_cell_week('NAMES') is not null then raise exception 'lynne_cell_week must return null for a non-week column'; end if;
  if lynne_cell_week('Week 1 total') is not null then raise exception 'lynne_cell_week must not match a longer header'; end if;
end $$;
rollback;

-- ------------------------------------------------------------ anon: nothing
begin;
set local role anon;
do $$
begin
  begin
    perform admin_apply_lynne_email_cells('m', '[{"no":1,"week":1,"team_text":"Seattle","team_abbr":"SEA"}]'::jsonb, 'anon');
    raise exception 'anon must not be able to call admin_apply_lynne_email_cells';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;

-- ------------------------------------------------------ non-admin: refused
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', true);
do $$
begin
  begin
    perform admin_apply_lynne_email_cells('m', '[{"no":1,"week":1,"team_text":"Seattle","team_abbr":"SEA"}]'::jsonb, 'stranger');
    raise exception 'a non-admin must be refused by admin_apply_lynne_email_cells';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;

-- --------------------------------------- Shape B: her email, the real one
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare
  v_res jsonb;
  v_picks_before int;
  v_picks_after int;
  v_cells jsonb;
  v_src jsonb;
begin
  select count(*) into v_picks_before from picks;

  perform admin_load_lynne_roster(repeat('b', 64), 'Football 2026-x.xlsx', 'sheet-msg',
    '[{"no":144,"names":"Chris Mierzwa 11","row":2},
      {"no":573,"names":" Judy Manzi","row":3},
      {"no":1005,"names":"E.A.T.","row":4},
      {"no":1200,"names":"Brett","row":5},
      {"no":1201,"names":"Not named by her","row":6}]'::jsonb, 'test');

  v_res := admin_apply_lynne_email_cells('1a08631cab24c4ce',
    '[{"no":144,"week":1,"team_text":"Seattle","team_abbr":"SEA"},
      {"no":573,"week":1,"team_text":"Seattle","team_abbr":"SEA"},
      {"no":1005,"week":1,"team_text":"Seattle","team_abbr":"SEA"},
      {"no":1200,"week":1,"team_text":"LA Rams","team_abbr":"LAR"},
      {"no":88888,"week":1,"team_text":"Seattle","team_abbr":"SEA"}]'::jsonb, 'test');

  if (v_res->>'written')::int <> 4 then
    raise exception 'expected 4 cells written, got %', v_res->>'written';
  end if;
  if jsonb_array_length(v_res->'unmatched') <> 1
     or (v_res->'unmatched'->0->>'no')::int <> 88888 then
    raise exception 'a NO. that is not on her sheet must be reported, never invented: %', v_res->'unmatched';
  end if;

  -- Her word verbatim, not our code: the view matches her vocabulary on it.
  select cells, cell_sources into v_cells, v_src
    from lynne_roster where sheet_sha256 = repeat('b', 64) and row_no = 144;
  if v_cells->>'Week 1' <> 'Seattle' then
    raise exception 'her word must be stored verbatim, got %', v_cells->>'Week 1';
  end if;
  if v_src->'Week 1'->>'source' <> 'email'
     or v_src->'Week 1'->>'ref' <> '1a08631cab24c4ce'
     or v_src->'Week 1'->>'team' <> 'SEA' then
    raise exception 'the cell must record source email, her message id and the mapped code: %', v_src;
  end if;

  -- Rule 1: her list is partial. A NO. she did not name has nothing.
  select cells into v_cells from lynne_roster
   where sheet_sha256 = repeat('b', 64) and row_no = 1201;
  if v_cells <> '{}'::jsonb then
    raise exception 'a NO. she did not name must have no cell, got %', v_cells;
  end if;

  -- Rule 4: a second run on the same message writes nothing at all.
  v_res := admin_apply_lynne_email_cells('1a08631cab24c4ce',
    '[{"no":1201,"week":1,"team_text":"Miami","team_abbr":"MIA"}]'::jsonb, 'test');
  if not (v_res->>'already_applied')::boolean or (v_res->>'written')::int <> 0 then
    raise exception 'a second run on the same message must write nothing: %', v_res;
  end if;
  select cells into v_cells from lynne_roster
   where sheet_sha256 = repeat('b', 64) and row_no = 1201;
  if v_cells <> '{}'::jsonb then
    raise exception 'the second run wrote a cell it must not have: %', v_cells;
  end if;
  if (select count(*) from audit_log where action = 'apply_lynne_email_cells'
       and target_id = '1a08631cab24c4ce') <> 1 then
    raise exception 'a second run must not write a second audit row';
  end if;

  -- picks is ours and is never touched by her data.
  select count(*) into v_picks_after from picks;
  if v_picks_after <> v_picks_before then
    raise exception 'her email wrote % row(s) to picks; it must write none', v_picks_after - v_picks_before;
  end if;
end $$;
rollback;

-- ------------------------------------------------ a variance stops that row
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare
  v_res jsonb;
  v_cells jsonb;
  v_id uuid;
begin
  -- one of this group's 121 at her NO. 1005, holding a different team
  perform admin_create_owner('Var','Owner','var@example.com','','email','',
                             array['VarEntry'], true, 'test');
  select id into v_id from entries where entry_name = 'VarEntry';
  update entries set lynne_number = 1005 where id = v_id;
  insert into picks (entry_id, week, team, submitted_at, source, is_current)
  values (v_id, 1, 'PHI', now(), 'admin', true);

  perform admin_load_lynne_roster(repeat('c', 64), 's.xlsx', null,
    '[{"no":1005,"names":"E.A.T.","row":2},
      {"no":144,"names":"CM","row":3,"cells":{"Week 1":"Dallas"}}]'::jsonb, 'test');

  v_res := admin_apply_lynne_email_cells('msg-variance',
    '[{"no":1005,"week":1,"team_text":"Seattle","team_abbr":"SEA"},
      {"no":144,"week":1,"team_text":"Seattle","team_abbr":"SEA"}]'::jsonb, 'test');

  if (v_res->>'written')::int <> 0 then
    raise exception 'both rows are variances; nothing may be written, got %', v_res->>'written';
  end if;
  if jsonb_array_length(v_res->'variance') <> 2 then
    raise exception 'expected two variances, got %', v_res->'variance';
  end if;

  -- ours vs hers: reported with BOTH values, and the cell left empty
  if not exists (select 1 from jsonb_array_elements(v_res->'variance') v
                  where (v->>'no')::int = 1005 and v->>'ours' = 'PHI'
                    and v->>'hers' = 'Seattle' and v->>'kind' = 'her email differs from our pick') then
    raise exception 'the ours-vs-hers variance must carry both values: %', v_res->'variance';
  end if;
  select cells into v_cells from lynne_roster where sheet_sha256 = repeat('c', 64) and row_no = 1005;
  if v_cells <> '{}'::jsonb then
    raise exception 'a variance must leave the cell alone, got %', v_cells;
  end if;

  -- hers vs hers: her stored cell is not overwritten
  if not exists (select 1 from jsonb_array_elements(v_res->'variance') v
                  where (v->>'no')::int = 144 and v->>'stored' = 'Dallas' and v->>'stated' = 'Seattle') then
    raise exception 'the hers-vs-hers variance must carry both values: %', v_res->'variance';
  end if;
  select cells into v_cells from lynne_roster where sheet_sha256 = repeat('c', 64) and row_no = 144;
  if v_cells->>'Week 1' <> 'Dallas' then
    raise exception 'her own stored cell must not be overwritten, got %', v_cells;
  end if;

  -- and our pick is untouched: never auto-resolved in either direction
  if (select team from picks where entry_id = v_id and is_current) <> 'PHI' then
    raise exception 'our pick must never be rewritten by her data';
  end if;
end $$;
rollback;

-- -------------------------------------------- Shape A: sheet cells and carry
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare
  v_res jsonb;
  v_cells jsonb;
  v_src jsonb;
begin
  perform admin_load_lynne_roster(repeat('d', 64), 'old.xlsx', null,
    '[{"no":144,"names":"CM","row":2},
      {"no":573,"names":"JM","row":3},
      {"no":9,"names":"She removes this one","row":4}]'::jsonb, 'test');
  perform admin_apply_lynne_email_cells('msg-carry',
    '[{"no":144,"week":1,"team_text":"Seattle","team_abbr":"SEA"},
      {"no":573,"week":1,"team_text":"Seattle","team_abbr":"SEA"},
      {"no":9,"week":1,"team_text":"Miami","team_abbr":"MIA"}]'::jsonb, 'test');

  -- her new sheet: 144 states week 1 herself, 573 leaves it blank, 9 is gone
  v_res := admin_load_lynne_roster(repeat('e', 64), 'new.xlsx', null,
    '[{"no":144,"names":"CM","row":2,"cells":{"WEEK 1":"Buffalo"}},
      {"no":573,"names":"JM","row":3}]'::jsonb, 'test');

  if v_res->>'superseded_sheet' <> repeat('d', 64) then
    raise exception 'the load must name the sheet it supersedes, got %', v_res->>'superseded_sheet';
  end if;
  if jsonb_array_length(v_res->'carried_forward') <> 1
     or (v_res->'carried_forward'->0->>'no')::int <> 573 then
    raise exception 'exactly the blank week of a NO. she still carries is filled: %', v_res->'carried_forward';
  end if;

  -- a sheet cell records the sheet
  select cells, cell_sources into v_cells, v_src
    from lynne_roster where sheet_sha256 = repeat('e', 64) and row_no = 144;
  if v_cells->>'WEEK 1' <> 'Buffalo' then
    raise exception 'her sheet cell must survive the load, got %', v_cells;
  end if;
  if v_src->'WEEK 1'->>'source' <> 'sheet' or v_src->'WEEK 1'->>'ref' <> repeat('e', 64) then
    raise exception 'a sheet cell must record source sheet and the sheet sha256: %', v_src;
  end if;
  -- her sheet is the later statement: the email cell for that week is dropped,
  -- and no second key for the same week is left behind.
  if (select count(*) from jsonb_object_keys(v_cells) k where lynne_cell_week(k) = 1) <> 1 then
    raise exception 'one week must have exactly one key, got %', v_cells;
  end if;

  -- the blank week is filled from the email, message id intact
  select cells, cell_sources into v_cells, v_src
    from lynne_roster where sheet_sha256 = repeat('e', 64) and row_no = 573;
  if v_cells->>'Week 1' <> 'Seattle' then
    raise exception 'a blank week must be filled from the email, got %', v_cells;
  end if;
  if v_src->'Week 1'->>'source' <> 'email' or v_src->'Week 1'->>'ref' <> 'msg-carry' then
    raise exception 'a carried cell must keep its email provenance: %', v_src;
  end if;

  -- a NO. she removed is never re-added: her sheet shrinking is not an error
  if exists (select 1 from lynne_roster where sheet_sha256 = repeat('e', 64) and row_no = 9) then
    raise exception 'a NO. she removed must never be carried back onto her new sheet';
  end if;
end $$;
rollback;

-- ------------------------------------- the reveal gate belongs to the view
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare
  v_cells jsonb;
  v_team text;
  v_week int;
begin
  -- a team whose week-1 game has NOT kicked off
  select g.home_team, g.week into v_team, v_week
    from nfl_games g where g.week = 1 and g.kickoff_at > now()
   order by g.kickoff_at desc limit 1;
  if v_team is null then
    return; -- every week 1 game has kicked off; nothing to assert here
  end if;

  perform admin_load_lynne_roster(repeat('f', 64), 'r.xlsx', null,
    '[{"no":4242,"names":"Masked","row":2}]'::jsonb, 'test');
  perform admin_apply_lynne_email_cells('msg-reveal',
    jsonb_build_array(jsonb_build_object('no', 4242, 'week', v_week,
      'team_text', (select lname from (values ('ARI','Arizona'),('ATL','Atlanta'),('BAL','Baltimore'),
        ('BUF','Buffalo'),('CAR','Carolina'),('CHI','Chicago'),('CIN','Cincinnati'),('CLE','Cleveland'),
        ('DAL','Dallas'),('DEN','Denver'),('DET','Detroit'),('GB','Green Bay'),('HOU','Houston'),
        ('IND','Indianapolis'),('JAX','Jacksonville'),('KC','Kansas City'),('LAC','LA Chargers'),
        ('LAR','LA Rams'),('LV','LV Raiders'),('MIA','Miami'),('MIN','Minnesota'),('NE','New England'),
        ('NO','New Orleans'),('NYG','NY Giants'),('NYJ','NY Jets'),('PHI','Philadelphia'),
        ('PIT','Pittsburgh'),('SEA','Seattle'),('SF','San Francisco'),('TB','Tampa Bay'),
        ('TEN','Tennessee'),('WAS','Washington')) t(abbr, lname) where t.abbr = v_team),
      'team_abbr', v_team)), 'test');

  -- stored in the table...
  select cells into v_cells from lynne_roster where sheet_sha256 = repeat('f', 64) and row_no = 4242;
  if v_cells = '{}'::jsonb then
    raise exception 'the cell must be stored; only the view masks it';
  end if;
  -- ...and masked by the public view until that game kicks off
  select cells into v_cells from v_master_list where row_no = 4242;
  -- Masked means the TEAM is withheld, not that the cell vanishes: the key
  -- stays so the grid can draw a padlock rather than an empty week.
  if v_cells::text ilike '%' || lower(v_team) || '%' then
    raise exception 'v_master_list must mask a cell whose game has not kicked off, got %', v_cells;
  end if;
  if (select count(*) from jsonb_each_text(v_cells)) <> 1 then
    raise exception 'the masked cell must still carry exactly its one key, got %', v_cells;
  end if;
  if (select value from jsonb_each_text(v_cells) limit 1) <> 'LOCKED' then
    raise exception 'a masked cell must read LOCKED, got %', v_cells;
  end if;
end $$;
rollback;
