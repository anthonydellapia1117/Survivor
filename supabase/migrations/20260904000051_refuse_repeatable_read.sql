-- Refuse REPEATABLE READ for writes the free-entry rule watches. Codex's
-- finding, reproduced against a real database at all three isolation levels.
--
-- The rule's correctness under concurrency rests on the advisory lock making a
-- waiting transaction re-read the counts AFTER the one ahead of it commits.
-- That works because READ COMMITTED gives every statement a fresh snapshot.
-- REPEATABLE READ does not: the snapshot is fixed at the transaction's first
-- statement, and taking a lock does not refresh it. So the waiter dutifully
-- blocks, acquires, re-reads -- and sees exactly what it saw before.
--
-- Measured, 8 recruited at a ratio of 10, two transactions each adding one:
--
--   read committed    recruited=10  free=1   correct
--   repeatable read   recruited=10  free=0   SILENTLY UNDER-MINTED
--   serializable      recruited=9   free=0   correct (one aborted, cleanly)
--
-- SERIALIZABLE is safe on its own terms: SSI sees the read-write dependency
-- between the two and aborts one with "could not serialize access due to
-- read/write dependencies among transactions". Nothing wrong commits. So this
-- refuses exactly one level, not everything above READ COMMITTED.
--
-- Why refuse rather than paper over it: a snapshot cannot be refreshed
-- mid-transaction, so there is no version of this rule that is correct under
-- REPEATABLE READ. The honest answer is to say so at the point of the write,
-- rather than let a hand-run script quietly cost Anthony an entry. PostgREST
-- uses READ COMMITTED, so no app path is affected; this only ever fires for
-- SQL that opted in explicitly.
--
-- It lives in the BEFORE trigger so it fails on the first statement to touch
-- any watched table, before that transaction has done any work worth losing.

create or replace function lock_free_entry_rule()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('transaction_isolation') = 'repeatable read' then
    raise exception
      'the free-entry rule cannot hold under REPEATABLE READ: a fixed snapshot means this transaction would decide the entitlement from counts that predate any concurrent roster change. Use READ COMMITTED (the default) or SERIALIZABLE.'
      using errcode = 'invalid_transaction_state';
  end if;
  -- Same key as mint_free_entries. Re-acquiring within a transaction is free,
  -- so a multi-statement RPC pays for this once.
  perform pg_advisory_xact_lock(hashtext('mint_free_entries')::bigint);
  return null;
end $$;
