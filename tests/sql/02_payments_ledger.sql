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

-- ...but the SAME receipt may legitimately settle TWO DIFFERENT owners. One
-- Venmo covering someone else's entries as well as your own is a fact about how
-- it was paid, not a double count, so the guard is per (transaction, owner).
do $$
declare
  maria uuid;
  yost uuid;
  txn text := 'split-across-two-owners-0001';
  rejected boolean := false;
begin
  select id into maria from owners where last_name = 'DiCicco';
  select id into yost  from owners where last_name = 'Yost';

  insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note)
  values (maria, 10000, 'venmo', '2026-09-03', txn, 'half of one payment');

  -- second owner, same receipt: must be ACCEPTED
  insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note)
  values (yost, 10000, 'venmo', '2026-09-03', txn, 'other half of the same payment');

  if (select count(*) from payments where venmo_txn_id = txn) <> 2 then
    raise exception 'one transaction could not be split across two owners';
  end if;

  -- same owner, same receipt AGAIN: must still be REJECTED. Widening the key
  -- must not weaken the guard it exists for.
  begin
    insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note)
    values (maria, 10000, 'venmo', '2026-09-03', txn, 'genuine double entry');
  exception when unique_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'the same receipt was recorded twice against the same owner';
  end if;

  -- Leave the fixture exactly as found; later blocks assert on these balances.
  delete from payments where venmo_txn_id = txn;
end $$;

-- The same split through admin_record_payment, which is the path actually used
-- to record one Venmo covering two owners.
do $$
declare
  maria uuid;
  yost uuid;
  txn text := 'split-via-rpc-0002';
  rejected boolean := false;
begin
  select id into maria from owners where last_name = 'DiCicco';
  select id into yost  from owners where last_name = 'Yost';

  perform admin_record_payment(maria, 10000, 'venmo', current_date, txn,
                               'one payment, first owner', null, 'test');
  perform admin_record_payment(yost, 10000, 'venmo', current_date, txn,
                               'one payment, second owner', null, 'test');
  if (select count(*) from payments where venmo_txn_id = txn) <> 2 then
    raise exception 'the RPC could not split one payment across two owners';
  end if;

  -- Same owner again through the RPC: still rejected, as unique_violation.
  begin
    perform admin_record_payment(maria, 10000, 'venmo', current_date, txn,
                                 'double entry', null, 'test');
    raise exception 'the RPC accepted the same receipt twice for one owner';
  exception when unique_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'expected a unique_violation from the RPC';
  end if;

  delete from audit_log where target_id in
    (select id::text from payments where venmo_txn_id = txn);
  delete from payments where venmo_txn_id = txn;
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
