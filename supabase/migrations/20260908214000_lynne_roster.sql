-- Lynne's master sheet as a read-only reference.
--
-- Every row of the newest Football xlsx she sends, keyed by the sheet's
-- sha256 and her NO., with the NAMES cell exactly as she wrote it: case,
-- internal spacing, trailing spaces and her spelling ("Andrew Dicicco"). The
-- week columns she has filled ride along as jsonb, header text to cell text.
--
-- What it is for: her numbering is the identity Anthony submits picks under,
-- and until 2026-09-08 the only copy of her sheet lived in Gmail. With the
-- sheet in the database the renumber of that day can be checked against it,
-- and the next sheet can be diffed against the last one before anything is
-- written (scripts/lynne/roster.ts prints added, removed and renamed rows
-- against the prior sha256; it never writes silently).
--
-- What it never does: it never creates owners or entries, never changes a
-- lynne_number, and is never updated or deleted. A new sheet is a new
-- sha256, loaded beside the old one. Her sheet carries duplicate names (Ian
-- Lubin 1 and 2 at 674-675 and again at 1319-1320 on the 2026-09-08 sheet);
-- they are stored as-is, one row per NO., never merged.
--
-- Write path: admin_load_lynne_roster only. RLS on, admin read only, no
-- write policy, the same shape as pending_actions (20260905000063).

create table lynne_roster (
  sheet_sha256 text not null,
  row_no int not null,
  -- Her NAMES cell verbatim. Never trimmed, cased or spelled for her.
  names text not null,
  -- The sheet row the cell came from (1-based, header is row 1).
  row_index int not null,
  -- Her week columns as she wrote them, header text to cell text; empty cells absent.
  cells jsonb not null default '{}'::jsonb,
  source_file text not null,
  gmail_message_id text,
  loaded_at timestamptz not null default now(),
  loaded_by text not null,
  primary key (sheet_sha256, row_no),
  constraint lynne_roster_sha256_shape check (sheet_sha256 ~ '^[0-9a-f]{64}$'),
  constraint lynne_roster_row_no_positive check (row_no > 0)
);

comment on table lynne_roster is
  'Lynne''s master sheet, one row per NO. per sheet sha256, NAMES verbatim. Read-only reference; loaded only by admin_load_lynne_roster; never updated or deleted; never creates owners or entries.';

create index lynne_roster_names_idx on lynne_roster (sheet_sha256, lower(btrim(names)));
create index lynne_roster_loaded_idx on lynne_roster (loaded_at desc);

alter table lynne_roster enable row level security;

create policy admin_read_lynne_roster on lynne_roster
  for select using (is_admin());

-- The only write path. Refuses a sheet already loaded (the sha256 is the
-- identity), a payload that is not a non-empty array, a row without an
-- integer NO. and a NAMES text, and a NO. that repeats within the payload.
-- Writes every row and one audit row in the same transaction.
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

  insert into lynne_roster (sheet_sha256, row_no, names, row_index, cells, source_file, gmail_message_id, loaded_by)
  select p_sheet_sha256,
         (r->>'no')::int,
         r->>'names',
         (r->>'row')::int,
         case when jsonb_typeof(r->'cells') = 'object' then r->'cells' else '{}'::jsonb end,
         p_source_file,
         nullif(trim(coalesce(p_gmail_message_id, '')), ''),
         p_actor
    from jsonb_array_elements(p_rows) r;
  get diagnostics v_count = row_count;

  -- Duplicate names are hers to carry; they are counted for the report and kept.
  select count(*) - count(distinct lower(btrim(names))) into v_dupe_names
    from lynne_roster where sheet_sha256 = p_sheet_sha256;

  insert into audit_log (actor, action, target_table, target_id, after, note)
  values (p_actor, 'load_lynne_roster', 'lynne_roster', p_sheet_sha256,
          jsonb_build_object('rows', v_count, 'duplicate_names', v_dupe_names,
                             'source_file', p_source_file,
                             'gmail_message_id', nullif(trim(coalesce(p_gmail_message_id, '')), '')),
          'Her sheet stored as she sent it: NAMES verbatim, one row per NO.; duplicate names kept as separate rows, never merged. Creates no owner and no entry.');

  return jsonb_build_object('sheet_sha256', p_sheet_sha256, 'rows', v_count, 'duplicate_names', v_dupe_names);
end $$;

revoke execute on function admin_load_lynne_roster(text, text, text, jsonb, text) from public;
do $$
begin
  revoke execute on function admin_load_lynne_roster(text, text, text, jsonb, text) from anon;
  grant execute on function admin_load_lynne_roster(text, text, text, jsonb, text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
