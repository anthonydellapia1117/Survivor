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

-- ---------------------------------------------------------------------------
-- admin_mark_roster_sent: stamps only unsent, non-voided entries; audited;
-- idempotent second call is a zero no-op with no audit row.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_owner uuid;
  n int;
  audits_before int;
begin
  select count(*) into audits_before from audit_log where action = 'mark_new_entries_sent';

  -- A fresh owner whose entries have never been sent.
  v_owner := admin_create_owner('Delta', 'Test', 'delta@example.com', null,
                                'email', null, array['Delta Test 1','Delta Test 2'], true, 'test');

  select admin_mark_new_entries_sent('test') into n;
  if n < 2 then raise exception 'expected at least 2 stamped, got %', n; end if;

  if exists (select 1 from entries where voided_at is null and submitted_to_lynne_at is null) then
    raise exception 'unsent entries remain after mark_roster_sent';
  end if;

  select count(*) into n from audit_log where action = 'mark_new_entries_sent';
  if n <> audits_before + 1 then raise exception 'send not audited'; end if;

  -- Second call: nothing left to stamp, returns zero, no audit row.
  select admin_mark_new_entries_sent('test') into n;
  if n <> 0 then raise exception 'second call stamped % rows', n; end if;
  select count(*) into n from audit_log where action = 'mark_new_entries_sent';
  if n <> audits_before + 1 then raise exception 'no-op call wrote an audit row'; end if;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- Renamed after submission: the name Lynne has is kept, the difference is the
-- signal, and marking her list current re-syncs it.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_owner uuid;
  v_entry uuid;
  r record;
  n int;
begin
  v_owner := admin_create_owner('Rename', 'Case', 'rename@example.com', null,
                                'email', null, array['Rename Case 1'], true, 'test');
  perform admin_mark_new_entries_sent('test');

  select id, entry_name, submitted_as_name into r
    from entries where entry_name = 'Rename Case 1';
  if r.submitted_as_name <> 'Rename Case 1' then
    raise exception 'submitted name not recorded on send: %', r.submitted_as_name;
  end if;
  v_entry := r.id;

  -- Rename it: the entry's own name moves, the recorded one does NOT.
  perform admin_update_entry(v_entry, 'Real Name 1', null, null, null, 'test');
  select entry_name, submitted_as_name, name_is_default into r
    from entries where id = v_entry;
  if r.entry_name <> 'Real Name 1' then raise exception 'rename did not apply'; end if;
  if r.submitted_as_name <> 'Rename Case 1' then
    raise exception 'the name Lynne has must survive a rename, got %', r.submitted_as_name;
  end if;
  if r.name_is_default then raise exception 'rename must clear name_is_default'; end if;

  -- Telling her re-syncs it, and is counted separately from new sends.
  select admin_mark_renames_communicated('test') into n;
  if n < 1 then raise exception 'rename not counted as reconciled, got %', n; end if;
  select entry_name, submitted_as_name into r from entries where id = v_entry;
  if r.submitted_as_name <> r.entry_name then
    raise exception 'reconcile did not re-record the name';
  end if;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- THE SPLIT: the two stamps are independent. Marking renames as communicated
-- must never sweep in an entry Lynne has not been sent — the exact failure
-- that made a real, acknowledged rename impossible to clear.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_sent_owner uuid;
  v_new_owner uuid;
  v_sent_entry uuid;
  r record;
  n int;
begin
  -- One entry she HAS (and we then rename), one she has never seen.
  v_sent_owner := admin_create_owner('Told', 'Her', 'told@example.com', null,
                                     'email', null, array['Told Her 1'], true, 'test');
  perform admin_mark_new_entries_sent('test');
  select id into v_sent_entry from entries where entry_name = 'Told Her 1';
  perform admin_update_entry(v_sent_entry, 'Told Her Renamed', null, null, null, 'test');

  v_new_owner := admin_create_owner('Not', 'Yet', 'notyet@example.com', null,
                                    'email', null, array['Not Yet 1'], true, 'test');

  -- Marking the rename communicated must leave the never-sent entry alone.
  select admin_mark_renames_communicated('test') into n;
  if n <> 1 then raise exception 'expected exactly 1 rename reconciled, got %', n; end if;

  select submitted_to_lynne_at, submitted_as_name into r
    from entries where entry_name = 'Not Yet 1';
  if r.submitted_to_lynne_at is not null or r.submitted_as_name is not null then
    raise exception 'communicating a rename falsely stamped an unsent entry as sent';
  end if;

  select submitted_as_name into r from entries where id = v_sent_entry;
  if r.submitted_as_name <> 'Told Her Renamed' then
    raise exception 'rename was not reconciled';
  end if;

  -- And the reverse: sending new entries must not silently reconcile a
  -- rename the runner has NOT yet told her about.
  perform admin_update_entry(v_sent_entry, 'Told Her Renamed Again', null, null, null, 'test');
  select admin_mark_new_entries_sent('test') into n;
  if n <> 1 then raise exception 'expected exactly 1 new entry sent, got %', n; end if;

  select entry_name, submitted_as_name into r from entries where id = v_sent_entry;
  if r.submitted_as_name = r.entry_name then
    raise exception 'sending new entries silently cleared an uncommunicated rename';
  end if;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- REMOVED AFTER SUBMISSION: an entry Lynne has that we have voided. She keeps
-- carrying it until she is told, so the pending set is derived from voided +
-- submitted + never-communicated, and the stamp is independent of the other
-- two — the same rule the send/rename split established.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_owner uuid;
  v_gone uuid;
  v_kept uuid;
  v_unsent uuid;
  n int;
  audits_before int;
begin
  select count(*) into audits_before
    from audit_log where action = 'mark_removals_communicated';

  v_owner := admin_create_owner('Removal', 'Case', 'removal@example.com', null,
                                'email', null,
                                array['Removal Case 1','Removal Case 2'], true, 'test');
  perform admin_mark_new_entries_sent('test');

  select id into v_gone from entries where entry_name = 'Removal Case 1';
  select id into v_kept from entries where entry_name = 'Removal Case 2';

  -- An entry she has NOT been sent, voided later: nothing to tell her.
  perform admin_add_entries(v_owner, array['Never Sent 1'], true, false, 'test');
  select id into v_unsent from entries where entry_name = 'Never Sent 1';
  perform admin_void_entry(v_unsent, 'test');

  -- Voiding a submitted entry leaves the removal pending.
  perform admin_void_entry(v_gone, 'test');
  select count(*) into n from entries
   where voided_at is not null and submitted_to_lynne_at is not null
     and removal_communicated_at is null;
  if n <> 1 then raise exception 'expected exactly 1 pending removal, got %', n; end if;

  -- The never-sent void must NOT be pending — she never had it.
  if exists (select 1 from entries
              where id = v_unsent and submitted_to_lynne_at is not null) then
    raise exception 'a voided-but-unsent entry must stay unsubmitted';
  end if;

  -- Telling her stamps it, counts it, and audits it.
  select admin_mark_removals_communicated('test') into n;
  if n <> 1 then raise exception 'expected 1 removal communicated, got %', n; end if;
  if exists (select 1 from entries
              where id = v_gone and removal_communicated_at is null) then
    raise exception 'removal stamp not recorded';
  end if;
  select count(*) into n from audit_log where action = 'mark_removals_communicated';
  if n <> audits_before + 1 then raise exception 'removal not audited'; end if;

  -- Idempotent: a second call stamps nothing and writes no audit row.
  select admin_mark_removals_communicated('test') into n;
  if n <> 0 then raise exception 'second call stamped % rows', n; end if;
  select count(*) into n from audit_log where action = 'mark_removals_communicated';
  if n <> audits_before + 1 then raise exception 'no-op call wrote an audit row'; end if;

  -- INDEPENDENCE: communicating a removal must not touch the live entry's
  -- submission or name stamps.
  select count(*) into n from entries
   where id = v_kept and submitted_to_lynne_at is not null
     and submitted_as_name = 'Removal Case 2'
     and removal_communicated_at is null;
  if n <> 1 then raise exception 'a live sent entry was disturbed by the removal stamp'; end if;

  -- And the reverse: a pending removal is invisible to the other two stamps.
  perform admin_void_entry(v_kept, 'test');
  if admin_mark_new_entries_sent('test') <> 0 then
    raise exception 'mark_new_entries_sent swept in a voided entry';
  end if;
  if admin_mark_renames_communicated('test') <> 0 then
    raise exception 'mark_renames_communicated swept in a voided entry';
  end if;
  if exists (select 1 from entries
              where id = v_kept and removal_communicated_at is not null) then
    raise exception 'another action cleared a pending removal';
  end if;
end $$;

rollback;
