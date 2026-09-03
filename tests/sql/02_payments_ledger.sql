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

-- An UNMATCHED receipt (owner_id null = quarantined) must still dedupe. NULLs
-- are distinct in a unique index, so putting owner_id in the key silently
-- exempts the quarantine pile unless NULL-equal semantics are used.
do $$
declare
  txn text := 'unmatched-quarantine-0003';
  rejected boolean := false;
begin
  insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note)
  values (null, 3000, 'venmo', current_date, txn, 'quarantined, unmatched');

  begin
    insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note)
    values (null, 3000, 'venmo', current_date, txn, 'same receipt again');
  exception when unique_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'the same unmatched receipt was quarantined twice';
  end if;

  -- and through the RPC, where `owner_id = p_owner_id` would never match on nulls
  rejected := false;
  begin
    perform admin_record_payment(null, 3000, 'venmo', current_date, txn,
                                 'same receipt via RPC', null, 'test');
  exception when unique_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'the RPC re-quarantined the same unmatched receipt';
  end if;

  delete from payments where venmo_txn_id = txn;
end $$;

-- MATCHING a quarantined row to its owner absorbs at most ONE copy per owner.
-- Migration 40's preflight tells an operator to drain a duplicate pile this
-- way, and that instruction is only followable up to this ceiling: the
-- (venmo_txn_id, owner_id) index refuses the second assignment, so three copies
-- owed to a single owner strand two rows. Pinned here because the guidance
-- depends on it -- if the ceiling ever moved, the message would be wrong again.
do $$
declare
  yost uuid;
  txn text := 'triple-quarantine-0005';
  ids uuid[];
  rejected boolean := false;
begin
  select id into yost from owners where last_name = 'Yost';

  -- Reproduce the regression window itself: between migrations 37 and 40 the
  -- unmatched pile had no dedupe at all, which is the only way this state can
  -- have arisen. Dropping the index is transactional and the enclosing rollback
  -- puts it back; the (venmo_txn_id, owner_id) index under test stays live.
  drop index payments_venmo_txn_id_unmatched_key;

  -- the 37-era regression allowed the same receipt to be quarantined N times
  insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note)
  select null, 10000, 'venmo', current_date, txn, 'quarantined copy ' || g
    from generate_series(1, 3) g;

  select array_agg(id order by created_at) into ids
    from payments where venmo_txn_id = txn;

  -- the first assignment is the designed quarantine-to-matched step
  update payments set owner_id = yost where id = ids[1];

  -- the second is refused: one row per (transaction, owner)
  begin
    update payments set owner_id = yost where id = ids[2];
  exception when unique_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'a second copy was matched to the same owner';
  end if;

  -- so a residue is left that the preflight still counts, and a correction row
  -- does not reduce it -- corrects_payment_id is set on the correction, while
  -- the original it reverses stays a non-correction row inside the predicate
  insert into payments (owner_id, amount_cents, method, paid_on, corrects_payment_id, note)
  values (null, -10000, 'correction', current_date, ids[2], 'not real money');

  if (select count(*) from payments
       where venmo_txn_id = txn and owner_id is null
         and corrects_payment_id is null) <> 2 then
    raise exception 'expected two stranded unmatched rows after the ceiling is hit';
  end if;

  delete from payments where corrects_payment_id = any(ids);
  delete from payments where venmo_txn_id = txn;

  -- close the regression window again so later blocks see the real schema
  create unique index payments_venmo_txn_id_unmatched_key
    on payments (venmo_txn_id)
    where corrects_payment_id is null
      and venmo_txn_id is not null
      and owner_id is null;
end $$;

-- An owner whose id happens to be the nil uuid must not share a dedupe bucket
-- with the unmatched pile. The earlier coalesce sentinel folded the two
-- together; two partial indexes keep them apart by construction.
do $$
declare
  nil_owner uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  txn text := 'nil-uuid-owner-0004';
  rejected boolean := false;
begin
  insert into owners (id, first_name, last_name, participation_status)
  values (nil_owner, 'Nil', 'Sentinel', 'confirmed');

  -- quarantined row for this txn
  insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note)
  values (null, 3000, 'venmo', current_date, txn, 'unmatched');

  -- a real payment for the nil-uuid owner, same txn: a DIFFERENT bucket, so it
  -- must be accepted. Under the sentinel index it collided with the row above.
  insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note)
  values (nil_owner, 3000, 'venmo', current_date, txn, 'matched to nil-uuid owner');

  if (select count(*) from payments where venmo_txn_id = txn) <> 2 then
    raise exception 'the nil-uuid owner was deduped against the unmatched pile';
  end if;

  -- each bucket is still closed against itself
  begin
    insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note)
    values (nil_owner, 3000, 'venmo', current_date, txn, 'double entry');
  exception when unique_violation then rejected := true;
  end;
  if not rejected then
    raise exception 'the nil-uuid owner bucket accepted a double entry';
  end if;

  rejected := false;
  begin
    insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note)
    values (null, 3000, 'venmo', current_date, txn, 'second quarantine');
  exception when unique_violation then rejected := true;
  end;
  if not rejected then
    raise exception 'the unmatched bucket accepted a second quarantine';
  end if;

  delete from payments where venmo_txn_id = txn;
  delete from owners where id = nil_owner;
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
