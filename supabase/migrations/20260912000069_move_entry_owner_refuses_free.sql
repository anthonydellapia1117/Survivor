-- admin_move_entry_owner refuses a FREE entry. Codex found this on #93, and
-- it was right where the note I shipped with that migration was wrong.
--
-- WHAT I GOT WRONG, AND HOW
--
-- 20260912000068's header claims the entitlement cannot move because
-- mint_free_entries "counts live non-free entries joined to non-archived
-- owners". The first half is the RECRUITED count and is right. The second
-- half -- what is HELD -- I read off migration 20260904000048
-- ("free_entries_counted_pool_wide") and assumed it was current. It is not:
-- 20260904000049 ("entitlement_is_the_runners") came after it and put the
-- held count back onto the runner's own rows, on the reasoning that a free
-- entry sitting under somebody else is not part of what he earned and
-- counting it suppresses a mint he is owed. The live function is the answer;
-- a migration file is only the answer if nothing later touched it.
--
-- THE CONSEQUENCE, REPRODUCED BEFORE IT WAS FIXED
--
-- Moving a free entry off the runner drops the held count by one while the
-- entitlement stands still, so the trigger mints a REPLACEMENT in the same
-- transaction. Observed on a fixture roster: free entries 5 before the move,
-- 6 after. In production that is an AAA number Lynne does not hold, a pool
-- holding one more free entry than it has earned, and a free entry owned by
-- somebody who is not Anthony -- three wrong rows from one call.
--
-- WHY REFUSE RATHER THAN CLEAR THE FLAG
--
-- Free entries are Anthony's only. The way somebody else comes to PLAY one is
-- player_email -- the ordinary gift, which is what Alexa has on AAA #3, #6 and
-- #9 -- and that moves who plays without moving who owns, so the held count
-- never changes. Clearing is_free_entry to permit the move would instead
-- convert a free entry into a recruited one, which raises the recruited count,
-- bills somebody $25, and changes what is owed to Lynne. A split is not a
-- mechanism for either of those things, so it declines to be one.

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

  -- THE FREE-ENTRY REFUSAL. See the header: moving one mints a replacement
  -- under the runner, so this would create a free entry the pool has not
  -- earned and an AAA number Lynne does not hold. A giftee plays a free entry
  -- through player_email, which moves the player and not the owner.
  if (v_before ->> 'is_free_entry')::boolean then
    raise exception
      'entry % is a free entry; free entries are the runner''s only. Moving one mints a replacement under him. To let somebody else PLAY it, set player_email (a gift), which does not move ownership',
      p_entry_id;
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
