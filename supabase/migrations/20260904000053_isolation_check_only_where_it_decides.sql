-- Scope the REPEATABLE READ refusal to the tables where an entitlement
-- decision actually follows. Codex's finding, reproduced against a real
-- database.
--
-- 20260904000051 put the isolation check in lock_free_entry_rule(), and
-- 20260904000050 had attached that same function to `payments` and `picks` --
-- not because they affect the entitlement, but so a foreign-key KEY SHARE lock
-- on a parent row cannot be taken before the advisory lock. Those two facts
-- combined into collateral damage: at REPEATABLE READ, recording a payment or
-- submitting a pick now failed, with an error about an entitlement neither can
-- change. Observed for both.
--
--   ERROR: the free-entry rule cannot hold under REPEATABLE READ: ...
--
-- The check belongs where a stale snapshot can produce a wrong answer, which
-- is where mint_free_entries can follow: entries, owners, config. A payments
-- or picks write never reaches it, and a transaction that writes both a
-- payment AND one of the three still gets refused on the latter, so nothing
-- slips through by going in the side door.
--
-- Kept as one function and one trigger set rather than splitting into a
-- lock-only variant and a checking one: the split would mean `entries` and
-- `owners` -- which are both rule tables AND foreign-key parents -- carry a
-- different function from `payments` and `picks`, and the test that derives
-- the FK-child list from pg_constraint would have to know which is which. One
-- function that asks TG_TABLE_NAME keeps that guard honest and simple.

create or replace function lock_free_entry_rule()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Only where mint_free_entries can follow. payments and picks carry this
  -- trigger purely for foreign-key lock ordering; refusing them would be
  -- refusing writes that cannot get the entitlement wrong.
  if tg_table_name in ('entries', 'owners', 'config')
     and current_setting('transaction_isolation') = 'repeatable read' then
    raise exception
      'the free-entry rule cannot hold under REPEATABLE READ: a fixed snapshot means this transaction would decide the entitlement from counts that predate any concurrent roster change. Use READ COMMITTED (the default) or SERIALIZABLE.'
      using errcode = 'invalid_transaction_state';
  end if;
  -- Same key as mint_free_entries. Re-acquiring within a transaction is free,
  -- so a multi-statement RPC pays for this once.
  perform pg_advisory_xact_lock(hashtext('mint_free_entries')::bigint);
  return null;
end $$;
