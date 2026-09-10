-- Her week picks, in the two shapes she publishes them, into lynne_roster.
--
-- Set by Anthony on 2026-09-10. She states a week's picks two ways and both
-- are her data, so both land in the same place -- `lynne_roster.cells` -- and
-- neither ever writes to `picks`. `picks` is this group's record of what its
-- own 121 chose; `lynne_roster` is her sheet as she published it. The two are
-- compared and never merged.
--
--   Shape A, the weekly sheet. A Football xlsx with the week columns filled,
--   Saturday or Sunday. It arrives as a new sha256 and a new set of rows
--   through admin_load_lynne_roster, which already carried her filled cells;
--   what changes here is that each cell now records where it came from.
--
--   Shape B, a plain-text email with no attachment. A heading naming a team,
--   then lines of "#<NO.>-<name>". The first was Gmail message
--   1a08631cab24c4ce, "Wednesday and Thursday Games", 2026-09-09 8:43 AM ET.
--   It is applied by admin_apply_lynne_email_cells, below.
--
-- FIVE RULES, all enforced here rather than in the script that calls it.
--
-- 1. HER LIST IS PARTIAL. A NO. she does not name has no pick recorded and is
--    not eliminated. Only what she states is stored. There is no default, no
--    fill-down and no inference from silence.
--
-- 2. PROVENANCE PER CELL. `cell_sources` carries, for each key in `cells`,
--    which shape wrote it and what it came from: a sheet's sha256 or a Gmail
--    message id. Without it a cell written from an email is indistinguishable
--    from one she typed on a sheet, and the next sheet load cannot tell which
--    of its own blanks it is allowed to fill.
--
-- 3. A VARIANCE STOPS THAT ROW. Where she names one of this group's 121 and
--    her team differs from the pick this group holds, the row is reported and
--    NOT written. The same goes for a cell she has already stated differently.
--    Neither side is corrected and neither is assumed wrong: CLAUDE.md's rule
--    is that the difference is surfaced with both values and Anthony decides.
--
-- 4. IDEMPOTENT ON THE MESSAGE. A second run on the same Gmail message writes
--    nothing at all. The guard is an audit row, so it holds for a re-run of
--    the script, a second ops tick in the same window, and SQL applied by
--    hand -- not only for a path that happens to go through the CLI.
--
-- 5. THE REVEAL GATE IS THE VIEW'S, AND IS UNTOUCHED. Nothing here decides
--    what the public sees. `v_master_list` already serves a cell naming one
--    of her teams only once pick_is_public says that team's game has kicked
--    off, and a cell that is not a team name only once every game of the week
--    has. Cells are therefore stored as SHE WROTE THEM -- "Seattle", not
--    "SEA" -- because that verbatim text is what the view matches her
--    vocabulary against. The mapped abbreviation is used for the variance
--    check and recorded in `cell_sources`; it is never what is stored in the
--    cell. Storing our code would silently fall through to the
--    every-game-kicked-off branch and reveal a pick early.

-- --------------------------------------------------------------- provenance
alter table lynne_roster
  add column cell_sources jsonb not null default '{}'::jsonb;

comment on column lynne_roster.cell_sources is
  'Per-cell provenance for `cells`, same keys: {"source":"sheet"|"email","ref":<sha256 or gmail message id>,"team":<mapped abbreviation, email cells only>,"at":<timestamp>}. Admin-only; never exposed by v_master_list, which serves exactly five columns.';

-- Rows loaded before this column existed carry sheet-sourced cells by
-- definition -- admin_load_lynne_roster was the only writer. Backfill from
-- the row's own keys so `cells` and `cell_sources` agree from the start.
-- (On 2026-09-10 every one of the 1,319 stored rows has an empty `cells`, so
-- this moves nothing; it is written for the sheets loaded after it.)
update lynne_roster r
   set cell_sources = (
         select coalesce(jsonb_object_agg(k, jsonb_build_object(
                  'source', 'sheet',
                  'ref', r.sheet_sha256,
                  'at', to_char(r.loaded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))), '{}'::jsonb)
           from jsonb_object_keys(r.cells) k)
 where r.cells <> '{}'::jsonb;

-- ------------------------------------------------------------- the week key
-- Her column headers are hers: "Week 1", "WEEK 1", "wk 1". This is the one
-- place that decides which header names a week, so an email-written cell
-- reuses the header she already has on that row rather than adding a second
-- key for the same week -- two keys for one week would render twice on the
-- Master List.
--
-- v_master_list (20260908224500) carries the same pattern inline. The two
-- copies are held together by tests/unit/lynne-week-key-sql.test.ts, the same
-- way tests/unit/lynne-team-names-sql.test.ts holds her team vocabulary and
-- the TypeScript copy together. The view is deliberately NOT rewritten to
-- call this: it is the public read path, it works, and changing a public view
-- to remove a duplicated regex is not a change to make the week the season
-- opens.
create or replace function lynne_cell_week(p_key text)
returns int
language sql
immutable
set search_path = public, pg_temp
as $$
  select (regexp_match(p_key, '^\s*(?:week|wk)\s*(\d{1,2})\s*$', 'i'))[1]::int
$$;

comment on function lynne_cell_week(text) is
  'The week a lynne_roster cell key names, or null when the key is not a week column. Mirrors the inline pattern in v_master_list; tests/unit/lynne-week-key-sql.test.ts holds the two together.';

-- ------------------------------------------------ Shape B: her plain-text email
-- One Gmail message, the NO.s she named and the team she named them under.
--
-- p_rows: [{"no": 144, "week": 1, "team_text": "Seattle", "team_abbr": "SEA"}]
--
-- `team_text` is her word, stored verbatim in the cell. `team_abbr` is that
-- word mapped to this app's code by the caller (src/lib/lynne/names.ts); a
-- word that does not map exactly never reaches here, because the caller stops
-- and prints it. It is re-checked below against a team that actually plays,
-- so a wrong mapping cannot be written even if a caller skipped its own check.
--
-- MATCHING IS BY NO. ONLY, never by name. Her NAMES text is free-form, it
-- repeats (Ian Lubin twice), and it carries her own typos; her NO. is the key
-- of this table and the identity this group's entries are submitted under.
create or replace function admin_apply_lynne_email_cells(
  p_gmail_message_id text,
  p_rows jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet text;
  v_bad int;
  v_applied jsonb := '[]'::jsonb;
  v_unchanged jsonb := '[]'::jsonb;
  v_unmatched jsonb := '[]'::jsonb;
  v_variance jsonb := '[]'::jsonb;
  r record;
  v_key text;
  v_existing text;
  v_ours record;
  v_now text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if not is_admin() then
    raise exception 'admin_apply_lynne_email_cells: not the admin'
      using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_gmail_message_id, '')), '') is null then
    raise exception 'a gmail message id is required: it is what makes this idempotent';
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor is required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'rows must be a non-empty json array';
  end if;

  -- Rule 4. The guard is the audit row, so it holds however this is called.
  -- Checked before anything is read, and returning early writes nothing.
  if exists (select 1 from audit_log
              where action = 'apply_lynne_email_cells'
                and target_id = btrim(p_gmail_message_id)) then
    return jsonb_build_object('already_applied', true, 'gmail_message_id', btrim(p_gmail_message_id),
                              'written', 0, 'applied', '[]'::jsonb, 'unchanged', '[]'::jsonb,
                              'unmatched', '[]'::jsonb, 'variance', '[]'::jsonb);
  end if;

  select count(*) into v_bad
    from jsonb_array_elements(p_rows) x
   where jsonb_typeof(x->'no') <> 'number'
      or (x->>'no') !~ '^[0-9]+$'
      or jsonb_typeof(x->'week') <> 'number'
      or (x->>'week') !~ '^[0-9]{1,2}$'
      or (x->>'week')::int not between 1 and 18
      or jsonb_typeof(x->'team_text') <> 'string'
      or btrim(x->>'team_text') = ''
      or jsonb_typeof(x->'team_abbr') <> 'string'
      or (x->>'team_abbr') !~ '^[A-Z]{2,3}$';
  if v_bad <> 0 then
    raise exception '% row(s) lack an integer NO., a week 1-18, her team word and a mapped abbreviation; nothing written', v_bad;
  end if;

  select count(*) - count(distinct ((x->>'no') || ':' || (x->>'week'))) into v_bad
    from jsonb_array_elements(p_rows) x;
  if v_bad <> 0 then
    raise exception 'the payload names the same NO. twice for one week (% time(s)); nothing written', v_bad;
  end if;

  -- A mapped abbreviation that is not a team in the schedule is a caller bug,
  -- not her data. Checked against the whole season, not the stated week: a
  -- team on its bye plays no game that week and is still a real team.
  select count(*) into v_bad
    from jsonb_array_elements(p_rows) x
   where not exists (select 1 from nfl_games g
                      where g.home_team = x->>'team_abbr' or g.away_team = x->>'team_abbr');
  if v_bad <> 0 then
    raise exception '% row(s) carry an abbreviation that is no team in the schedule; nothing written', v_bad;
  end if;

  -- Her newest sheet is the one the Master List serves, so it is the one her
  -- email is about. Every row of a load shares its loaded_at.
  select sheet_sha256 into v_sheet
    from lynne_roster order by loaded_at desc, sheet_sha256 limit 1;
  if v_sheet is null then
    raise exception 'no sheet of hers is loaded; a week cell hangs off one of her rows and there are none';
  end if;

  for r in
    select (x->>'no')::int as no, (x->>'week')::int as week,
           x->>'team_text' as team_text, x->>'team_abbr' as team_abbr
      from jsonb_array_elements(p_rows) x
     order by 1, 2
  loop
    -- Rule 1: a NO. that is not on her sheet is reported, never invented.
    if not exists (select 1 from lynne_roster
                    where sheet_sha256 = v_sheet and row_no = r.no) then
      v_unmatched := v_unmatched || jsonb_build_object('no', r.no, 'week', r.week, 'team', r.team_text);
      continue;
    end if;

    -- Reuse the header she already has for this week; only invent one when
    -- she has none, and then in the shape her sheets use.
    select k.key into v_key
      from lynne_roster lr
      cross join lateral jsonb_object_keys(lr.cells) as k(key)
     where lr.sheet_sha256 = v_sheet and lr.row_no = r.no
       and lynne_cell_week(k.key) = r.week
     limit 1;
    if v_key is null then v_key := 'Week ' || r.week; end if;

    select cells->>v_key into v_existing
      from lynne_roster where sheet_sha256 = v_sheet and row_no = r.no;

    -- Rule 3a: she has already said something else for this cell.
    if v_existing is not null and lower(btrim(v_existing)) <> lower(btrim(r.team_text)) then
      v_variance := v_variance || jsonb_build_object(
        'no', r.no, 'week', r.week, 'kind', 'her cell differs from her email',
        'stored', v_existing, 'stated', r.team_text);
      continue;
    end if;

    -- Rule 3b: she names one of ours and it differs from the pick we hold.
    select e.id, e.entry_name, p.team into v_ours
      from entries e
      join owners o on o.id = e.owner_id
      left join picks p on p.entry_id = e.id and p.week = r.week and p.is_current
     where e.lynne_number = r.no
       and e.voided_at is null
       and o.participation_status = 'confirmed'
       and o.deleted_at is null
     limit 1;
    if found and v_ours.team is not null and v_ours.team <> r.team_abbr then
      v_variance := v_variance || jsonb_build_object(
        'no', r.no, 'week', r.week, 'kind', 'her email differs from our pick',
        'entry', v_ours.entry_name, 'ours', v_ours.team,
        'hers', r.team_text, 'hers_abbr', r.team_abbr);
      continue;
    end if;

    if v_existing is not null then
      v_unchanged := v_unchanged || jsonb_build_object('no', r.no, 'week', r.week, 'team', v_existing);
      continue;
    end if;

    update lynne_roster
       set cells = cells || jsonb_build_object(v_key, r.team_text),
           cell_sources = cell_sources || jsonb_build_object(v_key, jsonb_build_object(
             'source', 'email', 'ref', btrim(p_gmail_message_id),
             'team', r.team_abbr, 'at', v_now))
     where sheet_sha256 = v_sheet and row_no = r.no;

    v_applied := v_applied || jsonb_build_object('no', r.no, 'week', r.week,
                                                 'team', r.team_text, 'abbr', r.team_abbr,
                                                 'key', v_key);
  end loop;

  insert into audit_log (actor, action, target_table, target_id, after, note)
  values (p_actor, 'apply_lynne_email_cells', 'lynne_roster', btrim(p_gmail_message_id),
          jsonb_build_object('sheet_sha256', v_sheet,
                             'applied', v_applied, 'unchanged', v_unchanged,
                             'unmatched', v_unmatched, 'variance', v_variance),
          'Her plain-text pick email into her own week cells. Matched on her NO. only, never on a name. Her list is partial: a NO. she did not name has no pick recorded and is not eliminated. Writes nothing to picks. A variance is reported and that row is left alone.');

  return jsonb_build_object('already_applied', false,
                            'gmail_message_id', btrim(p_gmail_message_id),
                            'sheet_sha256', v_sheet,
                            'written', jsonb_array_length(v_applied),
                            'applied', v_applied, 'unchanged', v_unchanged,
                            'unmatched', v_unmatched, 'variance', v_variance);
end $$;

revoke execute on function admin_apply_lynne_email_cells(text, jsonb, text) from public;
do $$
begin
  revoke execute on function admin_apply_lynne_email_cells(text, jsonb, text) from anon;
  grant execute on function admin_apply_lynne_email_cells(text, jsonb, text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;

-- ------------------------------------------------- Shape A: her weekly sheet
-- admin_load_lynne_roster gains two things and loses none of its rules. It
-- still refuses a sha256 it has seen, still never updates or deletes a loaded
-- row, still creates no owner and no entry, still keeps her duplicate names as
-- separate rows.
--
-- 1. Every cell the sheet carries records its provenance: source "sheet" and
--    the sheet's own sha256.
--
-- 2. CARRY-FORWARD. A new sheet is a new set of rows, so without this a sheet
--    that arrives before she has filled a week would silently drop what she
--    stated by email for that week -- her Wednesday email is true whether or
--    not Saturday's sheet has caught up with it. So for each NO. the new sheet
--    also carries, every email-written cell on the PREVIOUS newest sheet whose
--    week the NEW sheet leaves blank is copied across, provenance and message
--    id intact. A week the new sheet DOES state is hers as published and wins;
--    the email cell is dropped, because her sheet is the later statement.
--
--    It is deliberately one-directional and only ever fills a blank. It never
--    overwrites a cell the new sheet carries, never carries a sheet-sourced
--    cell forward (a sheet's cells belong to that sheet), and never invents a
--    row: a NO. that is not on the new sheet is one she removed, and CLAUDE.md
--    is explicit that her sheet shrinking is not a data error.
create or replace function admin_load_lynne_roster(
  p_sheet_sha256 text,
  p_source_file text,
  p_gmail_message_id text,
  p_rows jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_dupe_names int;
  v_dupe_nos int;
  v_bad int;
  v_prior text;
  v_carried jsonb := '[]'::jsonb;
  v_now text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  c record;
begin
  if not is_admin() then
    raise exception 'admin_load_lynne_roster: not the admin'
      using errcode = 'insufficient_privilege';
  end if;
  if p_sheet_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'sheet sha256 must be 64 lowercase hex characters';
  end if;
  if nullif(trim(coalesce(p_source_file, '')), '') is null then
    raise exception 'source_file is required';
  end if;
  if nullif(trim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor is required';
  end if;
  if exists (select 1 from lynne_roster where sheet_sha256 = p_sheet_sha256) then
    raise exception 'sheet % is already loaded; a sheet is loaded once and never rewritten', p_sheet_sha256;
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'rows must be a non-empty json array';
  end if;

  select count(*) into v_bad
    from jsonb_array_elements(p_rows) r
   where jsonb_typeof(r->'no') <> 'number'
      or (r->>'no') !~ '^[0-9]+$'
      or jsonb_typeof(r->'names') <> 'string'
      or (r->>'names') = ''
      or jsonb_typeof(r->'row') <> 'number';
  if v_bad <> 0 then
    raise exception '% rows lack an integer no, a names text or a row index; nothing loaded', v_bad;
  end if;

  select count(*) - count(distinct (r->>'no')::int) into v_dupe_nos
    from jsonb_array_elements(p_rows) r;
  if v_dupe_nos <> 0 then
    raise exception 'the payload repeats a NO. % time(s); her NO. is the key and nothing was loaded', v_dupe_nos;
  end if;

  -- The sheet this one supersedes, read BEFORE its own rows land.
  select sheet_sha256 into v_prior
    from lynne_roster order by loaded_at desc, sheet_sha256 limit 1;

  insert into lynne_roster (sheet_sha256, row_no, names, row_index, cells, cell_sources, source_file, gmail_message_id, loaded_by)
  select p_sheet_sha256,
         (r->>'no')::int,
         r->>'names',
         (r->>'row')::int,
         case when jsonb_typeof(r->'cells') = 'object' then r->'cells' else '{}'::jsonb end,
         case when jsonb_typeof(r->'cells') = 'object'
              then (select coalesce(jsonb_object_agg(k, jsonb_build_object(
                             'source', 'sheet', 'ref', p_sheet_sha256, 'at', v_now)), '{}'::jsonb)
                      from jsonb_object_keys(r->'cells') k)
              else '{}'::jsonb end,
         p_source_file,
         nullif(trim(coalesce(p_gmail_message_id, '')), ''),
         p_actor
    from jsonb_array_elements(p_rows) r;
  get diagnostics v_count = row_count;

  -- Carry-forward. Only email-written cells, only onto a NO. the new sheet
  -- also carries, only for a week the new sheet leaves blank.
  if v_prior is not null then
    for c in
      select prior.row_no, k.key as key, prior.cells->>k.key as value,
             prior.cell_sources->k.key as src, lynne_cell_week(k.key) as week
        from lynne_roster prior
        join lynne_roster fresh
          on fresh.sheet_sha256 = p_sheet_sha256 and fresh.row_no = prior.row_no
        cross join lateral jsonb_object_keys(prior.cells) as k(key)
       where prior.sheet_sha256 = v_prior
         and prior.cell_sources->k.key->>'source' = 'email'
         and lynne_cell_week(k.key) is not null
         and not exists (
               select 1 from jsonb_object_keys(fresh.cells) fk
                where lynne_cell_week(fk) = lynne_cell_week(k.key))
       order by prior.row_no, k.key
    loop
      update lynne_roster
         set cells = cells || jsonb_build_object(c.key, c.value),
             cell_sources = cell_sources || jsonb_build_object(c.key, c.src)
       where sheet_sha256 = p_sheet_sha256 and row_no = c.row_no;
      v_carried := v_carried || jsonb_build_object('no', c.row_no, 'week', c.week,
                                                   'team', c.value, 'ref', c.src->>'ref');
    end loop;
  end if;

  -- Duplicate names are hers to carry; they are counted for the report and kept.
  select count(*) - count(distinct lower(btrim(names))) into v_dupe_names
    from lynne_roster where sheet_sha256 = p_sheet_sha256;

  insert into audit_log (actor, action, target_table, target_id, after, note)
  values (p_actor, 'load_lynne_roster', 'lynne_roster', p_sheet_sha256,
          jsonb_build_object('rows', v_count, 'duplicate_names', v_dupe_names,
                             'source_file', p_source_file,
                             'gmail_message_id', nullif(trim(coalesce(p_gmail_message_id, '')), ''),
                             'carried_forward', v_carried,
                             'superseded_sheet', v_prior),
          'Her sheet stored as she sent it: NAMES verbatim, one row per NO.; duplicate names kept as separate rows, never merged. Creates no owner and no entry. Email-written week cells the new sheet leaves blank are carried across with their message id; a week the sheet states is hers as published and wins.');

  return jsonb_build_object('sheet_sha256', p_sheet_sha256, 'rows', v_count,
                            'duplicate_names', v_dupe_names,
                            'carried_forward', v_carried,
                            'superseded_sheet', v_prior);
end $$;

revoke execute on function admin_load_lynne_roster(text, text, text, jsonb, text) from public;
do $$
begin
  revoke execute on function admin_load_lynne_roster(text, text, text, jsonb, text) from anon;
  grant execute on function admin_load_lynne_roster(text, text, text, jsonb, text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
