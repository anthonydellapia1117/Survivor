-- The payments ledger: append-only, database-enforced dedupe, corrections as rows.
-- All mutations here roll back — the fixture stays clean for later files.

begin;

-- Acceptance 5: a duplicate venmo_txn_id is rejected by the DATABASE, not app code.
do $$
declare
  maria uuid;
  rejected boolean := false;
begin
  select id into maria from owners where last_name = 'DiCicco';
  begin
    insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id)
    values (maria, 10000, 'venmo', '2026-08-14', '4663800776141712543');
  exception when unique_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'duplicate venmo_txn_id was accepted — unique constraint missing';
  end if;
end $$;

-- Corrections: new negative rows referencing the row they correct. The computed
-- balance follows the ledger with no edit or delete.
do $$
declare
  yost uuid;
  orig uuid;
  bal bigint;
begin
  select id into yost from owners where last_name = 'Yost';
  select id into orig from payments where owner_id = yost;

  insert into payments (owner_id, amount_cents, method, paid_on, corrects_payment_id, note)
  values (yost, -3000, 'correction', current_date, orig, 'test: half refunded');

  select amount_paid_cents into bal from v_owner_finance where owner_id = yost;
  if bal <> 3000 then
    raise exception 'after -3000 correction Yost balance should be 3000, got %', bal;
  end if;
end $$;

-- A payment with no owner is quarantined (null owner_id), counted nowhere.
do $$
declare
  total_before bigint;
  total_after bigint;
begin
  select sum(amount_paid_cents) into total_before from v_owner_finance;
  insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note)
  values (null, 5000, 'venmo', current_date, 'TEST-UNMATCHED-1', 'test: unmatched sender');
  select sum(amount_paid_cents) into total_after from v_owner_finance;
  if total_after <> total_before then
    raise exception 'unmatched payment leaked into owner balances';
  end if;
end $$;

rollback;

-- Fixture is untouched after rollback.
do $$
begin
  if (select count(*) from payments) <> 4 then
    raise exception 'payment fixture polluted';
  end if;
end $$;
