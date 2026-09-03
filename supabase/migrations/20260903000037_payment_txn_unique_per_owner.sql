-- One Venmo transaction may settle more than one owner - but only once each.
--
-- payments_venmo_txn_id_key was unique on venmo_txn_id alone, which reads the
-- dedupe rule as "a transaction id may appear once in the ledger". The rule it
-- exists to enforce is narrower: do not record the same receipt against the
-- same person twice.
--
-- Those coincide until someone pays for somebody else. On 2026-09-03 Nicholas
-- Teti sent one $200 Venmo covering eight entries across TWO owner records -
-- his own four and his father Jim Teti's four. Splitting it $100 per owner is
-- the correct shape: each balance reflects what was paid for them, and both
-- rows cite the transaction that settled them. Every way around the old index
-- was worse - dropping the txn id from one row loses the audit link on the row
-- that most needs it, and suffixing the id fabricates a reference that does not
-- exist.
--
-- Widening the index alone is NOT enough, and the merge suite is what proves
-- it. admin_merge_owner reverses the source's payment and reposts it onto the
-- target, and both of those carry corrects_payment_id, so they sit outside the
-- partial index. Keyed on (txn, owner) the index therefore sees no row for the
-- target and would wave through a fresh, uncorrected re-record of money the
-- target had already absorbed - the same money, not a split.
--
-- So the guard is in two parts:
--   * the index catches a plain double entry against one owner, including
--     writes that bypass the RPC;
--   * admin_record_payment refuses a NEW payment when that owner already holds
--     the transaction in ANY row, correction rows included, which is what
--     closes the merge-repost hole.
-- It raises unique_violation so callers that already handle the old constraint
-- keep working unchanged.

drop index if exists payments_venmo_txn_id_key;

create unique index payments_venmo_txn_id_owner_key
  on payments (venmo_txn_id, owner_id)
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
  -- A new (non-correction) payment may not re-record a transaction this owner
  -- already holds, in any form. The partial index cannot see correction rows,
  -- which is exactly how a merge repost would otherwise be duplicated.
  if p_corrects is null and v_txn is not null
     and exists (select 1 from payments
                  where owner_id = p_owner_id and venmo_txn_id = v_txn) then
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
