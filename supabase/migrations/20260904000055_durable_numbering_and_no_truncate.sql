-- Two things, both reproduced against a real database. One closes a hole the
-- name-based numbering still had; the other REVERTS my own previous migration,
-- which traded the narrowest gap on this branch for a new deadlock.
--
-- 1. THE NUMBERING HISTORY MUST OUTLIVE THE ROWS (Codex, P1)
--
-- 20260904000050 keyed the numbering on the entry NAME rather than the
-- is_free_entry flag, which fixed unticking "free". It did not fix renaming,
-- and admin_update_entry writes both columns in one statement: rename the
-- highest free entry AND untick it, and the same statement creates the
-- shortage and erases the evidence. Observed -- AAA #4 renamed to something
-- else, and a fresh live AAA #4 minted in its place, while Lynne may still
-- hold the original identity.
--
-- The fix is the one Codex named: durable history. It already exists. Every
-- mint writes an audit_log row naming what it minted, in the same transaction,
-- and this project treats audit_log as append-only -- "corrections are new
-- rows, never edits". So the maximum is now taken over the names entries carry
-- now AND every name the rule has recorded minting. A dedicated numbering
-- table would be a third store of the same fact; the audit row cannot disagree
-- with the mint it was written beside.
--
-- 2. TRUNCATE RECONCILIATION IS REVERTED (Codex, P2)
--
-- 20260904000054 made the triggers fire on TRUNCATE, closing a gap I described
-- at the time as the narrowest on the branch: a non-default ratio plus a bare
-- TRUNCATE of `config` that the app never issues. It was a bad trade.
--
-- For TRUNCATE, PostgreSQL takes the table's ACCESS EXCLUSIVE lock BEFORE
-- firing the BEFORE trigger. So a truncating transaction holds a relation lock
-- while waiting for the advisory lock -- the exact inversion 20260904000047
-- existed to prevent. A transaction that had written `entries` (holding the
-- advisory lock) and then went to write `config` deadlocked against a
-- concurrent `truncate config`:
--
--   ERROR:  deadlock detected
--
-- This cannot be fixed from inside a trigger: by the time any trigger runs,
-- the relation lock is already held. It would need every truncating caller to
-- take the advisory lock first, which the schema cannot enforce.
--
-- So TRUNCATE deliberately does NOT reconcile, and tests/sql/12_free_entries.sql
-- asserts that -- re-adding it fails the suite rather than quietly restoring
-- the deadlock. The accepted consequence: truncating a watched table leaves
-- the entitlement unreconciled until the next ordinary write. The data backup
-- is unaffected, since it disables these triggers and settles at the end.

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

  -- The numbering history has to outlive the rows, because a row can stop
  -- carrying its number. admin_update_entry writes entry_name and
  -- is_free_entry in one statement, so renaming the highest free entry AND
  -- unticking "free" creates the shortage and erases the evidence in the same
  -- breath -- the scan below finds nothing, and the number is minted again
  -- while Lynne may still hold the original. Observed: AAA #4 renamed away,
  -- and a fresh live AAA #4 immediately in its place.
  --
  -- So the maximum is taken over two sources:
  --   * the names entries carry NOW -- which is what catches a number placed
  --     by hand, or the pre-2026-09-01 "AAA n" rows that predate this trigger;
  --   * every name this rule has ever RECORDED minting, from audit_log. That
  --     is already durable and append-only by project rule ("corrections are
  --     new rows, never edits"), so it survives any rename, void or archive.
  --
  -- A dedicated numbering table would be a third store of the same fact. The
  -- audit row is written in the same transaction as the mint it describes, so
  -- it cannot disagree with what was minted.
  select greatest(
    coalesce((select max((regexp_match(e.entry_name, '^AAA #?(\d+)$'))[1]::int)
                from entries e
               where e.entry_name ~ '^AAA #?\d+$'), 0),
    coalesce((select max((regexp_match(n.name, '^AAA #?(\d+)$'))[1]::int)
                from audit_log a
                cross join lateral
                  jsonb_array_elements_text(a.after -> 'minted') as n(name)
               where a.action = 'mint_free_entries'
                 and jsonb_typeof(a.after -> 'minted') = 'array'
                 and n.name ~ '^AAA #?\d+$'), 0)
  ) into v_max;

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

-- Back to INSERT/UPDATE/DELETE. See the header: firing on TRUNCATE inverts the
-- lock ordering, because the relation lock is taken before any trigger runs.
drop trigger if exists entries_lock_free_entry_rule on entries;
create trigger entries_lock_free_entry_rule
before insert or update or delete on entries
for each statement
execute function lock_free_entry_rule();

drop trigger if exists owners_lock_free_entry_rule on owners;
create trigger owners_lock_free_entry_rule
before insert or update or delete on owners
for each statement
execute function lock_free_entry_rule();

drop trigger if exists config_lock_free_entry_rule on config;
create trigger config_lock_free_entry_rule
before insert or update or delete on config
for each statement
execute function lock_free_entry_rule();

drop trigger if exists entries_mint_free_entries on entries;
create trigger entries_mint_free_entries
after insert or update or delete on entries
for each statement
execute function mint_free_entries();

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
