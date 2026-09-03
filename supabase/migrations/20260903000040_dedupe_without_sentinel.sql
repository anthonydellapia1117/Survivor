-- Swap the payment dedupe index for two partial ones, gaplessly.
--
-- 37 keyed the dedupe on (venmo_txn_id, owner_id). owner_id is nullable and
-- NULL means unmatched/quarantined, and PostgreSQL treats NULLs as distinct in
-- a unique index, so that key silently stopped deduplicating the unmatched
-- pile. The replacement states each rule separately:
--
--   owner_id is not null -> one row per (transaction, owner), which is what
--                           lets one Venmo settle two owners
--   owner_id is null     -> one row per transaction, so a receipt sits in the
--                           unmatched pile exactly once
--
-- Ordering matters. The new indexes are BUILT BEFORE the old one is dropped,
-- and the matched index is swapped in under a temporary name, so at no point
-- is the table without dedupe protection. If any build fails the old index is
-- still standing and the database is no worse off than before this ran.
--
-- An earlier draft dropped the old index in 39 and rebuilt here; that left a
-- window with no protection at all whenever this migration stopped.

-- Preflight: report duplicates in terms an operator can act on, rather than
-- failing with an opaque violation naming an index they have never seen.
--
-- It deliberately does NOT reconcile anything. The payments ledger is
-- append-only - corrections are new rows, never edits or deletes - so a
-- migration must not resolve duplicate money on its own.
--
-- Note the condition carefully: a correction row does NOT clear a duplicate,
-- because corrects_payment_id is set on the correction itself while both
-- originals remain non-correction rows and keep counting here. What the index
-- needs is at most ONE non-correction row per bucket, which is reached by
-- MATCHING the extras to their owners - the normal quarantine-to-matched step,
-- which moves a row out of the unmatched bucket - and reversing any that are
-- not real money with a correction row against whichever copy survives.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s (%s unmatched rows)', venmo_txn_id, n), '; ')
    into v_bad
    from (select venmo_txn_id, count(*) as n
            from payments
           where corrects_payment_id is null
             and venmo_txn_id is not null
             and owner_id is null
           group by venmo_txn_id having count(*) > 1) d;
  if v_bad is not null then
    raise exception
      'the unmatched pile holds a transaction more than once: %. Assign the extra rows to their owners (which moves them out of the unmatched bucket), and reverse any that are not real money with a correction row against the copy that remains, until at most one non-correction unmatched row per transaction is left. A correction row alone does NOT satisfy this - the original it corrects still counts.',
      v_bad;
  end if;

  -- The matched bucket is a different case, and the honest answer is that it
  -- has no append-only remedy. Every dedupe regime this table has had covered
  -- matched pairs - venmo_txn_id was column-unique at creation, then uniquely
  -- indexed on the column alone, then on (venmo_txn_id, owner_id) - so the
  -- 37-era regression could not produce this state and no supported workflow
  -- can either: admin_record_payment only ever inserts.
  --
  -- Which means the earlier draft's advice here was doubly wrong. Re-pointing
  -- or clearing an original's venmo_txn_id is an edit to a payment row, and
  -- the table says outright: "append-only ledger. Corrections are new rows,
  -- never edits or deletes." A correction row does not help either - the
  -- originals it corrects still sit inside the predicate. So this reports the
  -- state and stops, rather than prescribing something that would either fail
  -- or break the audit model.
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
      'the same receipt is recorded more than once against one owner: %. This cannot be produced by any supported path - every dedupe index this table has had covered matched pairs, and admin_record_payment only inserts - so these rows were written with the index absent. There is no append-only fix: a correction row leaves the originals inside the predicate, and altering an original is barred by the ledger invariant. Decide deliberately which row is real money, record that decision in audit_log, and apply it as an explicit one-off before re-running this migration.',
      v_bad;
  end if;
end $$;

-- Build first. The unmatched index has no counterpart in 37, so it simply
-- appears; the matched one is built under a temporary name because the old
-- index still holds the canonical one.
create unique index if not exists payments_venmo_txn_id_unmatched_key
  on payments (venmo_txn_id)
  where corrects_payment_id is null
    and venmo_txn_id is not null
    and owner_id is null;

create unique index if not exists payments_venmo_txn_id_owner_key_new
  on payments (venmo_txn_id, owner_id)
  where corrects_payment_id is null
    and venmo_txn_id is not null
    and owner_id is not null;

-- Only now retire the old one and take its name.
drop index if exists payments_venmo_txn_id_owner_key;
alter index payments_venmo_txn_id_owner_key_new
  rename to payments_venmo_txn_id_owner_key;
