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
  update entries set entry_name = entry_name where false;

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
  update entries set entry_name = entry_name where false;

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
  update entries set entry_name = entry_name where false;

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
  update entries set entry_name = entry_name where false;

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
  update entries set entry_name = entry_name where false;

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
  update entries set entry_name = entry_name where false;

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
  update entries set entry_name = entry_name where false;

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
  update entries set entry_name = entry_name where false;

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
  -- Hand-place the legacy names, then let the trigger continue from them.
  insert into entries (owner_id, entry_index, entry_name, is_free_entry)
  select runner, n, format('AAA %s', n), true from generate_series(1, 4) as n;

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
  update entries set entry_name = entry_name where false;
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

-- The mint is SERIALIZED, and the fast path is not.
--
-- Two concurrent roster writes that each cross the same threshold both used to
-- read "held 4, owed 5" and both tried to insert AAA #5 at the same
-- entry_index; the second died on the (owner_id, entry_index) unique
-- constraint, losing a legitimate owner with an error naming a column nobody
-- touched. 20260904000044 puts the mint behind an advisory lock and re-reads
-- the counts inside it.
--
-- A psql script has one connection, so the interleaving itself cannot be
-- reproduced here. What IS checked is the mechanism: that a minting statement
-- holds the lock, and -- just as important, since it is what keeps ordinary
-- roster edits from contending -- that a non-minting statement does not.
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
  update entries set entry_name = entry_name where false;
  select count(*) into locks_after from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid();
  if locks_after < 1 then
    raise exception 'a minting statement must hold the advisory lock';
  end if;
end $$;
rollback;

-- ...and the fast path takes no lock at all: a transaction whose writes never
-- cross a threshold must finish holding none. This is what keeps ordinary
-- roster edits -- every write except the handful that actually earn something
-- -- from serialising against each other.
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
  -- Clear the fixture roster so nothing is owed from the start: this
  -- transaction must never reach the critical section at all.
  update entries set voided_at = now() where voided_at is null;
  runner := admin_create_owner('Anthony','DellaPia','anthonydellapia@gmail.com',
                               '','email','', null, false, 'test');
  select free_entry_ratio into ratio from config limit 1;

  -- One short of the first threshold: nothing owed, ever, in this transaction.
  names := array[]::text[];
  for i in 1..(ratio - 1) loop names := names || format('Under %s', i); end loop;
  perform admin_create_owner('Under','Ratio','ur@example.com','','email','',
                             names, true, 'test');

  if (select count(*) from entries where is_free_entry and voided_at is null) <> 0 then
    raise exception 'setup: nothing should have been minted below the ratio';
  end if;
  if exists (select 1 from pg_locks
              where locktype = 'advisory' and pid = pg_backend_pid()) then
    raise exception
      'the fast path must take no advisory lock -- ordinary roster edits would contend';
  end if;
end $$;
rollback;
