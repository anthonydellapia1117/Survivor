-- Free entries are earned in the DATABASE, not wherever the UI happens to run.
--
-- The rule (CLAUDE.md): the runner earns FLOOR(recruited / ratio) free entries,
-- named "AAA #n", under the participant row for anthonydellapia@gmail.com.
--
-- Until now that rule lived only in syncFreeEntries() inside the Next server
-- actions. Anything that changed the roster WITHOUT going through the app --
-- a direct admin_create_owner / admin_add_entries call, a fix applied by
-- hand, a future importer -- silently under-minted. That happened for real on
-- 2026-09-03: adding Joe Didonato and Kris Tomasco by RPC took recruited from
-- 86 to 94, entitlement from 8 to 9, and no AAA #9 appeared. The count had to
-- be minted by hand after the fact.
--
-- An entitlement enforced only on one write path is the same shape as a
-- derived value that has to be kept in step by hand: correct exactly as often
-- as everyone remembers it. So it moves to a statement trigger on `entries`,
-- which every path goes through by definition.
--
-- WHAT IT WILL NOT DO
--
-- It only ever mints. A downward crossing -- voiding recruited entries so the
-- entitlement drops -- is surfaced on /admin and never auto-corrected, because
-- taking away an entry that may already sit on Lynne's sheet under a number
-- she holds is not a decision an INSERT trigger gets to make.

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

drop trigger if exists entries_mint_free_entries on entries;

-- Statement-level, and on every write shape. INSERT is the case that earns
-- one; UPDATE covers a void being lifted; DELETE is included so the invariant
-- holds under any write at all rather than the ones currently expected.
create trigger entries_mint_free_entries
after insert or update or delete on entries
for each statement
execute function mint_free_entries();

-- Bring the live database to the rule in the same breath as installing it,
-- rather than waiting for the next roster change to notice. A no-op in
-- production as of 2026-09-04: 94 recruited, entitlement 9, and AAA #1..#9
-- already held.
--
-- `where false` matches no row and modifies nothing, but a STATEMENT trigger
-- fires on a zero-row UPDATE all the same -- which is precisely the recompute
-- wanted here, with no rows dirtied to get it. The same line is what the data
-- backup runs to settle the rule after a restore.
update entries set entry_name = entry_name where false;
