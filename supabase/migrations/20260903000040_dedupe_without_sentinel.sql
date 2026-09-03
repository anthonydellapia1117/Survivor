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

drop index if exists payments_venmo_txn_id_owner_key;

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
