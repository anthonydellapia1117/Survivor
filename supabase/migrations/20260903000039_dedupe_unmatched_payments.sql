-- Restore dedupe for unmatched (quarantined) receipts.
--
-- 20260903000037 keyed the payment dedupe on (venmo_txn_id, owner_id) so one
-- Venmo could settle two owners. It missed that owner_id is nullable and that
-- NULL is a meaningful state here - the schema says so outright:
--
--   owner_id uuid references owners(id),  -- null = unmatched, quarantined
--   venmo_txn_id text unique,             -- unique constraint IS the dedupe
--
-- PostgreSQL treats NULLs as distinct in a unique index, so once owner_id
-- joined the key, an unmatched receipt stopped being deduplicated at all: the
-- same transaction could be quarantined any number of times. The RPC
-- pre-check missed it too, because `owner_id = p_owner_id` is NULL, never
-- true, when both sides are NULL. Confirmed against production - the same
-- txn id inserted twice with a null owner where the old index allowed one.
--
-- That is a regression in the exact guarantee 37 set out to preserve, and it
-- lands on the unmatched pile, which is precisely where a receipt sits before
-- anyone has looked at it.
--
-- Both layers now use NULL-equal semantics: the index folds every unmatched
-- row into one bucket via a nil-uuid sentinel, and the pre-check uses
-- `is not distinct from`. An unmatched transaction can appear once, a matched
-- one once per owner, and the split that 37 exists for still works.

-- AMENDED after this migration had already been applied. As first written it
-- dropped the index from 37 and created one keyed on coalesce(owner_id,
-- nil-uuid). Two problems, both on schema-legal data:
--
--   * that index refuses to build against duplicate unmatched rows left by the
--     37-era regression, or against an owners row holding the nil uuid, and a
--     failed CREATE INDEX aborts this migration before the RPC below installs,
--     which stops 20260903000040 from running at all;
--   * dropping the old index here and creating the replacement in a LATER
--     migration leaves the database with no payment dedupe whatsoever if that
--     later migration stops - concurrent admin_record_payment calls can both
--     clear the pre-check, and direct inserts can duplicate matched receipts
--     freely.
--
-- So this migration no longer touches indexes at all. The index from 37 stays
-- in force, still protecting matched payments, until 20260903000040 swaps it
-- gaplessly for the two partial indexes. Only the RPC is corrected here, which
-- is safe to do on any database.
--
-- Production ran the original form cleanly, having neither hazard condition,
-- and then ran 40, so the live end state is unchanged by this amendment; only
-- a fresh replay behaves differently, and better.

create or replace function public.admin_record_payment(
  p_owner_id uuid, p_amount_cents integer, p_method text, p_paid_on date,
  p_venmo_txn_id text, p_note text, p_corrects uuid, p_actor text
) returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_txn text := nullif(p_venmo_txn_id, '');
begin
  -- `is not distinct from`, not `=`: an unmatched receipt has a null owner on
  -- both sides, and `null = null` would let it through every time.
  if p_corrects is null and v_txn is not null
     and exists (select 1 from payments
                  where owner_id is not distinct from p_owner_id
                    and venmo_txn_id = v_txn) then
    raise exception
      'transaction % is already recorded against this owner', v_txn
      using errcode = 'unique_violation';
  end if;

  insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note, corrects_payment_id)
  values (p_owner_id, p_amount_cents, p_method, p_paid_on,
          v_txn, nullif(p_note, ''), p_corrects)
  returning id into v_id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'record_payment', 'payments', v_id::text,
          jsonb_build_object('owner_id', p_owner_id, 'amount_cents', p_amount_cents,
                             'method', p_method, 'corrects', p_corrects));
  return v_id;
end $function$;
