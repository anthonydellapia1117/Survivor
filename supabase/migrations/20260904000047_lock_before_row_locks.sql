-- Take the free-entry rule's advisory lock BEFORE the statement's row locks,
-- not after. Codex's finding, reproduced against a real database.
--
-- THE DEADLOCK
--
-- 20260904000045 takes the advisory lock inside an AFTER STATEMENT trigger, so
-- by the time a transaction asks for it, it is already holding row locks on
-- the rows it just wrote. Two transactions then acquire the same two resources
-- in opposite orders, which is the textbook shape:
--
--   T1 (a merge): `update entries set owner_id = target where owner_id = S`
--       -> row locks on those entries, then the AFTER trigger takes the
--          advisory lock.
--   T2 (an owner edit): `update owners ... where id = S`
--       -> row lock on owners(S), then its AFTER trigger WAITS for the
--          advisory lock that T1 holds.
--   T1 continues to its second statement, `update owners ... where id = S`,
--       and waits for the row lock T2 holds.
--
-- Observed:
--   ERROR:  deadlock detected
--   DETAIL: Process 18350 waits for ShareLock on transaction 60331;
--           blocked by process 18349.
--
-- PostgreSQL breaks it by aborting one of them, so a legitimate admin action
-- fails. admin_merge_owner is exactly this shape: it updates `entries` and
-- then `owners` in one transaction.
--
-- THE FIX
--
-- A BEFORE STATEMENT trigger runs before its statement takes any lock at all.
-- Taking the advisory lock there makes the order the same for everyone: this
-- lock first, row locks second, always. Two transactions can no longer hold
-- them in opposite orders, so there is no cycle to detect.
--
-- That argument depends on there being no OTHER way to take a row lock on
-- these three tables, since anything that bypassed the trigger would restore
-- the cycle. There is not: the schema contains no `select ... for update`,
-- no `for share` and no `lock table` anywhere, so every row lock on entries,
-- owners and config comes from DML, and all DML fires this.
--
-- Reconciliation still happens afterwards, in the AFTER trigger, where it has
-- to: the rule reads counts that the statement is in the middle of changing.

create or replace function lock_free_entry_rule()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Same key as mint_free_entries. Re-acquiring within a transaction is free,
  -- so a multi-statement RPC pays for this once.
  perform pg_advisory_xact_lock(hashtext('mint_free_entries')::bigint);
  return null;
end $$;

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

-- mint_free_entries keeps its own `perform pg_advisory_xact_lock`. By the time
-- it runs the lock is always already held, so the call is free -- but leaving
-- it in means the function's correctness does not rest on a second trigger
-- having fired first.
