-- One entry moves to a different owner, and NOTHING else moves with it.
--
-- WHY THIS FUNCTION HAS TO EXIST
--
-- Nothing here could do it. `admin_update_entry` has no owner_id parameter at
-- all, and `admin_merge_owner` moves EVERY entry off its source and then
-- archives it -- so using it to move one of an owner's two entries takes the
-- other one too and deletes an owner who is still playing. The remaining
-- shape, void-and-recreate, is the worst of the three: it mints a new entry
-- id, cannot reuse the lynne_number (it is unique), and drops the week's pick.
--
-- The case is a split, not a correction: two entries bought together turn out
-- to belong to two people. Lynne is not told, because nothing she holds moves
-- -- her sheet is keyed on the NUMBER and the LABEL, and this writes neither.
--
-- WHAT IT WRITES
--
-- owner_id, and entry_index only when it has to. Everything that identifies
-- the entry to a human or to her sheet -- entry_name, name_is_default,
-- lynne_number, lynne_label, is_gifted, player_email, is_free_entry -- is
-- deliberately absent from the update statement, and so are `picks`: a pick
-- belongs to the ENTRY, so an entry that changes hands keeps the pick it
-- already holds and is never re-asked for it.
--
-- entry_index is the one exception and it is not identity: it is a per-owner
-- ordinal under a UNIQUE (owner_id, entry_index) constraint, so an entry
-- moving onto an owner who already uses that ordinal would fail the
-- constraint. It keeps its own index when that index is free under the new
-- owner (the ordinary case, and the one that writes nothing extra) and takes
-- the next free one when it is not. The "#2" a reader sees is in the NAME,
-- which does not move.
--
-- The note is REQUIRED rather than optional. This is the one write in the
-- schema whose reason cannot be reconstructed from the row afterwards: the
-- before/after JSON shows an owner_id changing and nothing about why, or
-- which arrangement it settles. A blank note is refused.
--
-- The free-entry entitlement cannot move here and this is worth stating: the
-- mint_free_entries trigger counts live non-free entries joined to
-- non-archived owners, so moving one such entry between two live owners
-- leaves the recruited count exactly where it was.

create or replace function admin_move_entry_owner(
  p_entry_id uuid,
  p_owner_id uuid,
  p_note     text,
  p_actor    text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_from   uuid;
  v_index  int;
  v_note   text;
  v_target owners%rowtype;
begin
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is null then
    raise exception 'a note is required: it names both owners and the reason for the move';
  end if;

  select to_jsonb(e) - 'created_at', e.owner_id, e.entry_index
    into v_before, v_from, v_index
    from entries e where e.id = p_entry_id;
  if v_before is null then
    raise exception 'entry % not found', p_entry_id;
  end if;
  if (v_before ->> 'voided_at') is not null then
    raise exception 'entry % is voided; a voided entry is not moved', p_entry_id;
  end if;

  select * into v_target from owners o where o.id = p_owner_id;
  if v_target.id is null then
    raise exception 'owner % not found', p_owner_id;
  end if;
  if v_target.deleted_at is not null then
    raise exception 'owner % is archived; an entry is never moved onto an archived owner', p_owner_id;
  end if;
  if v_from = p_owner_id then
    raise exception 'entry % is already owned by %', p_entry_id, p_owner_id;
  end if;

  -- Its own ordinal when free under the new owner, the next one when not.
  if exists (select 1 from entries e
              where e.owner_id = p_owner_id and e.entry_index = v_index) then
    select coalesce(max(e.entry_index), 0) + 1 into v_index
      from entries e where e.owner_id = p_owner_id;
  end if;

  -- The ONLY two columns this statement names.
  update entries
     set owner_id    = p_owner_id,
         entry_index = v_index
   where id = p_entry_id;

  select to_jsonb(e) - 'created_at' into v_after from entries e where e.id = p_entry_id;
  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'move_entry_owner', 'entries', p_entry_id::text, v_before, v_after, v_note);
end $$;

revoke all on function admin_move_entry_owner(uuid, uuid, text, text) from public;
grant execute on function admin_move_entry_owner(uuid, uuid, text, text) to authenticated;
