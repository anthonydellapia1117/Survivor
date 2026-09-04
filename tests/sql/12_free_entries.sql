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

-- ...and nothing else in the schema takes a row lock on those tables without
-- going through it. A `select ... for update` or a `lock table` anywhere would
-- reopen the cycle the BEFORE trigger closes.
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
