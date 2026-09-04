-- Two more, both reproduced against a real database.
--
-- 1. THE NUMBERING FOLLOWED A FLAG, NOT THE NAME (P1)
--
-- v_max read `where e.is_free_entry`. That flag is internal bookkeeping and
-- the entry dialog lets an admin toggle it. Untick "free" on AAA #4 and the
-- same statement both drops it from the held count and hides its still-current
-- name from the numbering query, so it mints a second live AAA #4:
--
--   entry_name | rows | flagged_free
--   AAA #4     |    2 |            1
--
-- The name is the external identity -- it is what Lynne holds against a number
-- -- so that is what the history must be keyed on.
--
-- 2. FOREIGN KEYS TAKE ROW LOCKS TOO (P2)
--
-- 20260904000047 put the advisory lock in a BEFORE STATEMENT trigger on
-- entries, owners and config so it is always acquired before any row lock on
-- them, and argued the ordering was total because the schema contains no
-- `select ... for update`, `for share` or `lock table`. That argument was
-- wrong, and the test that "asserted" it only ever checked for those three
-- explicit forms.
--
-- A foreign key takes a KEY SHARE lock on the parent row, and the child's
-- write fires no trigger on the parent. So `insert into payments (owner_id =
-- X)` locks owners(X) with no advisory lock held. Merging a payment-bearing
-- source into an empty target, against a concurrent hard delete of that
-- target:
--
--   ERROR:  deadlock detected
--   DETAIL: Process 3415 waits for ExclusiveLock on advisory lock
--           [250933,4294967295,2511768729,1]; blocked by process 3414.
--
-- (A plain UPDATE would not have shown it: a non-key update takes FOR NO KEY
-- UPDATE, which does not conflict with KEY SHARE. It takes a DELETE, which is
-- exactly what admin_merge_owner does to an empty source.)
--
-- The fix is the property, not the instance: every table holding a foreign key
-- into the three now carries the same BEFORE trigger, so nothing can lock one
-- of their rows without taking the advisory lock first. That is `payments` and
-- `picks` today, and tests/sql/12_free_entries.sql now derives the list from
-- pg_constraint rather than restating it -- so a new child table added without
-- the trigger fails the suite instead of quietly reopening this.

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

  -- THE RUNNER'S OWN ROWS. The entitlement is his: CLAUDE.md says the free
  -- entries are "Anthony's only" and "Nobody else ever gets one", so a free
  -- entry sitting under somebody else is not part of what he has earned, and
  -- counting it as if it were suppresses a mint he is owed.
  --
  -- 20260904000048 counted these pool-wide to stop a runner-source merge
  -- re-minting, and that was the wrong lever. The merge transient is closed at
  -- its source below instead.
  select count(*) filter (where e.voided_at is null) into v_have
    from entries e
   where e.owner_id = v_owner and e.is_free_entry;

  if v_have >= v_target then
    return null;
  end if;

  -- Keyed on the NAME, not the is_free_entry flag. The name is the external
  -- identity -- it is what Lynne holds -- and the flag is internal
  -- bookkeeping that an admin can toggle from the entry dialog. Reading the
  -- flag meant unticking "free" on AAA #4 both dropped it from the held count
  -- AND hid its still-current name from this query, so the same statement
  -- minted a second live row called AAA #4. Observed:
  --
  --   entry_name | rows | flagged_free
  --   AAA #4     |    2 |            1
  --
  -- Any owner, voided or not, archived or not, free-flagged or not: if the
  -- number has ever been on a row, it never comes back.
  select coalesce(max((regexp_match(e.entry_name, '^AAA #?(\d+)$'))[1]::int), 0)
    into v_max
    from entries e
   where e.entry_name ~ '^AAA #?\d+$';

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

-- Every table with a foreign key into entries, owners or config. A child's
-- write takes a KEY SHARE lock on the parent row and fires no trigger there,
-- so without this the ordering guarantee has a hole the width of every FK.
drop trigger if exists payments_lock_free_entry_rule on payments;
create trigger payments_lock_free_entry_rule
before insert or update or delete on payments
for each statement
execute function lock_free_entry_rule();

drop trigger if exists picks_lock_free_entry_rule on picks;
create trigger picks_lock_free_entry_rule
before insert or update or delete on picks
for each statement
execute function lock_free_entry_rule();
