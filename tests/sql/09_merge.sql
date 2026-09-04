-- Part H: merge-never-delete, append-only payment moves, and the
-- verbatim-name + apostrophe guarantees.

-- Merge of 2+2 entries flips the tier: $30/entry apart, $25/entry together.
-- Paid total is preserved through reversal+repost, names stay verbatim.
begin;
do $$
declare
  a uuid; b uuid;
  fin record;
  res jsonb;
begin
  select admin_create_owner('Merge','Alpha','a@x.com','','email','',
         array['Alpha 1','Alpha 2'], false, 'test') into a;
  select admin_create_owner('Merge','Beta','b@x.com','','email','',
         array['thedrick''s picks','Beta 2'], false, 'test') into b;

  perform admin_record_payment(a, 6000, 'venmo', current_date, 'TXN-MERGE-A', '', null, 'test');
  perform admin_record_payment(b, 6000, 'venmo', current_date, 'TXN-MERGE-B', '', null, 'test');

  select * into fin from v_owner_finance where owner_id = a;
  if fin.amount_due_cents <> 6000 then
    raise exception '2 entries should owe $60 at tier 1-3, got %', fin.amount_due_cents;
  end if;

  select admin_merge_owner(b, a, 'test') into res;

  -- Target now holds 4 entries at $25 → $100 due; both payments' value.
  select * into fin from v_owner_finance where owner_id = a;
  if fin.entry_count <> 4 then raise exception 'expected 4 entries after merge, got %', fin.entry_count; end if;
  if fin.amount_due_cents <> 10000 then
    raise exception 'merged 2+2 should owe $100 at $25/entry, got %', fin.amount_due_cents;
  end if;
  if fin.amount_paid_cents <> 12000 then
    raise exception 'paid total not preserved: %', fin.amount_paid_cents;
  end if;

  -- Names verbatim, apostrophe intact, on the new owner.
  if not exists (select 1 from entries where owner_id = a and entry_name = 'thedrick''s picks') then
    raise exception 'apostrophe entry name did not survive the merge';
  end if;

  -- Source is an archived shell, not a deleted row.
  if not exists (select 1 from owners where id = b and deleted_at is not null
                 and merged_into_owner_id = a) then
    raise exception 'source must be archived with merged_into set';
  end if;
  -- ...and archived shells vanish from every owner-reading view.
  if exists (select 1 from v_owner_finance where owner_id = b) then
    raise exception 'archived owner leaked into v_owner_finance';
  end if;
  if exists (select 1 from v_public_owners where id = b) then
    raise exception 'archived owner leaked into v_public_owners';
  end if;

  -- Ledger: source's payment history shows original + reversal, net zero.
  if (select coalesce(sum(amount_cents),0) from payments where owner_id = b) <> 0 then
    raise exception 'source ledger must net to zero after reversal';
  end if;
  -- Reversal and repost both reference the original and share its txn id.
  if (select count(*) from payments where venmo_txn_id = 'TXN-MERGE-B') <> 3 then
    raise exception 'expected original + reversal + repost sharing the txn id';
  end if;

  -- A genuinely NEW payment reusing that txn id is still rejected.
  begin
    perform admin_record_payment(a, 1000, 'venmo', current_date, 'TXN-MERGE-B', '', null, 'test');
    raise exception 'duplicate inbound txn id was accepted';
  exception when unique_violation then null;
  end;

  -- Merging an owner that has absorbed a merge is blocked.
  begin
    perform admin_merge_owner(a, (select admin_create_owner('T','T','','','email','',null,false,'test')), 'test');
    raise exception 'merge of a prior merge target was allowed';
  exception when others then
    if sqlerrm not like '%absorbed%' then raise; end if;
  end;
end $$;
rollback;

-- Delete: only the empty-typo case succeeds.
begin;
do $$
declare
  empty_o uuid; full_o uuid;
begin
  select admin_create_owner('Typo','Case','','','email','',null,false,'test') into empty_o;
  select admin_create_owner('Has','Stuff','','','email','',array['HS 1'],false,'test') into full_o;

  perform admin_delete_owner(empty_o, 'test');
  if exists (select 1 from owners where id = empty_o) then
    raise exception 'empty owner not deleted';
  end if;

  begin
    perform admin_delete_owner(full_o, 'test');
    raise exception 'owner with entries was deleted';
  exception when others then
    if sqlerrm not like '%merge instead%' then raise; end if;
  end;
end $$;
rollback;

-- Merging two empty duplicates = hard delete of the source with audit.
begin;
do $$
declare
  a uuid; b uuid; res jsonb;
begin
  select admin_create_owner('Dup','One','x@y.com','','email','',null,false,'test') into a;
  select admin_create_owner('Dup','Two','','','email','',null,false,'test') into b;
  select admin_merge_owner(b, a, 'test') into res;
  if not (res->>'deleted')::boolean then raise exception 'empty merge should hard-delete'; end if;
  if exists (select 1 from owners where id = b) then raise exception 'empty source should be gone'; end if;
  if not exists (select 1 from audit_log where action = 'merge_owner' and target_id = b::text) then
    raise exception 'merge delete must be audited';
  end if;
end $$;
rollback;

-- lynne_number: unique when present, freely null.
begin;
do $$
declare
  o uuid; e1 uuid; e2 uuid;
begin
  select admin_create_owner('Lynne','Num','','','email','',array['LN 1','LN 2'],false,'test') into o;
  select id into e1 from entries where owner_id = o and entry_index = 1;
  select id into e2 from entries where owner_id = o and entry_index = 2;
  perform admin_update_entry(e1, 'LN 1', '', null, 977, null, null, 'test');
  begin
    perform admin_update_entry(e2, 'LN 2', '', null, 977, null, null, 'test');
    raise exception 'duplicate lynne_number accepted';
  exception when unique_violation then null;
  end;
  perform admin_update_entry(e2, 'LN 2', '', null, null, null, null, 'test');
end $$;
rollback;
