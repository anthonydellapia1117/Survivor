-- Count the free entries the POOL holds, not the ones currently sitting under
-- the runner's owner row. Codex's finding, reproduced against a real database.
--
-- THE BUG
--
-- admin_merge_owner reassigns every entry from the source owner to the target
-- and THEN archives the source. Run it with the runner as source and the
-- statement trigger fires in between, at the one moment when the runner owns
-- no free entries but is still a live, confirmed owner. It concludes the whole
-- entitlement is owed, and -- because it also looked for the highest AAA
-- number only among the runner's own rows, of which there are now none --
-- restarts the numbering at 1.
--
-- Observed, merging the runner into another owner on a 47-entry roster:
--
--   owner              archived   free entries
--   Brian Yost         f          AAA #1, AAA #2, AAA #3, AAA #4
--   Anthony DellaPia   t          AAA #1, AAA #2, AAA #3, AAA #4
--
-- Four duplicated numbers, every one of them a number Lynne holds, and the
-- freshly minted four attached to an owner the very next statement archives --
-- so they are invisible on the roster while still existing. The merge reports
-- success. This is the failure mode this project can least afford, and it is a
-- regression: the app-layer rule this trigger replaced could not hit it,
-- because it ran after the merge had finished and simply found no live runner.
--
-- THE FIX
--
-- Both reads become pool-wide. What is held is every live free entry, whoever
-- holds it; what the numbering continues past is every AAA number that has
-- ever existed. Neither question was ever really about which owner row a given
-- entry sits under today, and answering them per-owner is what let a
-- mid-transaction reassignment look like an empty entitlement.
--
-- The mint itself still lands under the runner, and /admin already counted
-- pool-wide, so this also removes a disagreement between the trigger and the
-- screen that reports on it.

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

  -- Pool-wide, NOT just the rows currently under the runner. Three reasons,
  -- and the first is a bug this fixes:
  --
  --   * admin_merge_owner moves every source entry to the target and THEN
  --     archives the source. With the runner as source, the statement trigger
  --     fires in between, sees the runner holding nothing, and re-mints the
  --     entire entitlement -- reusing AAA #1..#n, numbers Lynne already holds,
  --     and leaving them on an owner the next statement archives. Observed:
  --     four duplicate AAA rows from one merge.
  --   * The rule is that FLOOR(recruited / ratio) free entries EXIST. A free
  --     entry that has ended up under someone else is an anomaly to surface,
  --     not a reason to mint another on top of it -- the same mint-only,
  --     never-auto-correct posture as a downward crossing.
  --   * /admin already counts them this way (`liveAll.filter(isFreeEntry)`),
  --     so counting per-owner here made the trigger and the screen disagree
  --     about the same number.
  select count(*) into v_have
    from entries e
    join owners o on o.id = e.owner_id
   where e.is_free_entry
     and e.voided_at is null
     and o.deleted_at is null;

  if v_have >= v_target then
    return null;
  end if;

  -- The highest number that has EVER existed: any owner, voided or not,
  -- archived or not. A number Lynne holds must never come back, and which
  -- owner row happens to carry it today has nothing to do with that -- scoping
  -- this to the runner is what let a merge restart the numbering at 1. Both
  -- separator forms are parsed: the pre-2026-09-01 names were "AAA 1".."AAA 7"
  -- and a reader that understood only "AAA #n" would also restart at 1.
  select coalesce(max((regexp_match(e.entry_name, '^AAA #?(\d+)$'))[1]::int), 0)
    into v_max
    from entries e
   where e.is_free_entry;

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
