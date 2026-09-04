-- Read the numbering history from every place an AAA name is recorded, not
-- just the two this rule writes. Codex's finding, reproduced against a real
-- database.
--
-- 20260904000056 documented a residual gap and declined to close it: an AAA
-- name introduced OUTSIDE the rule and later renamed away leaves nothing
-- behind. That judgement was wrong on both halves. The gap is not as narrow as
-- it looked, and the record needed to close it already exists.
--
-- The admin UI's "free" checkbox routes through admin_add_entries, which is an
-- ordinary thing to use -- and its audit row carries the name under
-- `after.names`, not `after.minted`. Observed:
--
--   admin_add_entries(runner, ARRAY['AAA #5'], is_free => true)
--   ...later renamed away and unticked
--   -> "Renamed away" (not free) AND a fresh live AAA #5
--
-- So the scan reads four sources instead of two, adding `after.names` and
-- `before.entry_name` -- the latter being what admin_update_entry records when
-- it renames a row, which is precisely the operation that erases a number.
--
-- That covers every audited path. What remains is a raw SQL write that skips
-- audit_log, which already breaks this project's rule that every write is
-- audited in the same transaction as the write -- a different problem from
-- this one, and not one the numbering can paper over.

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

  -- Every place an AAA name has ever been recorded. A row can stop carrying
  -- its number -- admin_update_entry writes entry_name and is_free_entry in
  -- one statement -- so the current names are only one of four sources:
  --
  --   entries.entry_name        what is in use now
  --   after -> 'minted'         what this rule minted, and the one-time
  --                             backfill of the numbers that predate it
  --   after -> 'names'          what admin_add_entries created -- the exposed
  --                             "free" checkbox can put an AAA name here
  --                             without the rule ever minting it
  --   before ->> 'entry_name'   what admin_update_entry renamed AWAY, which is
  --                             the operation that erases a number
  --
  -- Between them, every audited path that can introduce or remove an AAA name
  -- leaves a record. What is left uncovered is a raw SQL write that skips
  -- audit_log entirely -- which already breaks this project's rule that every
  -- write is audited in the same transaction, so it is a different problem.
  select coalesce(max((regexp_match(s.nm, '^AAA #?(\d+)$'))[1]::int), 0)
    into v_max
    from (
      select e.entry_name as nm from entries e
      union all
      select n.name from audit_log a
        cross join lateral jsonb_array_elements_text(a.after -> 'minted') n(name)
       where jsonb_typeof(a.after -> 'minted') = 'array'
      union all
      select n.name from audit_log a
        cross join lateral jsonb_array_elements_text(a.after -> 'names') n(name)
       where jsonb_typeof(a.after -> 'names') = 'array'
      union all
      select a.before ->> 'entry_name' from audit_log a
       where a.before ? 'entry_name'
    ) s(nm)
   where s.nm ~ '^AAA #?\d+$';

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
