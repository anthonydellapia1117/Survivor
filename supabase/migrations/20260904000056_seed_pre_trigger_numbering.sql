-- Seed the numbering history for the AAA entries that predate the trigger.
-- Codex's finding, reproduced against a real database.
--
-- 20260904000055 made the numbering read durable history from audit_log, which
-- fixed a rename erasing a number. But it filtered on
-- action = 'mint_free_entries' -- so the history began the day the trigger did.
-- AAA #1..#9 predate it: seven were minted by the old app-layer rule under the
-- action 'add_entries', and #8 and #9 by hand. Production carries nine AAA rows
-- and ZERO mint audit rows.
--
-- So renaming and unticking the highest of those still reused its number.
-- Observed on a database shaped exactly like production:
--
--   AAA #1, AAA #2, AAA #3, AAA #4  and no mint audit rows
--   rename AAA #4 away, untick free
--   -> "Renamed away" (not free) AND a fresh live AAA #4
--
-- Reachable today, not hypothetically: nine numbers Lynne holds sit in exactly
-- that state right now.
--
-- Two parts, both narrow:
--
--   * the audit scan drops its action filter and matches any row carrying a
--     `minted` array of AAA names -- so it picks up the backfill below, and
--     anything future that records minted names, without listing action names;
--   * a one-time backfill records the AAA numbers that exist now.
--
-- The backfill is written as its own action rather than as a `mint_free_entries`
-- row, because no mint happened here -- claiming one in an append-only ledger
-- to make a query convenient would be worse than the bug. It is idempotent, so
-- replaying the migrations does not stack rows.
--
-- WHAT IS STILL NOT COVERED, stated rather than left to be discovered: an AAA
-- name placed outside the rule AFTER this runs -- a hand INSERT, or
-- admin_add_entries with is_free -- and then renamed away. Nothing records it,
-- so the number could come back. Closing that would mean recording on every
-- write that happens to carry an AAA name, which is more machinery than the
-- case is worth. What IS guaranteed: every number the rule minted, and every
-- number in use when this history was introduced -- which is the nine Lynne
-- holds today.

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

  -- The numbering history outlives the rows: the names entries carry now, plus
  -- every AAA name any audit row records having been minted.
  --
  -- No action filter on that second half. It used to require
  -- action = 'mint_free_entries', which meant the history began the day this
  -- trigger did -- and AAA #1..#9 predate it, minted by the old app layer and
  -- one of them by hand. Renaming the highest of those away lost it from both
  -- halves and the number came back. Reproduced against a database shaped like
  -- production, which carries nine AAA rows and zero mint audit rows.
  --
  -- Matching on the `minted` array itself rather than on an action name also
  -- means the backfill below, and anything future that records minted names,
  -- is picked up without this query having to list them.
  select greatest(
    coalesce((select max((regexp_match(e.entry_name, '^AAA #?(\d+)$'))[1]::int)
                from entries e
               where e.entry_name ~ '^AAA #?\d+$'), 0),
    coalesce((select max((regexp_match(n.name, '^AAA #?(\d+)$'))[1]::int)
                from audit_log a
                cross join lateral
                  jsonb_array_elements_text(a.after -> 'minted') as n(name)
               where jsonb_typeof(a.after -> 'minted') = 'array'
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

-- One-time: record the AAA numbers already in use, so the durable history is
-- not empty for everything minted before this trigger existed.
do $$
declare
  v_names text[];
begin
  if exists (select 1 from audit_log
              where action = 'free_entry_numbers_backfill') then
    return;   -- already seeded; migrations replay
  end if;

  select array_agg(e.entry_name order by
                   (regexp_match(e.entry_name, '^AAA #?(\d+)$'))[1]::int)
    into v_names
    from entries e
   where e.entry_name ~ '^AAA #?\d+$';

  if v_names is null then
    return;   -- nothing minted yet (a fresh database)
  end if;

  insert into audit_log (actor, action, target_table, target_id, after, note)
  values ('system (free-entry rule)', 'free_entry_numbers_backfill', 'entries',
          null,
          jsonb_build_object('minted', v_names),
          'numbers already in use when the durable history was introduced; no entries were created');
end $$;
