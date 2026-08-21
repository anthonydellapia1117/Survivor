-- Finance: everything computed from rows, never stored.
-- NOTE on spec section 9's headline: the per-owner Due column (the ground
-- truth, each row following the locked tier pricing) sums to $1,210, so
-- outstanding = $960. The spec's "$860 due / $1,110 pool" headline drops one
-- $100 owner — the running sum reaches $1,110 exactly one owner early. We
-- assert the computed truth; the discrepancy is reported, not encoded.

do $$
declare
  n int;
  cents bigint;
begin
  select count(*) into n from owners;
  if n <> 14 then raise exception 'expected 14 owners, got %', n; end if;

  select count(*) into n from entries;
  if n <> 47 then raise exception 'expected 47 entries, got %', n; end if;

  select count(*) into n from payments;
  if n <> 4 then raise exception 'expected 4 payments, got %', n; end if;

  -- Total collected: $250, from the ledger only.
  select sum(amount_paid_cents) into cents from v_owner_finance;
  if cents <> 25000 then raise exception 'expected 25000 collected, got %', cents; end if;

  -- Total due at tier pricing: 10 owners x $100 + 3 x $60 + 1 x $30 = $1,210.
  select sum(amount_due_cents) into cents from v_owner_finance;
  if cents <> 121000 then raise exception 'expected 121000 due, got %', cents; end if;

  -- Outstanding: $960.
  select sum(amount_due_cents - amount_paid_cents) into cents from v_owner_finance;
  if cents <> 96000 then raise exception 'expected 96000 outstanding, got %', cents; end if;
end $$;

-- Per-owner tier pricing: 4+ entries -> $25 each, 1-3 -> $30 each.
do $$
declare
  r record;
begin
  for r in
    select o.last_name, f.entry_count, f.amount_due_cents, f.amount_paid_cents
    from v_owner_finance f join owners o on o.id = f.owner_id
  loop
    if r.entry_count >= 4 and r.amount_due_cents <> r.entry_count * 2500 then
      raise exception '% should owe % at $25 tier, got %', r.last_name, r.entry_count * 2500, r.amount_due_cents;
    end if;
    if r.entry_count < 4 and r.amount_due_cents <> r.entry_count * 3000 then
      raise exception '% should owe % at $30 tier, got %', r.last_name, r.entry_count * 3000, r.amount_due_cents;
    end if;
  end loop;

  -- Spot-check the four paid owners against section 9.
  if (select amount_paid_cents from v_owner_finance f join owners o on o.id=f.owner_id where o.last_name='DiCicco') <> 10000 then
    raise exception 'DiCicco paid should be 10000';
  end if;
  if (select amount_paid_cents from v_owner_finance f join owners o on o.id=f.owner_id where o.last_name='Yost') <> 6000 then
    raise exception 'Yost paid should be 6000';
  end if;
  if (select amount_paid_cents from v_owner_finance f join owners o on o.id=f.owner_id where o.last_name='Flaherty') <> 3000 then
    raise exception 'Flaherty paid should be 3000';
  end if;
  if (select amount_paid_cents from v_owner_finance f join owners o on o.id=f.owner_id where o.last_name='Massimino') <> 6000 then
    raise exception 'Massimino paid should be 6000';
  end if;
end $$;

-- Regression guard for the old system's core failure: no derived-money column
-- may exist on owners or entries. Totals live only in views.
do $$
declare
  n int;
begin
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('owners','entries')
    and (column_name ~ 'amount|paid|balance|due|total|wins|losses|lives|status_derived');
  if n <> 0 then
    raise exception 'derived column found on owners/entries: totals must be computed, never stored';
  end if;
end $$;

-- Names are verbatim: tommybrads2 stays lowercase, mixed case round-trips.
do $$
declare
  nm text;
begin
  select entry_name into nm from entries where lower(entry_name) = 'tommybrads2';
  if nm is distinct from 'tommybrads2' then
    raise exception 'tommybrads2 was altered on write: %', nm;
  end if;
  select entry_name into nm from entries where lower(entry_name) = 'tommybrads1';
  if nm is distinct from 'Tommybrads1' then
    raise exception 'Tommybrads1 was altered on write: %', nm;
  end if;
  if (select count(*) from entries where entry_name like 'Nick&Kels %') <> 4 then
    raise exception 'Nick&Kels entries lost their ampersand';
  end if;
end $$;

-- Default-named entries are marked as such.
do $$
begin
  if (select count(*) from entries where name_is_default) <> 12 then
    raise exception 'expected 12 default-named entries (Vassallo, Penna, Lawrence x4)';
  end if;
end $$;
