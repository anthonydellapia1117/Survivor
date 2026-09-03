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

-- ---------------------------------------------------------------------------
-- ENTRY NUMBERING CONVENTION: "Name N" -> "Name #N" for multi-entry owners.
-- Only the separator moves. Single-entry owners, unnumbered names, and names
-- already in #-form are untouched, and the flags that drive other workflows
-- (name_is_default, submitted_as_name) must survive.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_multi uuid;
  v_solo uuid;
  v_words uuid;
  r record;
  res jsonb;
  n int;
begin
  -- Multi-entry owner, default-named and already sent to Lynne.
  v_multi := admin_create_owner('Numb', 'Ering', 'numbering@example.com', null,
                                'email', null,
                                array['Numb Ering 1','Numb Ering 2'], true, 'test');
  -- Single-entry owner: keeps its bare name.
  v_solo := admin_create_owner('Solo', 'Player', 'solo@example.com', null,
                               'email', null, array['Solo Player'], true, 'test');
  -- Multi-entry owner whose names carry no trailing number.
  v_words := admin_create_owner('Word', 'Names', 'words@example.com', null,
                                'email', null,
                                array['Philly Poultry','E.A.T.'], false, 'test');
  perform admin_mark_new_entries_sent('test');

  res := admin_normalize_entry_numbering('test', 'Anthony normalization');
  -- The RPC is roster-wide, so the seeded entries are renamed too; assert on
  -- this fixture's own rows rather than a global count.
  n := (res->>'renamed')::int;
  if n < 2 then raise exception 'expected at least this owner''s 2 renames, got %', n; end if;
  if (select count(*) from jsonb_array_elements(res->'mapping') m
       where m->>'from' like 'Numb Ering%') <> 2 then
    raise exception 'the fixture owner''s 2 renames are missing from the mapping';
  end if;

  -- The separator changed and NOTHING else did.
  select entry_name, name_is_default, submitted_as_name into r
    from entries where id in (select id from entries where entry_name = 'Numb Ering #1');
  if r.entry_name <> 'Numb Ering #1' then
    raise exception 'separator not applied, got %', r.entry_name;
  end if;
  if not r.name_is_default then
    raise exception 'name_is_default must survive a separator change';
  end if;
  if r.submitted_as_name <> 'Numb Ering 1' then
    raise exception 'the name Lynne holds must be preserved, got %', r.submitted_as_name;
  end if;

  -- ...which puts it in the rename-pending state on its own.
  select count(*) into n from entries
   where submitted_to_lynne_at is not null and voided_at is null
     and submitted_as_name is distinct from entry_name
     and entry_name like 'Numb Ering%';
  if n <> 2 then raise exception 'expected 2 rename-pending, got %', n; end if;

  -- Untouched: single-entry owner, and multi-entry names with no number.
  if not exists (select 1 from entries where entry_name = 'Solo Player') then
    raise exception 'a single-entry owner must keep its bare name';
  end if;
  if not exists (select 1 from entries where entry_name = 'Philly Poultry')
     or not exists (select 1 from entries where entry_name = 'E.A.T.') then
    raise exception 'names without a trailing number must be left alone';
  end if;

  -- Idempotent: a second run finds nothing and writes no audit row.
  select count(*) into n from audit_log where action = 'normalize_entry_numbering';
  res := admin_normalize_entry_numbering('test', 'again');
  if (res->>'renamed')::int <> 0 then
    raise exception 'second run renamed % rows', (res->>'renamed')::int;
  end if;
  if (select count(*) from audit_log where action = 'normalize_entry_numbering') <> n then
    raise exception 'no-op run wrote an audit row';
  end if;

  -- The audit row carries the full old -> new mapping Lynne has to be sent.
  select after into res from audit_log
   where action = 'normalize_entry_numbering' order by id desc limit 1;
  if jsonb_array_length(res->'mapping') < 2 then
    raise exception 'mapping not recorded in the audit row';
  end if;
  if res->'mapping'->0->>'from' is null or res->'mapping'->0->>'to' is null then
    raise exception 'mapping rows must carry both names';
  end if;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- SINGLE -> MULTI: a solo owner's bare default name becomes "#1" once they
-- hold more than one entry, WITHOUT clearing name_is_default (the name is
-- still app-generated) and without touching owner-supplied bare names.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_solo uuid;
  v_words uuid;
  r record;
  res jsonb;
begin
  -- Solo owner, app-default name = exactly the owner's full name.
  v_solo := admin_create_owner('Solo', 'Grower', 'grower@example.com', null,
                               'email', null, array['Solo Grower'], true, 'test');
  -- Multi-entry owner whose bare names are HIS, not the app's.
  v_words := admin_create_owner('Word', 'Owner', 'wordowner@example.com', null,
                                'email', null, array['Philly Poultry','E.A.T.'], false, 'test');

  -- While solo, the bare name is correct and must not be numbered.
  res := admin_normalize_entry_numbering('test', 'while solo');
  if exists (select 1 from entries where entry_name = 'Solo Grower #1') then
    raise exception 'a single-entry owner must keep its bare name';
  end if;

  -- He buys three more; the top-up is numbered from #2 by the app.
  perform admin_add_entries(v_solo,
    array['Solo Grower #2','Solo Grower #3','Solo Grower #4'], true, false, 'test');

  res := admin_normalize_entry_numbering('test', 'after growing');
  select entry_name, name_is_default into r
    from entries where id in (select id from entries where entry_name = 'Solo Grower #1');
  if r.entry_name <> 'Solo Grower #1' then
    raise exception 'bare default name was not numbered on growing past one';
  end if;
  if not r.name_is_default then
    raise exception 'numbering a default name must NOT clear name_is_default';
  end if;
  if exists (select 1 from entries where entry_name = 'Solo Grower') then
    raise exception 'the un-numbered duplicate survived';
  end if;

  -- Owner-supplied bare names on a multi-entry owner stay untouched forever.
  if not exists (select 1 from entries where entry_name = 'Philly Poultry')
     or not exists (select 1 from entries where entry_name = 'E.A.T.') then
    raise exception 'owner-supplied bare names must never be numbered';
  end if;
  if exists (select 1 from entries where entry_name like 'Philly Poultry #%') then
    raise exception 'the app invented a number for an owner-supplied name';
  end if;

  -- Idempotent across both cases.
  res := admin_normalize_entry_numbering('test', 'again');
  if (res->>'renamed')::int <> 0 then
    raise exception 'second run renamed % rows', (res->>'renamed')::int;
  end if;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- OWNER IDENTITY CORRECTED: default-named entries are derived from the owner
-- name, so they re-derive — keeping name_is_default, leaving owner-named
-- entries and free entries alone, and leaving Lynne's copy of the name intact
-- so her correction is one hop to the final name, not two stacked renames.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_wrong uuid;
  v_mixed uuid;
  r record;
  res jsonb;
  n int;
begin
  -- Four default-named entries, already sent to Lynne under the old name.
  v_wrong := admin_create_owner('Wrong', 'Person', 'wrong@example.com', null,
                                'email', null,
                                array['Wrong Person #1','Wrong Person #2',
                                      'Wrong Person #3','Wrong Person #4'],
                                true, 'test');
  perform admin_mark_new_entries_sent('test');

  -- The identity was wrong; correct it.
  perform admin_update_owner(v_wrong, 'Right', 'Person', 'right@example.com',
                             null, 'confirmed', 'my error', 'test');
  res := admin_resync_default_entry_names(v_wrong, 'test', 'identity corrected');
  if (res->>'renamed')::int <> 4 then
    raise exception 'expected 4 re-derived, got %', res->>'renamed';
  end if;

  select entry_name, name_is_default, submitted_as_name into r
    from entries where owner_id = v_wrong and entry_index = 1;
  if r.entry_name <> 'Right Person #1' then
    raise exception 'entry not re-derived, got %', r.entry_name;
  end if;
  if not r.name_is_default then
    raise exception 're-deriving a default name must NOT clear name_is_default';
  end if;
  -- THE POINT: Lynne still holds the ORIGINAL, so her correction is one hop.
  if r.submitted_as_name <> 'Wrong Person #1' then
    raise exception 'the name Lynne holds must survive, got %', r.submitted_as_name;
  end if;

  -- Idempotent.
  res := admin_resync_default_entry_names(v_wrong, 'test', 'again');
  if (res->>'renamed')::int <> 0 then
    raise exception 'second run renamed % rows', res->>'renamed';
  end if;

  -- A mixed owner: only the default-named entry moves, and it keeps its slot.
  v_mixed := admin_create_owner('Mixed', 'Case', 'mixed@example.com', null,
                                'email', null, array['His Own Name'], false, 'test');
  perform admin_add_entries(v_mixed, array['Mixed Case #2'], true, false, 'test');
  perform admin_update_owner(v_mixed, 'Renamed', 'Case', 'mixed@example.com',
                             null, 'confirmed', null, 'test');
  res := admin_resync_default_entry_names(v_mixed, 'test', 'mixed owner');
  if (res->>'renamed')::int <> 1 then
    raise exception 'expected only the default entry to move, got %', res->>'renamed';
  end if;
  if not exists (select 1 from entries where owner_id = v_mixed
                   and entry_name = 'His Own Name') then
    raise exception 'an owner-supplied name was re-derived';
  end if;
  if not exists (select 1 from entries where owner_id = v_mixed
                   and entry_name = 'Renamed Case #2') then
    raise exception 'the default entry did not keep its position';
  end if;

  -- Free entries are the runner's own series and must never be re-derived.
  select count(*) into n from entries e
    join owners o on o.id = e.owner_id
   where e.is_free_entry and e.entry_name not like 'AAA%';
  if n <> 0 then raise exception 'a free entry was renamed off the AAA series'; end if;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- admin_resync_default_entry_names: owner names that are blank or padded
--
-- Lynne matches entry names exactly. An owner name carrying edge whitespace
-- used to produce "Name  #1" with a doubled space, and an all-blank name a bare
-- " #1" — neither caught by the old NULL check, which could not fire anyway
-- because both name columns are NOT NULL.
-- ---------------------------------------------------------------------------
begin;
select set_config('request.jwt.claims', '{"role":"admin","email":"test"}', true);

do $$
declare
  v_pad uuid;
  v_blank uuid;
  res jsonb;
  v_name text;
begin
  -- Edge whitespace is trimmed out of the generated name, not carried into it.
  v_pad := admin_create_owner('Ernie', 'DellaPia Jr.', 'pad@example.com', null,
                              'email', null, array['x #1', 'x #2'], false, 'test');
  update entries set name_is_default = true where owner_id = v_pad;
  update owners set last_name = 'DellaPia Jr. ' where id = v_pad;

  res := admin_resync_default_entry_names(v_pad, 'test', 'padded name');
  if (res->>'renamed')::int <> 2 then
    raise exception 'expected 2 re-derived, got %', res->>'renamed';
  end if;

  select entry_name into v_name
    from entries where owner_id = v_pad and entry_index = 1;
  if v_name <> 'Ernie DellaPia Jr. #1' then
    raise exception 'padded owner name leaked into the entry name: %',
      quote_literal(v_name);
  end if;
  if v_name ~ '  ' then
    raise exception 'doubled space in generated entry name: %', quote_literal(v_name);
  end if;

  -- The owners row itself is left exactly as stored — names are verbatim.
  select last_name into v_name from owners where id = v_pad;
  if v_name <> 'DellaPia Jr. ' then
    raise exception 'the resync rewrote the owner name to %', quote_literal(v_name);
  end if;

  -- A name with nothing left after trimming is refused outright, never minted
  -- as " #1".
  v_blank := admin_create_owner('Temp', 'Owner', 'blank@example.com', null,
                                'email', null, array['y #1'], false, 'test');
  update entries set name_is_default = true where owner_id = v_blank;
  update owners set first_name = ' ', last_name = '' where id = v_blank;

  begin
    res := admin_resync_default_entry_names(v_blank, 'test', 'blank name');
    raise exception 'a blank owner name was allowed to generate entry names';
  exception when others then
    if sqlerrm like '%has no usable name%' then
      null;  -- expected
    elsif sqlerrm like '%was allowed to generate%' then
      raise;
    else
      raise exception 'wrong error for a blank owner name: %', sqlerrm;
    end if;
  end;

  -- Nothing was written on the refused call.
  select entry_name into v_name from entries where owner_id = v_blank;
  if v_name <> 'y #1' then
    raise exception 'refused call still rewrote the entry to %', quote_literal(v_name);
  end if;

  -- A genuinely absent owner still reports as not found, not as a name problem.
  begin
    res := admin_resync_default_entry_names(
             '00000000-0000-0000-0000-000000000000'::uuid, 'test', 'missing');
    raise exception 'a missing owner did not raise';
  exception when others then
    if sqlerrm not like '%not found%' then
      raise exception 'missing owner reported as %', sqlerrm;
    end if;
  end;
end $$;

rollback;


-- ---------------------------------------------------------------------------
-- admin_mark_resent_as_new: a substitution communicated as delete + re-add
--
-- Lynne can be told "delete these rows, add these" instead of "rename these".
-- She then holds brand new rows, so both the name she holds AND the date she
-- received them have to move — the rename sweep only moves the name, leaving
-- the app claiming she got the entry on the day the OLD name went out.
-- ---------------------------------------------------------------------------
begin;
select set_config('request.jwt.claims', '{"role":"admin","email":"test"}', true);

do $$
declare
  v_owner uuid;
  v_other uuid;
  v_ids uuid[];
  v_void uuid;
  v_unsent uuid;
  res jsonb;
  r record;
  n int;
  v_old_sent timestamptz;
begin
  v_owner := admin_create_owner('Wrong', 'Person', 'sub@example.com', null,
                                'email', null,
                                array['Wrong Person 1', 'Wrong Person 2'], false, 'test');
  -- She received them under the original name.
  perform admin_mark_new_entries_sent('test');
  update entries set submitted_to_lynne_at = now() - interval '10 days'
   where owner_id = v_owner;
  select submitted_to_lynne_at into v_old_sent
    from entries where owner_id = v_owner order by entry_index limit 1;

  -- The identity was wrong; the entries are renamed locally.
  perform admin_update_owner(v_owner, 'Right', 'Person', 'sub@example.com',
                             null, 'confirmed', 'my error', 'test');
  update entries set entry_name = 'Right Person #' || entry_index
   where owner_id = v_owner;

  -- An untouched owner, to prove the call does not sweep.
  v_other := admin_create_owner('Other', 'Owner', 'other@example.com', null,
                                'email', null, array['Other Owner 1'], false, 'test');
  perform admin_mark_new_entries_sent('test');
  update entries set entry_name = 'Other Owner #1' where owner_id = v_other;

  select array_agg(id) into v_ids from entries where owner_id = v_owner;
  res := admin_mark_resent_as_new(v_ids, 'test',
           'sent to Lynne as delete Wrong Person 1-2, add Right Person #1-#2');

  if (res->>'resent')::int <> 2 then
    raise exception 'expected 2 re-sent, got %', res->>'resent';
  end if;

  -- Both fields moved: the name she now holds, and when she got it.
  for r in select entry_name, submitted_as_name, submitted_to_lynne_at
             from entries where owner_id = v_owner loop
    if r.submitted_as_name <> r.entry_name then
      raise exception 'name Lynne holds not updated: % vs %',
        r.submitted_as_name, r.entry_name;
    end if;
    if r.submitted_to_lynne_at <= v_old_sent then
      raise exception 'submitted_to_lynne_at still reads the old send date';
    end if;
  end loop;

  -- They now sit in NO drift bucket: not new, not renamed, not removed.
  select count(*) into n from entries
   where owner_id = v_owner
     and (submitted_to_lynne_at is null
          or submitted_as_name is distinct from entry_name);
  if n <> 0 then raise exception '% entries still flagged as drift', n; end if;

  -- The name she was holding is preserved in the audit row, since this write is
  -- what makes it untrue everywhere else.
  select count(*) into n from audit_log
   where action = 'mark_resent_as_new'
     and after->'mapping' @> '[{"lynne_held": "Wrong Person 1"}]'::jsonb
     and after->'mapping' @> '[{"lynne_held": "Wrong Person 2"}]'::jsonb;
  if n <> 1 then
    raise exception 'the outgoing name Lynne held was not recorded in the audit';
  end if;

  -- The other owner was untouched — explicit ids, never a sweep.
  if exists (select 1 from entries where owner_id = v_other
               and submitted_as_name = entry_name) then
    raise exception 'an entry outside the given ids was updated';
  end if;

  -- A voided entry is a removal, not a re-send.
  v_owner := admin_create_owner('Gone', 'Away', 'gone@example.com', null,
                                'email', null, array['Gone Away 1'], false, 'test');
  perform admin_mark_new_entries_sent('test');
  select id into v_void from entries where owner_id = v_owner;
  perform admin_void_entry(v_void, 'test');
  begin
    res := admin_mark_resent_as_new(array[v_void], 'test', 'should fail');
    raise exception 'a voided entry was accepted as a re-send';
  exception when others then
    if sqlerrm not like '%is voided%' then raise; end if;
  end;

  -- An entry she never had cannot have been deleted and re-added.
  v_owner := admin_create_owner('Brand', 'New', 'brand@example.com', null,
                                'email', null, array['Brand New 1'], false, 'test');
  select id into v_unsent from entries where owner_id = v_owner;
  begin
    res := admin_mark_resent_as_new(array[v_unsent], 'test', 'should fail');
    raise exception 'a never-sent entry was accepted as a re-send';
  exception when others then
    if sqlerrm not like '%never sent%' then raise; end if;
  end;

  -- An unknown id fails the whole call rather than applying the rest.
  begin
    res := admin_mark_resent_as_new(
             v_ids || '00000000-0000-0000-0000-000000000000'::uuid,
             'test', 'should fail');
    raise exception 'an unknown id was accepted';
  exception when others then
    if sqlerrm not like '%not found%' then raise; end if;
  end;
end $$;

rollback;
