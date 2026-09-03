-- Two holes Codex found in the free-entry rule, both reproduced against a real
-- database before being fixed.
--
-- ============================================================================
-- 1. THE FAST PATH WAS WRONG, NOT JUST FAST (P1 -- silent under-mint)
-- ============================================================================
--
-- 20260904000044 put the mint behind an advisory lock but let a statement that
-- believed it owed nothing skip the lock entirely. That check is itself made
-- from an unlocked read, and under READ COMMITTED a transaction cannot see
-- another's uncommitted rows. So:
--
--   8 recruited, ratio 10. T1 adds one recruit: sees 9, owes nothing, returns
--   without ever taking the lock. T2 adds one recruit: also sees 9 -- T1 has
--   not committed -- owes nothing, returns. Both commit. 10 recruited, ZERO
--   free entries, and nothing will ever notice until some unrelated write to
--   `entries` happens to fire the trigger again.
--
-- Observed exactly that: recruited 10, free_held 0, entitlement 1.
--
-- That is worse than the collision 44 fixed. The collision was loud and left
-- the data correct; this is a silent under-mint, which is the precise failure
-- this whole rule was moved into the database to eliminate.
--
-- So the lock is now taken UNCONDITIONALLY, before anything is read. A
-- transaction that would have decided from a stale count instead waits for the
-- one ahead of it to commit, and then reads a snapshot that includes its
-- recruits. In the case above T2 blocks, then sees 10, and mints.
--
-- The cost is that every transaction writing these tables serializes against
-- the others for the rest of its life. At this pool's size -- one admin, about
-- a hundred entries, a handful of writes a day, no long-running transactions
-- -- that is not a trade worth thinking about. A correct entitlement is the
-- entire point; a cheaper wrong one is not an option.
--
-- ============================================================================
-- 2. `entries` IS NOT THE ONLY INPUT (P2 -- entitlement drifts unnoticed)
-- ============================================================================
--
-- The entitlement is FLOOR(recruited / ratio) held against the runner's row.
-- That reads from exactly three tables, and the trigger was only on one:
--
--   entries -- the recruited count            (had a trigger)
--   owners  -- who the runner IS: the email match, participation_status,
--              deleted_at; and which entries count, via their owner's
--              deleted_at                     (had none)
--   config  -- free_entry_ratio               (had none)
--
-- Both gaps reproduce:
--
--   * Import the roster, THEN create the runner. admin_create_owner with no
--     entries writes only `owners`, so nothing fires: 47 recruited, 0 free,
--     entitlement 4. (This is why every block in tests/sql/12_free_entries.sql
--     needed an explicit settle line after creating the runner -- the test
--     suite was quietly documenting the bug.)
--   * Lower config.free_entry_ratio from 10 to 5 against 47 recruited:
--     entitlement goes 4 -> 9, and 4 are still held.
--
-- In both, the shortage persists until some unrelated write to `entries`
-- happens along. Attaching the same statement trigger to `owners` and
-- `config` closes it, and those three tables are the complete set of inputs,
-- so there is no fourth gap of this shape.

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

  -- BEFORE ANY READ. Every count below is taken under this lock, so a
  -- transaction can never decide from a snapshot that predates a concurrent
  -- roster change -- it waits for that transaction to commit and then sees it.
  -- Skipping this for writes that look like they owe nothing is what silently
  -- under-minted; see the header.
  --
  -- pg_advisory_xact_lock specifically: transaction-scoped, so it releases on
  -- commit or rollback with no unlock path to forget, and it is safe behind
  -- PgBouncer's transaction pooling, which a session-level pg_advisory_lock
  -- would leak straight through. Keyed off the rule's own name so it cannot
  -- collide with an unrelated advisory lock added later; it is the only one in
  -- this schema, so there is no second lock to deadlock against by ordering.
  -- Re-acquiring it within the same transaction is free, which is what makes
  -- an RPC that writes owners and then entries in a loop cheap.
  perform pg_advisory_xact_lock(hashtext('mint_free_entries')::bigint);

  select o.id into v_owner
    from owners o
   where lower(o.email) = v_email
     and o.participation_status = 'confirmed'
     and o.deleted_at is null
   limit 1;
  -- No runner row yet (a fresh database mid-seed): nothing to earn against.
  -- Once one appears, the trigger on `owners` settles the backlog at once.
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

-- The other two inputs. Same function, same statement-level shape; the
-- entitlement is recomputed from scratch every time, so it does not matter
-- which table woke it.
drop trigger if exists owners_mint_free_entries on owners;
create trigger owners_mint_free_entries
after insert or update or delete on owners
for each statement
execute function mint_free_entries();

drop trigger if exists config_mint_free_entries on config;
create trigger config_mint_free_entries
after insert or update or delete on config
for each statement
execute function mint_free_entries();

-- Settle once under the completed rule. A no-op in production as of
-- 2026-09-04 (94 recruited, entitlement 9, AAA #1..#9 held).
update entries set entry_name = entry_name where false;
