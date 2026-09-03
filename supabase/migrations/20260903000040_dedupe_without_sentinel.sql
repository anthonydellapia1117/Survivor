-- Replace the nil-uuid sentinel with two partial indexes.
--
-- 20260903000039 restored dedupe for unmatched receipts by folding NULL owners
-- into one bucket with coalesce(owner_id, '000...0'::uuid). That works, but it
-- leans on a value never being a real owner id. Nothing in the schema forbids
-- an owners row with the nil uuid, and if one existed its payments would dedupe
-- against the quarantine pile instead of against themselves. gen_random_uuid()
-- will not produce it, but "the generator won't" is a weaker guarantee than
-- "the shape cannot".
--
-- Splitting the predicate says the same thing without the sentinel, and each
-- index now states its own rule:
--
--   owner_id is not null -> one row per (transaction, owner), which is what
--                           lets one Venmo settle two owners
--   owner_id is null     -> one row per transaction, so a receipt can sit in
--                           the unmatched pile exactly once
--
-- admin_record_payment is unchanged: `is not distinct from` already gives the
-- pre-check NULL-equal semantics and needs no sentinel either.
--
-- Suggested by Copilot on PR #6.

-- Fail legibly, not with a bare index violation. Either unique index below
-- refuses to build if the 37-era regression left duplicate rows behind, and a
-- failed CREATE INDEX aborts the migration with an opaque message about a
-- constraint the operator has never seen.
--
-- Reconciling automatically is not an option: the payments ledger is
-- append-only, corrections are new rows and never edits or deletes, so a
-- migration must not resolve duplicate money on its own. It reports them
-- instead, precisely enough to act on.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s (%s rows, unmatched)', venmo_txn_id, n), '; ')
    into v_bad
    from (select venmo_txn_id, count(*) as n
            from payments
           where corrects_payment_id is null
             and venmo_txn_id is not null
             and owner_id is null
           group by venmo_txn_id having count(*) > 1) d;
  if v_bad is not null then
    raise exception
      'duplicate unmatched receipts must be reconciled before this index can be built: %. Resolve them with correction rows (the ledger is append-only), then re-run.',
      v_bad;
  end if;

  select string_agg(format('%s / owner %s (%s rows)', venmo_txn_id, owner_id, n), '; ')
    into v_bad
    from (select venmo_txn_id, owner_id, count(*) as n
            from payments
           where corrects_payment_id is null
             and venmo_txn_id is not null
             and owner_id is not null
           group by venmo_txn_id, owner_id having count(*) > 1) d;
  if v_bad is not null then
    raise exception
      'the same receipt is recorded more than once against one owner: %. Resolve with correction rows, then re-run.',
      v_bad;
  end if;
end $$;

drop index if exists payments_venmo_txn_id_owner_key;
drop index if exists payments_venmo_txn_id_unmatched_key;

create unique index payments_venmo_txn_id_owner_key
  on payments (venmo_txn_id, owner_id)
  where corrects_payment_id is null
    and venmo_txn_id is not null
    and owner_id is not null;

create unique index payments_venmo_txn_id_unmatched_key
  on payments (venmo_txn_id)
  where corrects_payment_id is null
    and venmo_txn_id is not null
    and owner_id is null;
