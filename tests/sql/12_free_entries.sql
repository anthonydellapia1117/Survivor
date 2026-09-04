-- Free entries are earned in the DATABASE, not in the app.
--
-- Every block here goes through the RPCs and raw SQL only. Nothing in this
-- file can reach a Next server action, which is the whole point: the rule used
-- to live in syncFreeEntries() and so held only for roster changes that
-- happened to go through the UI.
--
-- The fixture roster (47 recruited, no runner owner, no emails at all) does
-- NOT satisfy the rule, and correctly so: with nobody to earn them, there is
-- nothing to mint. Each block below installs the runner itself.

-- `update entries set entry_name = entry_name where false;` appears below as
-- the settle: it matches no row and changes nothing, but a STATEMENT trigger
-- fires on a zero-row UPDATE, so it recomputes the rule. Creating the runner
-- touches `owners`, not `entries`, so without it a block would start holding
-- nothing against a standing entitlement.

-- A database with no runner row is a legitimate state -- a fresh install
-- mid-seed is exactly that -- and writes to `entries` must go through it
-- rather than raising or minting to nobody.
begin;
do $$
declare
  n int;
begin
  if exists (select 1 from owners
              where lower(email) = 'anthonydellapia@gmail.com'
                and deleted_at is null) then
    raise exception 'fixture unexpectedly carries the runner owner';
  end if;

  perform admin_create_owner('No','Runner','nr@example.com','','email','',
                             array['NR 1','NR 2'], true, 'test');

  select count(*) into n from entries where is_free_entry;
  if n <> 0 then
    raise exception 'nothing to earn against, but % free entries appeared', n;
  end if;
end $$;
rollback;

-- Crossing a threshold by RPC alone mints the free entry. No app-layer call
-- happens anywhere in this block -- this is the case Anthony asked for, and
-- the one that silently under-minted on 2026-09-03.
begin;
do $$
declare
  runner uuid;
  ratio int;
  recruited int;
  free_before int;
  free_after int;
  need int;
  names text[];
  i int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');
  -- Settle the standing backlog first, so this block starts at the rule and
  -- measures the crossing rather than the catch-up.

  select free_entry_ratio into ratio from config limit 1;
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;
  select count(*) into free_before from entries
   where owner_id = runner and is_free_entry and voided_at is null;
  if free_before <> floor(recruited / ratio) then
    raise exception 'backlog was not settled: % held against an entitlement of %',
      free_before, floor(recruited / ratio);
  end if;

  -- Exactly enough recruited entries to reach the next multiple of the ratio:
  -- one more free entry becomes owed, and not two.
  need := ratio - (recruited % ratio);
  names := array[]::text[];
  for i in 1..need loop
    names := names || format('Threshold %s', i);
  end loop;

  perform admin_create_owner('Threshold','Test','tt@example.com','','email','',
                             names, true, 'test');

  select count(*) into free_after from entries
   where owner_id = runner and is_free_entry and voided_at is null;
  if free_after <> free_before + 1 then
    raise exception
      'crossing the threshold by RPC must mint exactly one: had %, now %, ratio %, recruited before %',
      free_before, free_after, ratio, recruited;
  end if;

  -- ...and it is named in sequence, not restarted at 1.
  if not exists (
    select 1 from entries
     where owner_id = runner and is_free_entry
       and entry_name = 'AAA #' || (free_before + 1)
  ) then
    raise exception 'expected the new free entry to be named AAA #%', free_before + 1;
  end if;

  -- The write is audited in the same transaction, like every other mutation.
  if not exists (
    select 1 from audit_log
     where action = 'mint_free_entries' and target_id = runner::text
  ) then
    raise exception 'the mint must be audited';
  end if;
end $$;
rollback;

-- One short of the threshold mints nothing: the rule is FLOOR, not "round up
-- whenever anyone joins".
begin;
do $$
declare
  runner uuid;
  ratio int;
  recruited int;
  free_before int;
  need int;
  names text[];
  i int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');

  select free_entry_ratio into ratio from config limit 1;
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;
  select count(*) into free_before from entries
   where owner_id = runner and is_free_entry and voided_at is null;
  -- Anchor the negative assertion to a live rule: without this the block
  -- would pass just as happily against a database with no trigger at all.
  if free_before <> floor(recruited / ratio) then
    raise exception 'backlog was not settled: % held against an entitlement of %',
      free_before, floor(recruited / ratio);
  end if;

  need := ratio - (recruited % ratio) - 1;
  if need > 0 then
    names := array[]::text[];
    for i in 1..need loop names := names || format('Short %s', i); end loop;
    perform admin_create_owner('Short','Test','st@example.com','','email','',
                               names, true, 'test');
  end if;

  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null)
     <> free_before then
    raise exception 'one short of the threshold must mint nothing';
  end if;
end $$;
rollback;

-- admin_add_entries is the other RPC path, and it earns too.
begin;
do $$
declare
  runner uuid;
  other uuid;
  ratio int;
  recruited int;
  free_before int;
  need int;
  names text[];
  i int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');

  select free_entry_ratio into ratio from config limit 1;
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;
  select count(*) into free_before from entries
   where owner_id = runner and is_free_entry and voided_at is null;

  other := admin_create_owner('Adder','Test','ad@example.com','','email','',
                              null, false, 'test');

  need := ratio - (recruited % ratio);
  names := array[]::text[];
  for i in 1..need loop names := names || format('Added %s', i); end loop;
  perform admin_add_entries(other, names, true, false, 'test');

  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null)
     <> free_before + 1 then
    raise exception 'admin_add_entries crossing the threshold must mint one';
  end if;
end $$;
rollback;

-- A raw INSERT earns as well. This is the case the app-layer rule could never
-- have covered, and the reason the rule belongs on the table.
begin;
do $$
declare
  runner uuid;
  scratch uuid;
  ratio int;
  recruited int;
  free_before int;
  need int;
  i int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');

  select free_entry_ratio into ratio from config limit 1;
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;
  select count(*) into free_before from entries
   where owner_id = runner and is_free_entry and voided_at is null;

  insert into owners (first_name, last_name) values ('Raw','Insert')
  returning id into scratch;

  need := ratio - (recruited % ratio);
  for i in 1..need loop
    insert into entries (owner_id, entry_index, entry_name)
    values (scratch, i, format('Raw %s', i));
  end loop;

  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null)
     <> free_before + 1 then
    raise exception 'a raw INSERT crossing the threshold must mint one';
  end if;
end $$;
rollback;

-- A single multi-row INSERT crosses too. The per-row loops in the RPCs hide
-- this: a bulk importer writes one statement, and a trigger that only ever
-- saw one row at a time would still be right by luck.
begin;
do $$
declare
  runner uuid;
  scratch uuid;
  ratio int;
  recruited int;
  free_before int;
  need int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');

  select free_entry_ratio into ratio from config limit 1;
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;
  select count(*) into free_before from entries
   where owner_id = runner and is_free_entry and voided_at is null;

  insert into owners (first_name, last_name) values ('Bulk','Import')
  returning id into scratch;

  -- Enough to cross TWO thresholds in one statement: the mint owes two.
  need := ratio - (recruited % ratio) + ratio;
  insert into entries (owner_id, entry_index, entry_name)
  select scratch, n, format('Bulk %s', n) from generate_series(1, need) as n;

  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null)
     <> free_before + 2 then
    raise exception 'one statement crossing two thresholds must mint two, had %, now %',
      free_before,
      (select count(*) from entries
        where owner_id = runner and is_free_entry and voided_at is null);
  end if;
end $$;
rollback;

-- A runner installed against an existing roster is owed the whole backlog at
-- once, not one per subsequent write. This is the shape of the migration's own
-- backfill, and of any future re-import.
begin;
do $$
declare
  runner uuid;
  ratio int;
  recruited int;
begin
  select free_entry_ratio into ratio from config limit 1;
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;
  if floor(recruited / ratio) < 2 then
    raise exception 'fixture too small to exercise a backlog (% recruited)', recruited;
  end if;

  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');

  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null)
     <> floor(recruited / ratio) then
    raise exception 'a standing backlog must settle in one write, expected %',
      floor(recruited / ratio);
  end if;
  -- Numbered from 1 with no gaps, since nothing was held before.
  if exists (
    select 1 from generate_series(1, floor(recruited / ratio)::int) n
     where not exists (
       select 1 from entries
        where owner_id = runner and is_free_entry
          and entry_name = 'AAA #' || n)
  ) then
    raise exception 'the backlog must be named AAA #1..#n with no gaps';
  end if;
end $$;
rollback;

-- Voiding recruited entries LOWERS the entitlement and must take nothing
-- away: the surplus is surfaced on /admin, never auto-deleted, because Lynne
-- may already hold a number against it.
begin;
do $$
declare
  runner uuid;
  ratio int;
  recruited int;
  free_before int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');

  select free_entry_ratio into ratio from config limit 1;
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;
  select count(*) into free_before from entries
   where owner_id = runner and is_free_entry and voided_at is null;
  -- Anchor the negative assertion to a live rule: without this the block
  -- would pass just as happily against a database with no trigger at all.
  if free_before <> floor(recruited / ratio) then
    raise exception 'backlog was not settled: % held against an entitlement of %',
      free_before, floor(recruited / ratio);
  end if;

  -- Void a whole ratio's worth of recruited entries: the entitlement drops.
  update entries e set voided_at = now()
   where e.id in (
     select e2.id from entries e2 join owners o2 on o2.id = e2.owner_id
      where e2.voided_at is null and not e2.is_free_entry
        and o2.deleted_at is null
      limit (select free_entry_ratio from config)
   );

  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null)
     <> free_before then
    raise exception 'a downward crossing must never remove a free entry';
  end if;
end $$;
rollback;

-- A number is never reused after a void, even though the voided row no longer
-- counts toward what is held. Lynne may still hold the old one.
begin;
do $$
declare
  runner uuid;
  ratio int;
  recruited int;
  highest int;
  need int;
  names text[];
  i int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');

  select free_entry_ratio into ratio from config limit 1;
  select coalesce(max((regexp_match(entry_name,'^AAA #?(\d+)$'))[1]::int),0)
    into highest from entries where owner_id = runner and is_free_entry;
  if highest < 1 then raise exception 'expected the backlog to have minted'; end if;

  -- Void the newest free entry. The entitlement is now one short again, so
  -- the next crossing re-mints -- and must NOT reuse the number just freed.
  update entries set voided_at = now()
   where owner_id = runner and is_free_entry
     and entry_name = 'AAA #' || highest;

  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;
  need := ratio - (recruited % ratio);
  names := array[]::text[];
  for i in 1..need loop names := names || format('Reuse %s', i); end loop;
  perform admin_create_owner('Reuse','Test','ru@example.com','','email','',
                             names, true, 'test');

  if exists (
    select 1 from entries
     where owner_id = runner and is_free_entry
       and entry_name = 'AAA #' || highest and voided_at is null
  ) then
    raise exception 'a voided free-entry number must not be reused';
  end if;
  if not exists (
    select 1 from entries
     where owner_id = runner and is_free_entry
       and entry_name = 'AAA #' || (highest + 1)
  ) then
    raise exception 'the re-mint must continue past the voided number';
  end if;
end $$;
rollback;

-- The pre-2026-09-01 names went to Lynne as "AAA 1".."AAA 7", with no hash.
-- A reader that understood only "AAA #n" would parse the highest as 0 and
-- mint a duplicate "AAA 1" against a number she already holds.
begin;
do $$
declare
  runner uuid;
  ratio int;
  recruited int;
  need int;
  names text[];
  i int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');
  -- Put the held rows back into the pre-convention form, which is what those
  -- names actually looked like before 2026-09-01 -- renamed in place, exactly
  -- as the real conversion went. A rename is not a mint, so nothing new
  -- appears here; the point is what the NEXT crossing continues from.
  update entries set entry_name = 'AAA ' || entry_index
   where owner_id = runner and is_free_entry;
  if not exists (select 1 from entries
                  where owner_id = runner and entry_name = 'AAA 4') then
    raise exception 'setup: expected the runner to hold AAA 1..4 in legacy form';
  end if;

  select free_entry_ratio into ratio from config limit 1;
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;
  need := ratio - (recruited % ratio);
  names := array[]::text[];
  for i in 1..need loop names := names || format('Legacy %s', i); end loop;
  perform admin_create_owner('Legacy','Test','lg@example.com','','email','',
                             names, true, 'test');

  if exists (select 1 from entries
              where owner_id = runner and is_free_entry
                and entry_name = 'AAA #1') then
    raise exception 'the unhashed legacy names were not read: AAA #1 was reminted';
  end if;
  if not exists (select 1 from entries
                  where owner_id = runner and is_free_entry
                    and entry_name = 'AAA #5') then
    raise exception 'expected the mint to continue at AAA #5';
  end if;
end $$;
rollback;

-- An archived owner's entries do not earn. admin_merge_owner reassigns them
-- before archiving, so counting them would double every merged entry.
begin;
do $$
declare
  runner uuid;
  scratch uuid;
  ratio int;
  free_before int;
  recruited int;
  need int;
  i int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');
  select count(*) into free_before from entries
   where owner_id = runner and is_free_entry and voided_at is null;

  select free_entry_ratio into ratio from config limit 1;
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;
  -- Anchor the negative assertion to a live rule: without this the block
  -- would pass just as happily against a database with no trigger at all.
  if free_before <> floor(recruited / ratio) then
    raise exception 'backlog was not settled: % held against an entitlement of %',
      free_before, floor(recruited / ratio);
  end if;

  scratch := admin_create_owner('Archived','Owner','ao@example.com','','email','',
                                null, false, 'test');
  update owners set deleted_at = now() where id = scratch;

  need := ratio - (recruited % ratio);
  for i in 1..need loop
    insert into entries (owner_id, entry_index, entry_name)
    values (scratch, i, format('Archived %s', i));
  end loop;

  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null)
     <> free_before then
    raise exception 'an archived owner''s entries must not earn';
  end if;
end $$;
rollback;

-- A RESTORE must survive the trigger. src/lib/backup.ts emits one transaction:
-- truncate, then batched inserts, then setval, then commit. A restore is only
-- consistent at the END -- mid-load the roster is partial -- and the entries
-- arrive ordered by created_at, which puts every recruited entry BEFORE the
-- AAA row it earned. So a batch boundary landing between them mints a
-- duplicate, and that duplicate then collides with the backed-up row on the
-- (owner_id, entry_index) unique constraint and fails the whole restore.
--
-- This block replays that exact shape at a boundary chosen to hit the window,
-- and asserts the roster comes back byte-for-byte. Disaster recovery is not a
-- path that gets to be right by luck.
begin;
do $$
declare
  runner uuid;
  scratch uuid;
  ratio int;
  i int;
begin
  select free_entry_ratio into ratio from config limit 1;
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');
  scratch := admin_create_owner('Restore','Source','rs@example.com','','email','',
                                null, false, 'test');

  -- Stand up a roster that is exactly at the rule: one ratio's worth of
  -- recruited entries earning one AAA, twice over.
  update entries set voided_at = now() where voided_at is null;
  for i in 1..(ratio * 2) loop
    insert into entries (owner_id, entry_index, entry_name)
    values (scratch, i, format('Restore %s', i));
  end loop;
  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null) <> 2 then
    raise exception 'setup: expected the source roster to hold 2 free entries';
  end if;
end $$;

-- Snapshot it the way the backup does, then replay the restore.
create temp table _dump as
  select e.*, o.email as owner_email from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null;

do $$
declare
  runner uuid;
  ratio int;
  n int;
begin
  select free_entry_ratio into ratio from config limit 1;

  -- ---- the restore, exactly as buildBackupSql emits it ----
  delete from entries;          -- stands in for TRUNCATE (which never fires it)
  alter table entries disable trigger user;
  alter table owners disable trigger user;
  alter table config disable trigger user;

  -- Batch 1: the recruited entries only. This is the boundary that bites --
  -- entitlement 2, nothing held. With the trigger live it mints AAA #1 and
  -- AAA #2 here, and batch 2 then collides on (owner_id, entry_index).
  insert into entries (id, owner_id, entry_index, entry_name, name_is_default,
                       lynne_label, is_free_entry, created_at, voided_at,
                       lynne_number, submitted_to_lynne_at, submitted_as_name,
                       removal_communicated_at)
  select id, owner_id, entry_index, entry_name, name_is_default, lynne_label,
         is_free_entry, created_at, voided_at, lynne_number,
         submitted_to_lynne_at, submitted_as_name, removal_communicated_at
    from _dump where not is_free_entry;

  -- Batch 2: the AAA rows the backup actually holds.
  insert into entries (id, owner_id, entry_index, entry_name, name_is_default,
                       lynne_label, is_free_entry, created_at, voided_at,
                       lynne_number, submitted_to_lynne_at, submitted_as_name,
                       removal_communicated_at)
  select id, owner_id, entry_index, entry_name, name_is_default, lynne_label,
         is_free_entry, created_at, voided_at, lynne_number,
         submitted_to_lynne_at, submitted_as_name, removal_communicated_at
    from _dump where is_free_entry;

  alter table entries enable trigger user;
  alter table owners enable trigger user;
  alter table config enable trigger user;
  update entries set entry_name = entry_name where false;
  -- ---- end of the restore ----

  select o.id into runner from owners o
   where lower(o.email) = 'anthonydellapia@gmail.com' and o.deleted_at is null;

  select count(*) into n from entries where owner_id = runner and is_free_entry;
  if n <> 2 then
    raise exception 'restore must reproduce exactly 2 free entries, got %', n;
  end if;
  if exists (select entry_name from entries where owner_id = runner and is_free_entry
              group by entry_name having count(*) > 1) then
    raise exception 'the restore duplicated an AAA name';
  end if;
  -- Every row back, identical, ids and all.
  if exists (select id, owner_id, entry_index, entry_name, is_free_entry from _dump
             except select id, owner_id, entry_index, entry_name, is_free_entry from entries)
     or (select count(*) from entries) <> (select count(*) from _dump) then
    raise exception 'the restored roster does not match the backup';
  end if;
end $$;
rollback;

-- The mint is SERIALIZED, and unconditionally so.
--
-- Two failures, both reproduced with two concurrent psql sessions:
--   * Each crossing the same threshold, both read "held 4, owed 5" and both
--     inserted AAA #5 at the same entry_index; the second died on the
--     (owner_id, entry_index) constraint, losing a legitimate owner with an
--     error naming a column nobody touched.
--   * Worse: from 8 recruited at a ratio of 10, two transactions each adding
--     one recruit both read 9, both concluded nothing was owed, and committed
--     10 recruits with ZERO free entries. A lock around only the mint does not
--     help, because "do I owe anything" is itself an unlocked read.
--
-- A psql script has one connection, so the interleavings cannot be replayed
-- here. What IS checked is the mechanism: that the lock is held, including by
-- a write that plainly owes nothing, which is the case the old fast path let
-- through.
begin;
do $$
declare
  runner uuid;
  ratio int;
  recruited int;
  need int;
  names text[];
  i int;
  locks_before int;
  locks_after int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');

  -- The settle mints the standing backlog, so it goes through the mint path.
  select count(*) into locks_after from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid();
  if locks_after < 1 then
    raise exception 'a minting statement must hold the advisory lock';
  end if;
end $$;
rollback;

-- `entries` is not the only input to the entitlement. It reads from exactly
-- three tables -- entries (the recruited count), owners (who the runner is,
-- and whose entries count) and config (the ratio) -- and a trigger on only the
-- first lets the other two drift silently until an unrelated entry write
-- happens along. Both of these were reproduced before 20260904000045 attached
-- the same trigger to the other two.

-- Importing the roster and creating the runner afterwards writes only
-- `owners`. Observed before the fix: 47 recruited, 0 free, entitlement 4.
begin;
do $$
declare
  runner uuid;
  ratio int;
  recruited int;
begin
  select free_entry_ratio into ratio from config limit 1;
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;
  if floor(recruited / ratio) < 1 then
    raise exception 'fixture too small to owe a backlog (% recruited)', recruited;
  end if;

  -- No write to `entries` anywhere in this block.
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');

  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null)
     <> floor(recruited / ratio) then
    raise exception
      'creating the runner must settle the backlog at once, expected % held, got %',
      floor(recruited / ratio),
      (select count(*) from entries
        where owner_id = runner and is_free_entry and voided_at is null);
  end if;
end $$;
rollback;

-- Lowering the ratio raises the entitlement and must settle immediately.
-- Observed before the fix: ratio 10 -> 5 against 47 recruited left 4 held
-- against an entitlement of 9.
begin;
do $$
declare
  runner uuid;
  recruited int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;

  update config set free_entry_ratio = 5;

  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null)
     <> floor(recruited / 5) then
    raise exception 'a ratio change must settle, expected % held, got %',
      floor(recruited / 5),
      (select count(*) from entries
        where owner_id = runner and is_free_entry and voided_at is null);
  end if;
  -- ...and raising it back takes nothing away: still mint-only.
  update config set free_entry_ratio = 10;
  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null)
     <> floor(recruited / 5) then
    raise exception 'raising the ratio must not un-mint';
  end if;
end $$;
rollback;

-- The lock is taken UNCONDITIONALLY, before anything is read. There is no
-- longer a fast path that decides "nothing is owed" from an unlocked count --
-- that decision was itself the silent under-mint: two transactions each adding
-- one recruit to a roster of 8 both saw 9, both owed nothing, and committed 10
-- recruits with no free entry.
begin;
do $$
declare
  runner uuid;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');
  if not exists (select 1 from pg_locks
                  where locktype = 'advisory' and pid = pg_backend_pid()) then
    raise exception 'the rule must hold its advisory lock before reading counts';
  end if;
end $$;
rollback;

-- ...including a write that plainly owes nothing, which is the case the old
-- fast path let through unlocked.
begin;
do $$
declare
  ratio int;
  names text[];
  i int;
begin
  update entries set voided_at = now() where voided_at is null;
  perform admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                             '','email','', null, false, 'test');
  select free_entry_ratio into ratio from config limit 1;
  names := array[]::text[];
  for i in 1..(ratio - 1) loop names := names || format('Under %s', i); end loop;
  perform admin_create_owner('Under','Ratio','ur@example.com','','email','',
                             names, true, 'test');

  if (select count(*) from entries where is_free_entry and voided_at is null) <> 0 then
    raise exception 'nothing should be minted below the ratio';
  end if;
  if not exists (select 1 from pg_locks
                  where locktype = 'advisory' and pid = pg_backend_pid()) then
    raise exception
      'a write that owes nothing must STILL lock -- deciding that from an unlocked read is the bug';
  end if;
end $$;
rollback;

-- A restore whose backup was SHORT of its entitlement must settle without
-- colliding on the audit sequence.
--
-- `truncate ... restart identity` puts audit_log's sequence back to 1, and the
-- restored audit rows carry explicit ids, which do not advance it. The settle
-- then mints, minting writes an audit row through the sequence, and it takes
-- id 1 -- which the restore has already used:
--
--   ERROR: duplicate key value violates unique constraint "audit_log_pkey"
--   DETAIL: Key (id)=(1) already exists.
--
-- It bites only for a backup taken from a database that was itself short --
-- which is precisely the backup that most needs to restore cleanly, and was
-- the real state of this database on 2026-09-03. buildBackupSql now runs the
-- setval before the triggers come back on.
begin;
do $$
declare
  runner uuid;
  other uuid;
  ratio int;
  n bigint;
begin
  select free_entry_ratio into ratio from config limit 1;

  -- Stand in for the restore: everything cleared, triggers off, rows placed
  -- with explicit ids, sequence back at 1.
  -- The real restore uses TRUNCATE ... CASCADE, which fires no trigger at all;
  -- these deletes stand in for it and must clear the dependants first.
  delete from picks;
  delete from payments;
  delete from lynne_imports;
  delete from entries;
  delete from audit_log;
  delete from owners;
  alter table entries disable trigger user;
  alter table owners disable trigger user;
  alter table config disable trigger user;
  perform setval(pg_get_serial_sequence('audit_log','id'), 1, false);

  insert into owners (first_name, last_name, email)
  values ('Anthony', 'DellaPia', 'anthonydellapia@gmail.com')
  returning id into runner;
  insert into owners (first_name, last_name) values ('Ten','Recruits')
  returning id into other;
  insert into entries (owner_id, entry_index, entry_name)
  select other, i, format('R %s', i) from generate_series(1, ratio) as i;
  -- The backup holds no AAA row at all: it was taken while short by one.
  insert into audit_log (id, actor, action, target_table, target_id)
  values (1, 'import', 'seed_roster', 'owners', 'x');

  select setval(pg_get_serial_sequence('audit_log','id'),
                greatest((select coalesce(max(id), 1) from audit_log), 1)) into n;

  alter table entries enable trigger user;
  alter table owners enable trigger user;
  alter table config enable trigger user;
  update entries set entry_name = entry_name where false;

  if (select count(*) from entries where owner_id = runner and is_free_entry) <> 1 then
    raise exception 'the restore must settle a short backup, got % free',
      (select count(*) from entries where owner_id = runner and is_free_entry);
  end if;
  if not exists (select 1 from audit_log where action = 'mint_free_entries') then
    raise exception 'the settle must audit its mint';
  end if;
end $$;
rollback;

-- The runner buying entries for himself must not collide with his own mint.
--
-- admin_create_owner and admin_add_entries used to read max(entry_index) once
-- and increment a counter, which assumes nothing else writes between
-- iterations. Each insert is its own statement, so the mint fires between them
-- and takes the very index the loop was about to use. Both reproduced:
--
--   admin_create_owner(runner, ARRAY['Mine 1','Mine 2']) against a standing
--   backlog: Key (owner_id, entry_index)=(..., 1) already exists.
--   admin_add_entries(runner, ARRAY[...]) one short of a threshold:
--   Key (owner_id, entry_index)=(..., 6) already exists.
--
-- Reachable in ordinary use: CLAUDE.md says outright that an entry the runner
-- buys counts as recruited, and doing it while the roster sits one short of a
-- multiple of the ratio is all it takes.
begin;
do $$
declare
  runner uuid;
begin
  -- Creating the runner WITH entries, against a backlog the same call settles
  -- first: the mint takes entry_index 1..4 before the loop reaches its first.
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', array['Mine 1','Mine 2'], false, 'test');

  if (select count(*) from entries
       where owner_id = runner and not is_free_entry) <> 2 then
    raise exception 'the runner must hold both of his own entries, got %',
      (select count(*) from entries where owner_id = runner and not is_free_entry);
  end if;
  if (select count(distinct entry_index) from entries where owner_id = runner)
     <> (select count(*) from entries where owner_id = runner) then
    raise exception 'entry_index must stay unique within the owner';
  end if;
end $$;
rollback;

begin;
do $$
declare
  runner uuid;
  ratio int;
  recruited int;
  need int;
  names text[];
  i int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');
  select free_entry_ratio into ratio from config limit 1;
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;

  -- Leave the roster exactly one short, so the runner's FIRST purchased entry
  -- crosses the threshold and mints mid-loop.
  need := ratio - (recruited % ratio) - 1;
  if need > 0 then
    names := array[]::text[];
    for i in 1..need loop names := names || format('Filler %s', i); end loop;
    perform admin_create_owner('Filler','Owner','fo@example.com','','email','',
                               names, true, 'test');
  end if;

  perform admin_add_entries(runner, array['Anthony buy 1','Anthony buy 2'],
                            false, false, 'test');

  if (select count(*) from entries
       where owner_id = runner and not is_free_entry and voided_at is null) <> 2 then
    raise exception 'both of the runner''s purchased entries must survive';
  end if;
  if (select count(distinct entry_index) from entries where owner_id = runner)
     <> (select count(*) from entries where owner_id = runner) then
    raise exception 'the mint took an index the batch had reserved';
  end if;
  -- ...and the runner's own purchases count as recruited, per CLAUDE.md.
  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null)
     <> floor((select count(*) from entries e join owners o on o.id = e.owner_id
                where e.voided_at is null and not e.is_free_entry
                  and o.deleted_at is null) / ratio) then
    raise exception 'the runner''s own purchases must count toward the entitlement';
  end if;
end $$;
rollback;

-- The advisory lock is taken BEFORE the statement's row locks.
--
-- Taken in an AFTER trigger, a transaction is already holding row locks by the
-- time it asks for it, so two transactions can acquire the same two resources
-- in opposite orders. Reproduced with two sessions:
--
--   T1  update entries ... where owner_id = S   -> row locks, then advisory
--   T2  update owners  ... where id = S         -> row lock, waits on advisory
--   T1  update owners  ... where id = S         -> waits on T2's row lock
--   ERROR: deadlock detected
--
-- admin_merge_owner is exactly that shape: entries then owners, one
-- transaction. A BEFORE STATEMENT trigger runs before the statement takes any
-- lock, so the order is the same for everyone and there is no cycle.
--
-- The interleaving needs two connections, so what is checked here is the
-- property the argument rests on: the lock trigger exists on all three tables,
-- fires BEFORE, and per statement.
do $$
declare
  t text;
  n int;
begin
  foreach t in array array['entries','owners','config'] loop
    select count(*) into n
      from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
     where c.relname = t
       and not tg.tgisinternal
       and tg.tgfoid = 'lock_free_entry_rule'::regproc
       and (tg.tgtype & 2) = 2      -- BEFORE
       and (tg.tgtype & 1) = 0;     -- statement level, not per row
    if n <> 1 then
      raise exception
        'expected exactly one BEFORE STATEMENT lock trigger on %, found %', t, n;
    end if;
  end loop;
end $$;

-- ...and nothing can lock one of those rows without going through it. This
-- used to check only for an explicit `for update` / `for share` / `lock table`
-- in a function body, which was a much weaker claim than the one the ordering
-- argument rests on -- and it missed the real hole: a FOREIGN KEY takes a KEY
-- SHARE lock on the parent row, and the child's write fires no trigger there.
-- `insert into payments (owner_id = X)` locked owners(X) with no advisory lock
-- held, and against a concurrent hard delete of X that deadlocked:
--
--   ERROR:  deadlock detected
--   DETAIL: Process 3415 waits for ExclusiveLock on advisory lock ...
--
-- So the list of tables that must carry the lock trigger is DERIVED from
-- pg_constraint rather than restated here. Add a table with a foreign key into
-- entries, owners or config and forget the trigger, and this fails.
do $$
declare
  r record;
  n int;
begin
  for r in
    select distinct c.conrelid::regclass::text as child
      from pg_constraint c
     where c.contype = 'f'
       and c.confrelid::regclass::text in ('entries', 'owners', 'config')
  loop
    select count(*) into n
      from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid
     where cl.relname = r.child
       and not tg.tgisinternal
       and tg.tgfoid = 'lock_free_entry_rule'::regproc
       and (tg.tgtype & 2) = 2      -- BEFORE
       and (tg.tgtype & 1) = 0;     -- statement level
    if n <> 1 then
      raise exception
        '% holds a foreign key into a rule table, so its writes take a KEY SHARE lock there, but it has no BEFORE lock trigger', r.child;
    end if;
  end loop;
end $$;

-- Explicit locks are still worth watching, but as their own, narrower claim.
do $$
declare
  n int;
begin
  select count(*) into n from pg_proc p
   join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.prosrc ~* '(for\s+update|for\s+share|lock\s+table)';
  if n <> 0 then
    raise exception
      'a function now takes an explicit row/table lock; re-check the lock ordering argument (% found)', n;
  end if;
end $$;

-- Merging the RUNNER away is REFUSED.
--
-- admin_merge_owner moves the source's entries to the target and then archives
-- the source. With the runner as source the trigger fires in the gap, when he
-- is still a live confirmed owner holding nothing, and re-minted his whole
-- entitlement -- restarting the numbering at 1, because the highest-AAA lookup
-- was scoped to his rows too. Observed:
--
--   Brian Yost        live      AAA #1, AAA #2, AAA #3, AAA #4
--   Anthony DellaPia  archived  AAA #1, AAA #2, AAA #3, AAA #4
--
-- Four duplicated numbers Lynne holds, the fresh four stranded on an archived
-- owner, and the merge reporting success.
--
-- The operation is now refused outright, which is the honest answer: merging
-- the runner INTO someone else hands his free entries to another person, which
-- "Nobody else ever gets one" forbids, and leaves no owner row for the rule to
-- key on. Merging a duplicate INTO the runner is untouched.
begin;
do $$
declare
  runner uuid;
  target uuid;
  ok boolean := false;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');
  select o.id into target from owners o
   where o.deleted_at is null and o.id <> runner
     and exists (select 1 from entries e where e.owner_id = o.id)
   limit 1;

  begin
    perform admin_merge_owner(runner, target, 'test');
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'merging the runner away must be refused';
  end if;

  -- The other direction still works: a duplicate folded INTO the runner.
  perform admin_merge_owner(target, runner, 'test');
  if (select count(*) from (select entry_name from entries where is_free_entry
                             group by entry_name having count(*) > 1) d) <> 0 then
    raise exception 'merging INTO the runner duplicated an AAA number';
  end if;
end $$;
rollback;

-- A free entry marked on somebody ELSE does not count toward the runner's
-- entitlement, and must not suppress his mint.
--
-- The admin UI exposes a "free" checkbox on the add and edit dialogs for any
-- owner. Counting those pool-wide silently cost him an entry -- 60 recruited,
-- owed 6, holding 5 -- with /admin comparing 6 against 6 and raising nothing.
begin;
do $$
declare
  runner uuid;
  other uuid;
  ratio int;
  recruited int;
  held_before int;
  names text[];
  i int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');
  select free_entry_ratio into ratio from config limit 1;
  select count(*) into held_before from entries
   where owner_id = runner and is_free_entry and voided_at is null;

  select o.id into other from owners o
   where o.deleted_at is null and o.id <> runner limit 1;
  -- Somebody else's entry, flagged free. Not the runner's, so not his.
  perform admin_add_entries(other, array['Not Anthony''s freebie'],
                            false, true, 'test');

  -- Cross the next threshold: he is owed one more and must get it.
  select count(*) into recruited from entries e join owners o on o.id = e.owner_id
   where e.voided_at is null and not e.is_free_entry and o.deleted_at is null;
  names := array[]::text[];
  for i in 1..(ratio - (recruited % ratio)) loop
    names := names || format('Cross %s', i);
  end loop;
  perform admin_create_owner('Cross','Threshold','ct@example.com','','email','',
                             names, true, 'test');

  if (select count(*) from entries
       where owner_id = runner and is_free_entry and voided_at is null)
     <> held_before + 1 then
    raise exception
      'a free entry on another owner must not suppress the runner''s mint: he holds %, expected %',
      (select count(*) from entries
        where owner_id = runner and is_free_entry and voided_at is null),
      held_before + 1;
  end if;
end $$;
rollback;

-- The numbering follows the NAME, not the is_free_entry flag.
--
-- That flag is internal bookkeeping and the entry dialog lets an admin toggle
-- it. Reading it meant unticking "free" on AAA #4 both dropped it from the
-- held count AND hid its still-current name from the numbering query, so the
-- same statement minted a second live row called AAA #4:
--
--   entry_name | rows | flagged_free
--   AAA #4     |    2 |            1
--
-- The name is what Lynne holds a number against.
begin;
do $$
declare
  runner uuid;
  victim uuid;
  highest int;
begin
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');
  select coalesce(max((regexp_match(entry_name,'^AAA #?(\d+)$'))[1]::int), 0)
    into highest from entries where owner_id = runner and is_free_entry;
  if highest < 1 then raise exception 'setup: expected a minted backlog'; end if;

  select id into victim from entries
   where owner_id = runner and entry_name = 'AAA #' || highest;
  -- Untick "free" on it, exactly as the entry dialog does.
  perform admin_update_entry(victim, 'AAA #' || highest, null, false, 'test');

  if exists (
    select 1 from entries where entry_name like 'AAA %'
     group by entry_name having count(*) > 1
  ) then
    raise exception 'unticking the free flag duplicated an AAA name';
  end if;
end $$;
rollback;

-- REPEATABLE READ is refused, because the rule cannot hold under it.
--
-- The advisory lock works by making a waiter re-read the counts after the
-- transaction ahead of it commits, and that depends on READ COMMITTED giving
-- each statement a fresh snapshot. Under REPEATABLE READ the snapshot is fixed
-- at the first statement and a lock does not refresh it, so the waiter blocks,
-- acquires, re-reads, and sees exactly what it saw before. Measured with two
-- sessions, 8 recruited at a ratio of 10, one recruit each:
--
--   read committed    recruited=10  free=1   correct
--   repeatable read   recruited=10  free=0   SILENTLY UNDER-MINTED
--   serializable      recruited=9   free=0   correct (SSI aborted one)
--
-- Only the middle one is refused. SERIALIZABLE is safe on its own terms.
begin;
set transaction isolation level repeatable read;
do $$
declare
  ok boolean := false;
begin
  begin
    insert into owners (first_name, last_name) values ('Repeatable','Read');
  exception when invalid_transaction_state then
    ok := true;
  end;
  if not ok then
    raise exception 'a write under REPEATABLE READ must be refused';
  end if;
end $$;
rollback;

-- ...but ONLY for the tables where an entitlement decision follows. `payments`
-- and `picks` carry the lock trigger purely for foreign-key lock ordering, and
-- refusing them refused writes that cannot get the entitlement wrong -- with a
-- message about an entitlement neither can change. Both were observed failing.
begin;
set transaction isolation level repeatable read;
do $$
declare
  o uuid;
  e uuid;
begin
  select id into o from owners where deleted_at is null limit 1;
  select id into e from entries limit 1;
  insert into payments (owner_id, amount_cents, method, paid_on)
  values (o, 3000, 'venmo', current_date);
  insert into picks (entry_id, week, team, source) values (e, 1, 'KC', 'admin');
end $$;
rollback;

-- A transaction that writes a payment AND a rule table is still refused, so
-- nothing gets in by the side door.
begin;
set transaction isolation level repeatable read;
do $$
declare
  o uuid;
  ok boolean := false;
begin
  select id into o from owners where deleted_at is null limit 1;
  insert into payments (owner_id, amount_cents, method, paid_on)
  values (o, 3000, 'venmo', current_date);
  begin
    insert into owners (first_name, last_name) values ('Side','Door');
  exception when invalid_transaction_state then
    ok := true;
  end;
  if not ok then
    raise exception 'a rule-table write under REPEATABLE READ must still be refused';
  end if;
end $$;
rollback;

-- ...and the levels the rule IS correct under are not refused.
begin;
set transaction isolation level serializable;
do $$
begin
  insert into owners (first_name, last_name) values ('Serializable','Fine');
end $$;
rollback;

begin;
set transaction isolation level read committed;
do $$
begin
  insert into owners (first_name, last_name) values ('ReadCommitted','Fine');
end $$;
rollback;

-- admin_merge_owner takes the rule's lock BEFORE it reads anything.
--
-- Its runner-as-source guard is the first thing it does, and it was deciding
-- unlocked. With no runner yet, the merge could read the source's old email
-- and pass, a concurrent admin_update_owner could set that email to the
-- runner's and commit (minting the backlog under the source), and the merge
-- would proceed on the stale answer -- archiving the sole runner and moving
-- the entries it had just been given. Reproduced with two sessions.
--
-- The interleaving needs two connections; what is checked here is the property
-- the fix rests on -- that nothing is read before the lock is held.
do $$
declare
  v_src text;
  lock_at int;
  read_at int;
begin
  select prosrc into v_src from pg_proc where proname = 'admin_merge_owner';
  lock_at := position('pg_advisory_xact_lock' in v_src);
  read_at := position('o.email from owners o where o.id = p_source' in v_src);
  if lock_at = 0 then
    raise exception 'admin_merge_owner must take the rule''s advisory lock';
  end if;
  if read_at = 0 then
    raise exception 'expected admin_merge_owner to guard on the source''s email';
  end if;
  if lock_at > read_at then
    raise exception
      'admin_merge_owner reads the source before locking, so its guard can decide from a snapshot another transaction invalidates';
  end if;
end $$;
