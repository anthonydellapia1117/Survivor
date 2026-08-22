-- Admin RPCs: transactional writes with audit, supersession, void semantics.
-- All mutations roll back.

begin;

do $$
declare
  v_owner uuid;
  v_entry uuid;
  v_entry2 uuid;
  v_pick1 uuid;
  v_pick2 uuid;
  n int;
  audits_before int;
  r record;
begin
  select count(*) into audits_before from audit_log;

  -- create_owner with entries writes data + audit together.
  v_owner := admin_create_owner('Test', 'Person', 'x@example.com', null, 'text', null,
                                array['TP 1','TP 2'], true, 'test');
  select count(*) into n from entries where owner_id = v_owner;
  if n <> 2 then raise exception 'expected 2 entries created, got %', n; end if;
  select count(*) into n from audit_log where action = 'create_owner' and target_id = v_owner::text;
  if n <> 1 then raise exception 'create_owner audit row missing'; end if;

  select id into v_entry from entries where owner_id = v_owner and entry_index = 1;
  select id into v_entry2 from entries where owner_id = v_owner and entry_index = 2;

  -- Verbatim rename.
  perform admin_update_entry(v_entry, 'wEiRd cAsE 7', 'Lynne Calls It This', null, 'test');
  if (select entry_name from entries where id = v_entry) <> 'wEiRd cAsE 7' then
    raise exception 'rename altered the name';
  end if;

  -- submit_pick then override -> supersession, never an edit.
  v_pick1 := admin_submit_pick(v_entry, 1, 'KC', 'admin', 'test');
  v_pick2 := admin_submit_pick(v_entry, 1, 'BUF', 'override', 'test');
  if (select count(*) from picks where entry_id = v_entry and week = 1) <> 2 then
    raise exception 'override should add a row, not replace';
  end if;
  if (select team from picks where id = v_pick1) <> 'KC' then
    raise exception 'original pick row was edited';
  end if;
  if (select is_current from picks where id = v_pick1) then
    raise exception 'superseded pick still current';
  end if;
  select * into r from picks where id = v_pick2;
  if not r.is_current or r.supersedes_id is distinct from v_pick1 or r.team <> 'BUF' then
    raise exception 'supersession chain broken';
  end if;
  -- Submitted before the (future) week 1 deadline: not late.
  if r.late then raise exception 'pick wrongly marked late'; end if;

  -- SKIP_WEEK pick lands as result=bye.
  perform admin_submit_pick(v_entry, 8, 'SKIP_WEEK', 'admin', 'test');
  if (select result from picks where entry_id = v_entry and week = 8 and is_current) <> 'bye' then
    raise exception 'SKIP_WEEK should record result bye';
  end if;

  -- Late pick: past deadline week (late derives from pick_deadline, which
  -- reads the window columns).
  update weeks set early_deadline_at = now() - interval '1 hour',
                   late_deadline_at = now() - interval '1 hour',
                   deadline_at = now() - interval '1 hour'
   where week = 2;
  perform admin_submit_pick(v_entry, 2, 'SF', 'admin', 'test');
  if not (select late from picks where entry_id = v_entry and week = 2 and is_current) then
    raise exception 'pick past deadline should be late';
  end if;

  -- set_result changes result only.
  perform admin_set_result(v_entry, 1, 'win', 'manual', 'test');
  select * into r from picks where id = v_pick2;
  if r.result <> 'win' or r.team <> 'BUF' then
    raise exception 'set_result must change only the result';
  end if;

  -- Entry with picks cannot be removed...
  begin
    perform admin_remove_entry(v_entry, 'test');
    raise exception 'remove of picked entry should fail';
  exception when others then
    if sqlerrm not like '%void%' then raise; end if;
  end;
  -- ...but can be voided, and voiding removes it from finance + public views.
  select amount_due_cents into n from v_owner_finance where owner_id = v_owner;
  perform admin_void_entry(v_entry, 'test');
  if exists (select 1 from v_entry_public where id = v_entry) then
    raise exception 'voided entry still public';
  end if;
  if (select amount_due_cents from v_owner_finance where owner_id = v_owner) >= n then
    raise exception 'voided entry still billed';
  end if;

  -- Pickless entry removes cleanly.
  perform admin_remove_entry(v_entry2, 'test');
  if exists (select 1 from entries where id = v_entry2) then
    raise exception 'entry not removed';
  end if;

  -- record_payment writes ledger + audit; duplicate venmo id still rejected.
  perform admin_record_payment(v_owner, 5000, 'venmo', current_date, 'RPC-TEST-1', null, null, 'test');
  begin
    perform admin_record_payment(v_owner, 5000, 'venmo', current_date, 'RPC-TEST-1', null, null, 'test');
    raise exception 'duplicate venmo txn accepted through RPC';
  exception when unique_violation then
    null;
  end;

  -- participation change is audited with before/after.
  perform admin_update_owner(v_owner, 'Test', 'Person', 'x@example.com', null, 'declined', null, 'test');
  select count(*) into n from audit_log
   where action = 'update_owner' and target_id = v_owner::text
     and before ->> 'participation_status' = 'confirmed'
     and after ->> 'participation_status' = 'declined';
  if n <> 1 then raise exception 'status change not audited with before/after'; end if;

  -- Every write above produced audit rows.
  select count(*) into n from audit_log;
  if n - audits_before < 10 then
    raise exception 'expected >= 10 audit rows, got %', n - audits_before;
  end if;
end $$;

rollback;
