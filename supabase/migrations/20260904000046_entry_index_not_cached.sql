-- Derive entry_index per insert instead of from a counter cached before the
-- loop. Codex's finding, reproduced against a real database.
--
-- THE BUG
--
-- admin_create_owner and admin_add_entries both read max(entry_index) ONCE and
-- then increment a local counter per entry. That is an assumption that nothing
-- else writes to this owner's entries between iterations. It has always been
-- an assumption; the free-entry trigger made it false.
--
-- Each insert in those loops is its own statement, so the trigger fires
-- between iterations. When the owner is the RUNNER and one of those entries
-- crosses a threshold, the mint takes max(entry_index) + 1 -- the very index
-- the loop is about to use next:
--
--   admin_create_owner for the runner with two entries, against a standing
--   backlog of 47 recruited:
--     ERROR: duplicate key value violates unique constraint
--            "entries_owner_id_entry_index_key"
--     DETAIL: Key (owner_id, entry_index)=(1166edef-..., 1) already exists.
--
--   admin_add_entries(runner, ARRAY['Anthony buy 1','Anthony buy 2']) at 49
--   recruited, where the first entry crosses 50:
--     DETAIL: Key (owner_id, entry_index)=(48363d34-..., 6) already exists.
--
-- Both roll back the whole RPC. This is reachable in ordinary use: Anthony
-- buying entries for himself is a normal thing to do -- CLAUDE.md says outright
-- that if the runner buys an entry it counts as recruited -- and doing it while
-- the roster sits one short of a multiple of ten is all it takes.
--
-- THE FIX, AND WHY IT GOES HERE
--
-- The mint cannot know which index the caller has reserved, and asking it to
-- guess would just move the assumption. The cached counter is the actual
-- defect, so it is what changes: each insert reads the current maximum. That
-- also removes a latent hazard these two RPCs always carried, independent of
-- the trigger -- anything else writing an entry for the same owner mid-loop
-- would have collided the same way.
--
-- Cost is one extra index scan per entry inserted, on batches of one to four.
--
-- The mint's own loop keeps its local counter, and correctly: it runs inside a
-- single statement, holds the advisory lock, and re-enters the trigger only at
-- pg_trigger_depth() > 1, where it returns immediately. Nothing can interleave
-- with it.

create or replace function admin_create_owner(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_source text,
  p_notes text,
  p_entry_names text[],
  p_name_is_default boolean,
  p_actor text
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_name text;
begin
  insert into owners (first_name, last_name, email, phone, source, notes)
  values (p_first_name, p_last_name, nullif(p_email, ''), nullif(p_phone, ''),
          coalesce(nullif(p_source, ''), 'email'), nullif(p_notes, ''))
  returning id into v_owner_id;

  if p_entry_names is not null then
    foreach v_name in array p_entry_names loop
      -- Read the maximum each time. Creating this owner may itself have
      -- settled a free-entry backlog (the mint runs on `owners` too), and the
      -- next entry in this loop must land after whatever that took.
      insert into entries (owner_id, entry_index, entry_name, name_is_default)
      values (v_owner_id,
              (select coalesce(max(e.entry_index), 0) + 1
                 from entries e where e.owner_id = v_owner_id),
              v_name, coalesce(p_name_is_default, false));
    end loop;
  end if;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'create_owner', 'owners', v_owner_id::text,
          jsonb_build_object('first_name', p_first_name, 'last_name', p_last_name,
                             'entries', coalesce(array_length(p_entry_names, 1), 0)));
  return v_owner_id;
end $$;

create or replace function admin_add_entries(
  p_owner_id uuid,
  p_entry_names text[],
  p_name_is_default boolean,
  p_is_free boolean,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  foreach v_name in array p_entry_names loop
    -- As above: an earlier entry in this same loop may have crossed a
    -- threshold and minted, taking the index a cached counter would reuse.
    insert into entries (owner_id, entry_index, entry_name, name_is_default, is_free_entry)
    values (p_owner_id,
            (select coalesce(max(e.entry_index), 0) + 1
               from entries e where e.owner_id = p_owner_id),
            v_name, coalesce(p_name_is_default, false), coalesce(p_is_free, false));
  end loop;
  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'add_entries', 'entries', p_owner_id::text,
          jsonb_build_object('names', p_entry_names, 'is_free', p_is_free));
end $$;
