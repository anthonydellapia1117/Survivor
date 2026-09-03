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

drop index if exists payments_venmo_txn_id_owner_key;

create unique index payments_venmo_txn_id_owner_key
  on payments (
    venmo_txn_id,
    coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where corrects_payment_id is null and venmo_txn_id is not null;

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
