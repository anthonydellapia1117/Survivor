-- Serialize the free-entry mint, so two concurrent roster writes cannot both
-- try to mint the same AAA number.
--
-- THE RACE (reproduced against a real database, not theorised)
--
-- mint_free_entries reads the entitlement, the count held, and
-- max(entry_index) with no lock, then inserts. Under READ COMMITTED -- what
-- PostgREST uses -- two transactions that each cross the same threshold both
-- read "held 4, owed 5" and both try to insert AAA #5 at the same
-- entry_index. The unique constraint (owner_id, entry_index) then makes the
-- SECOND transaction fail outright:
--
--   ERROR: duplicate key value violates unique constraint
--          "entries_owner_id_entry_index_key"
--
-- The data never corrupts -- that constraint is doing its job, and AAA #5
-- still ends up existing exactly once. What is lost is the second
-- transaction: a legitimate owner or entry Anthony was adding disappears,
-- and what he sees is a unique-violation naming a column he never touched.
-- The morning of a deadline that is the wrong failure to hand him.
--
-- THE FIX
--
-- Double-checked locking. The fast path -- the entitlement is already met,
-- which is every write except the handful that actually earn something --
-- takes NO lock at all and is unchanged. Only a statement that believes it
-- owes a mint enters the critical section, and it RE-READS the counts once
-- inside, because the transaction it waited for may have minted already. In
-- the race above the second transaction now recomputes, sees AAA #5 present,
-- and returns without inserting. Both writes commit; exactly one mints.
--
-- pg_advisory_xact_lock, specifically:
--   * transaction-scoped, so it releases on commit or rollback with no
--     unlock path to forget -- and it is safe behind PgBouncer's transaction
--     pooling, which a session-level pg_advisory_lock would leak straight
--     through.
--   * keyed off the rule's own name rather than a magic number, so it cannot
--     collide with an unrelated advisory lock someone adds later. hashtext's
--     value may differ between major PostgreSQL versions; that is fine, since
--     every session contending for it is on the same server.
-- It is the only advisory lock in this schema, so there is no second one to
-- deadlock against by taking them in a different order.

create or replace function mint_free_entries()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- Mirrors FREE_ENTRY_OWNER_EMAIL in src/lib/free-entries.ts. A trigger
  -- cannot import from TypeScript, so this literal is the drift risk: change
  -- it on one side and the app keeps flagging the right owner while the
  -- trigger quietly mints for nobody. tests/unit/free-entry-enforcement.test.ts
  -- reads this file and asserts the two still match.
  v_email  constant text := 'anthonydellapia@gmail.com';
  v_owner  uuid;
  v_ratio  int;
  v_target int;
  v_have   int;
  v_max    int;
  v_idx    int;
  v_i      int;
  v_names  text[] := '{}';
begin
  -- The mint below writes to `entries`, which re-enters this trigger. One
  -- level is all the rule needs: by the time it re-fires the entitlement is
  -- already satisfied, but returning early is cheaper and states the intent.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  select o.id into v_owner
    from owners o
   where lower(o.email) = v_email
     and o.participation_status = 'confirmed'
     and o.deleted_at is null
   limit 1;
  -- No runner row yet (a fresh database mid-seed): nothing to earn against.
  if v_owner is null then
    return null;
  end if;

  select c.free_entry_ratio into v_ratio from config c limit 1;
  v_ratio := greatest(coalesce(v_ratio, 10), 1);

  -- Recruited = live, non-free entries. Free entries never earn more free
  -- entries, and an archived owner's entries were reassigned before archiving
  -- (admin_merge_owner), so excluding them cannot drop a live entry.
  select floor(count(*) / v_ratio) into v_target
    from entries e
    join owners o on o.id = e.owner_id
   where e.voided_at is null
     and not e.is_free_entry
     and o.deleted_at is null;

  select count(*) filter (where e.voided_at is null) into v_have
    from entries e
   where e.owner_id = v_owner and e.is_free_entry;

  -- FAST PATH: nothing owed. Almost every write lands here, and it takes no
  -- lock, so ordinary roster edits never contend with each other.
  if v_have >= v_target then
    return null;
  end if;

  -- CRITICAL SECTION: only a statement that believes it owes a mint gets here.
  perform pg_advisory_xact_lock(hashtext('mint_free_entries')::bigint);

  -- Re-read inside the lock. If we waited on another transaction, it has now
  -- committed and READ COMMITTED gives this statement a fresh snapshot that
  -- includes both its recruits and anything it minted -- so this is the read
  -- that decides, and the pre-lock one was only a filter.
  select floor(count(*) / v_ratio) into v_target
    from entries e
    join owners o on o.id = e.owner_id
   where e.voided_at is null
     and not e.is_free_entry
     and o.deleted_at is null;

  select count(*) filter (where e.voided_at is null) into v_have
    from entries e
   where e.owner_id = v_owner and e.is_free_entry;

  if v_have >= v_target then
    return null;
  end if;

  -- Highest number ever used, INCLUDING voided rows, so a number is never
  -- reused after a void -- Lynne may still hold the old one. Both separator
  -- forms are parsed: the pre-2026-09-01 names were "AAA 1".."AAA 7" and a
  -- reader that understood only "AAA #n" would restart at 1.
  select coalesce(max((regexp_match(e.entry_name, '^AAA #?(\d+)$'))[1]::int), 0)
    into v_max
    from entries e
   where e.owner_id = v_owner and e.is_free_entry;

  -- Read under the lock too: the transaction we waited for may have taken the
  -- next entry_index, and this is the value the unique constraint checks.
  select coalesce(max(e.entry_index), 0) into v_idx
    from entries e where e.owner_id = v_owner;

  for v_i in 1..(v_target - v_have) loop
    v_idx := v_idx + 1;
    v_max := v_max + 1;
    insert into entries (owner_id, entry_index, entry_name,
                         name_is_default, is_free_entry)
    values (v_owner, v_idx, 'AAA #' || v_max, false, true);
    v_names := v_names || ('AAA #' || v_max);
  end loop;

  -- Audited in the same transaction as the write, like every other mutation
  -- here: the entries row and its audit row commit together or neither does.
  insert into audit_log (actor, action, target_table, target_id, after)
  values ('system (free-entry rule)', 'mint_free_entries', 'entries',
          v_owner::text,
          jsonb_build_object('minted', v_names, 'entitlement', v_target,
                             'held_before', v_have));
  return null;
end $$;
