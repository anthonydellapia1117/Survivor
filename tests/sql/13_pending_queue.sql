-- The NEEDS ANTHONY queue (20260905000063): pending_actions and its three
-- RPCs. Everything here rolls back.
--
-- What is asserted, and why each block fails without the migration:
--   * the table exists with RLS on and no write policy;
--   * anon has no privilege on it at all, and cannot call the RPCs;
--   * a signed-in NON-admin is refused by every RPC and sees zero rows;
--   * the admin cannot write the table directly - the RPCs are the only path;
--   * stage writes the row and its audit row together, and re-staging the
--     same item while it is open is a no-op that returns the same id;
--   * approve on a payment applies it THROUGH admin_record_payment (a real
--     payments row, a record_payment audit row, the ledger one longer) and
--     resolves the row; a second approve is refused;
--   * approve on a kind with no RPC resolves the row and applies nothing;
--   * a refused application (bad payload) leaves the row open, nothing written;
--   * dismiss resolves the row and applies nothing - the picks table is
--     unchanged - and the row cannot then be approved.
--
-- Not executed on the Mac this was written on (no Postgres there); it runs
-- through scripts/db/test-db.sh like the other twelve suites.

begin;

-- ------------------------------------------------------------ shape
do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'pending_actions') then
    raise exception 'pending_actions table missing';
  end if;
  if not (select relrowsecurity from pg_class where relname = 'pending_actions') then
    raise exception 'pending_actions must have RLS enabled';
  end if;
  if exists (select 1 from pg_policies where tablename = 'pending_actions'
              and cmd <> 'SELECT') then
    raise exception 'pending_actions must have no write policy - the RPCs are the only write path';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'pending_actions'
                  and cmd = 'SELECT' and qual like '%is_admin()%') then
    raise exception 'pending_actions select policy must be gated by is_admin()';
  end if;
  if exists (select 1 from pg_proc where proname in
      ('admin_stage_pending','admin_approve_pending','admin_dismiss_pending')
      and not prosecdef) then
    raise exception 'the queue RPCs must be security definer: the table has no write policy to lean on';
  end if;
  if (select count(*) from pg_proc where proname in
      ('admin_stage_pending','admin_approve_pending','admin_dismiss_pending')) <> 3 then
    raise exception 'expected exactly three queue RPCs';
  end if;
end $$;

-- ------------------------------------------------------------ fixture
create temp table _q (k text primary key, v text);
grant select, insert on _q to anon, authenticated;

do $$
declare
  o uuid; e uuid;
begin
  select ow.id into o from owners ow where ow.first_name = 'Tim' and ow.last_name = 'Flaherty';
  select en.id into e from entries en where en.owner_id = o and en.entry_name = 'Pumpy321';
  if o is null or e is null then
    raise exception 'fixture: Tim Flaherty / Pumpy321 not in the seed roster';
  end if;
  insert into _q values ('owner', o::text), ('entry', e::text);
end $$;

-- ------------------------------------------------------------ anon: nothing
set local role anon;
do $$
declare
  o uuid := (select v from _q where k = 'owner')::uuid;
  ok boolean := false;
begin
  begin
    perform 1 from pending_actions;
    raise exception 'anon must not be able to read pending_actions at all';
  exception when insufficient_privilege then
    ok := true;
  end;
  if not ok then raise exception 'anon read was not refused'; end if;

  ok := false;
  begin
    perform admin_stage_pending('payment',
      jsonb_build_object('owner_id', o, 'amount_cents', 3000, 'paid_on', '2026-09-05'),
      'anon-msg', 'anon');
    raise exception 'anon must not be able to stage';
  exception when insufficient_privilege then
    ok := true;
  end;
  if not ok then raise exception 'anon stage was not refused'; end if;
end $$;
reset role;

-- ------------------------------------------------------------ non-admin: refused
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', true);
do $$
declare
  o uuid := (select v from _q where k = 'owner')::uuid;
  ok boolean := false;
begin
  begin
    perform admin_stage_pending('payment',
      jsonb_build_object('owner_id', o, 'amount_cents', 3000, 'paid_on', '2026-09-05'),
      'stranger-msg', 'stranger');
  exception when insufficient_privilege then
    ok := true;
  end;
  if not ok then raise exception 'non-admin must be refused by admin_stage_pending'; end if;

  ok := false;
  begin
    perform admin_approve_pending(gen_random_uuid(), null, 'stranger');
  exception when insufficient_privilege then
    ok := true;
  end;
  if not ok then raise exception 'non-admin must be refused by admin_approve_pending'; end if;

  ok := false;
  begin
    perform admin_dismiss_pending(gen_random_uuid(), null, 'stranger');
  exception when insufficient_privilege then
    ok := true;
  end;
  if not ok then raise exception 'non-admin must be refused by admin_dismiss_pending'; end if;

  -- The refusal must come BEFORE any lookup: an unknown id as a stranger is
  -- "not the admin", never "not found", so the queue leaks nothing about
  -- which ids exist.
  ok := false;
  begin
    perform admin_stage_pending('payment', '{}'::jsonb, null, 'stranger');
  exception when insufficient_privilege then
    ok := true;
  end;
  if not ok then raise exception 'stranger stage with empty payload should still be a privilege error'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ------------------------------------------------------------ admin: stage
-- is_admin() reads app.admin_email before its literal fallback, so the admin
-- here is a placeholder set for this transaction only.
select set_config('app.admin_email', 'admin@test.local', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"admin@test.local"}', true);
do $$
declare
  o uuid := (select v from _q where k = 'owner')::uuid;
  id1 uuid; id2 uuid; id3 uuid;
  n int;
  audits int;
  payload jsonb;
  ok boolean;
begin
  -- The admin cannot write the table directly. This is the property the
  -- whole design rests on: RPC or nothing.
  ok := false;
  begin
    insert into pending_actions (kind, payload) values ('payment', '{}'::jsonb);
  exception when insufficient_privilege then
    ok := true;
  end;
  if not ok then raise exception 'admin must not be able to insert pending_actions directly'; end if;

  select count(*) into audits from audit_log;

  payload := jsonb_build_object(
    'owner_id', o, 'amount_cents', 3000, 'method', 'venmo',
    'paid_on', '2026-09-05', 'venmo_txn_id', 'QUEUE-TEST-TXN-1',
    'sender', 'Tim Flaherty');
  id1 := admin_stage_pending('payment', payload, 'gmail-msg-1', 'sweep');
  if id1 is null then raise exception 'stage returned no id'; end if;

  select count(*) into n from pending_actions where id = id1 and resolved_at is null
     and kind = 'payment' and staged_by = 'sweep' and source_message_id = 'gmail-msg-1';
  if n <> 1 then raise exception 'staged row not written as expected'; end if;

  select count(*) into n from audit_log
   where action = 'stage_pending' and target_table = 'pending_actions'
     and target_id = id1::text and actor = 'sweep';
  if n <> 1 then raise exception 'stage_pending audit row missing'; end if;
  if (select count(*) from audit_log) <> audits + 1 then
    raise exception 'stage must write exactly one audit row';
  end if;

  -- Same item, same message, still open: no second row, no second audit row.
  id2 := admin_stage_pending('payment', payload, 'gmail-msg-1', 'sweep');
  if id2 <> id1 then raise exception 're-staging an open item must return the same id'; end if;
  if (select count(*) from pending_actions where kind = 'payment') <> 1 then
    raise exception 're-staging an open item must not add a row';
  end if;
  if (select count(*) from audit_log) <> audits + 1 then
    raise exception 're-staging an open item must not add an audit row';
  end if;

  -- Same message, different payload: a second row. A $200 receipt settling
  -- two owners is two payment rows from one message.
  id3 := admin_stage_pending('payment', payload || '{"amount_cents": 10000}', 'gmail-msg-1', 'sweep');
  if id3 = id1 then raise exception 'a different payload on the same message is a new row'; end if;

  -- Input guards.
  ok := false;
  begin
    perform admin_stage_pending('  ', payload, null, 'sweep');
  exception when others then
    ok := sqlerrm like '%kind is required%';
  end;
  if not ok then raise exception 'blank kind must be refused'; end if;

  ok := false;
  begin
    perform admin_stage_pending('payment', '[1,2]'::jsonb, null, 'sweep');
  exception when others then
    ok := sqlerrm like '%JSON object%';
  end;
  if not ok then raise exception 'non-object payload must be refused'; end if;

  insert into _q values ('pay1', id1::text), ('pay2', id3::text), ('pay1_payload', payload::text);
end $$;

-- ------------------------------------------------------------ admin: approve applies via the RPC
do $$
declare
  o uuid := (select v from _q where k = 'owner')::uuid;
  id1 uuid := (select v from _q where k = 'pay1')::uuid;
  ledger int;
  res jsonb;
  n int;
  ok boolean;
  pay uuid;
begin
  select count(*) into ledger from payments;

  res := admin_approve_pending(id1, 'matches Tim, one entry', 'admin@test.local');
  if not (res->>'applied')::boolean then
    raise exception 'a payment approve must apply, got %', res;
  end if;
  pay := (res->'result'->>'payment_id')::uuid;
  if pay is null then raise exception 'approve did not return the payment id'; end if;

  -- The money row exists and came through admin_record_payment: right owner,
  -- right amount, right txn, and record_payment's own audit row is there.
  select count(*) into n from payments
   where id = pay and owner_id = o and amount_cents = 3000
     and venmo_txn_id = 'QUEUE-TEST-TXN-1' and method = 'venmo' and paid_on = '2026-09-05';
  if n <> 1 then raise exception 'payment row not written through admin_record_payment'; end if;
  if (select count(*) from payments) <> ledger + 1 then
    raise exception 'ledger should be exactly one row longer';
  end if;
  if not exists (select 1 from audit_log where action = 'record_payment' and target_id = pay::text) then
    raise exception 'record_payment audit row missing - was the RPC bypassed?';
  end if;

  -- The queue row is resolved, and its own audit row names the decision.
  select count(*) into n from pending_actions
   where id = id1 and resolution = 'approved' and resolved_at is not null
     and resolved_by = 'admin@test.local'
     and resolution_note = 'matches Tim, one entry';
  if n <> 1 then raise exception 'approved row not resolved as expected'; end if;
  if not exists (select 1 from audit_log
                  where action = 'approve_pending' and target_id = id1::text
                    and (after->>'applied')::boolean
                    and after->'result'->>'payment_id' = pay::text
                    and note = 'matches Tim, one entry') then
    raise exception 'approve_pending audit row missing or incomplete';
  end if;

  -- Twice is refused.
  ok := false;
  begin
    perform admin_approve_pending(id1, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%already approved%';
  end;
  if not ok then raise exception 'approving a resolved row must be refused'; end if;
  if (select count(*) from payments) <> ledger + 1 then
    raise exception 'the refused second approve must not touch the ledger';
  end if;

  -- Resolved is still deduplicated. The sweep stages, its Gmail Done-label
  -- write fails, Anthony approves the row, and an hour later the sweep reads
  -- the same mail again: it must get the existing id back and add nothing,
  -- or the same top-up could be staged and approved twice.
  if admin_stage_pending('payment', (select v from _q where k = 'pay1_payload')::jsonb,
                         'gmail-msg-1', 'sweep') <> id1 then
    raise exception 're-staging a RESOLVED item must return the same id';
  end if;
  if (select count(*) from pending_actions where source_message_id = 'gmail-msg-1') <> 2 then
    raise exception 're-staging a resolved item must not add a row';
  end if;

  -- The dedupe the RPC carries holds for the queue too: the second row on the
  -- same message reuses the txn id against the same owner, so approving it is
  -- refused by admin_record_payment and the row stays OPEN.
  ok := false;
  begin
    perform admin_approve_pending((select v from _q where k = 'pay2')::uuid, null, 'admin@test.local');
  exception when unique_violation then
    ok := true;
  end;
  if not ok then raise exception 'a duplicate txn per owner must be refused through the RPC'; end if;
  if (select resolved_at from pending_actions where id = (select v from _q where k = 'pay2')::uuid) is not null then
    raise exception 'a refused approve must leave the row open';
  end if;
  if (select count(*) from payments) <> ledger + 1 then
    raise exception 'a refused approve must write nothing to the ledger';
  end if;
end $$;

-- ------------------------------------------------------------ admin: bad payload leaves the row open
do $$
declare
  qid uuid;
  ok boolean := false;
  ledger int;
begin
  select count(*) into ledger from payments;
  qid := admin_stage_pending('payment', '{"note": "no amount, no date"}'::jsonb, 'gmail-msg-2', 'sweep');
  begin
    perform admin_approve_pending(qid, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%amount_cents and paid_on%';
  end;
  if not ok then raise exception 'a payment without amount and date must be refused'; end if;
  if (select resolved_at from pending_actions where id = qid) is not null then
    raise exception 'a refused payload must leave the row open';
  end if;
  if (select count(*) from payments) <> ledger then
    raise exception 'a refused payload must write nothing';
  end if;
end $$;

-- ------------------------------------------------------------ admin: no RPC for the kind
do $$
declare
  qid uuid;
  owners_before int;
  res jsonb;
begin
  select count(*) into owners_before from owners;
  qid := admin_stage_pending('new_owner',
    '{"first_name": "Queue", "last_name": "Person", "email": "queue@example.com"}'::jsonb,
    'gmail-msg-3', 'sweep');
  res := admin_approve_pending(qid, 'add him on Quick add', 'admin@test.local');
  if (res->>'applied')::boolean then
    raise exception 'a kind with no RPC must not report applied';
  end if;
  if (select count(*) from owners) <> owners_before then
    raise exception 'approving new_owner must create nothing - that is Anthony''s click on Quick add';
  end if;
  if not exists (select 1 from pending_actions where id = qid and resolution = 'approved') then
    raise exception 'the decision must still be recorded';
  end if;
  if not exists (select 1 from audit_log where action = 'approve_pending'
                  and target_id = qid::text and not (after->>'applied')::boolean) then
    raise exception 'approve_pending audit row must say applied = false';
  end if;
end $$;

-- ------------------------------------------------------------ admin: dismiss applies nothing
do $$
declare
  e uuid := (select v from _q where k = 'entry')::uuid;
  qid uuid;
  picks_before int;
  ok boolean := false;
begin
  select count(*) into picks_before from picks;
  qid := admin_stage_pending('pick',
    jsonb_build_object('entry_id', e, 'entry_name', 'Pumpy321', 'week', 1, 'team', 'PHI'),
    'gmail-msg-4', 'sweep');

  perform admin_dismiss_pending(qid, 'he changed his mind in the next mail', 'admin@test.local');

  if (select count(*) from picks) <> picks_before then
    raise exception 'dismiss must not write a pick';
  end if;
  if not exists (select 1 from pending_actions
                  where id = qid and resolution = 'dismissed' and resolved_at is not null
                    and resolved_by = 'admin@test.local'
                    and resolution_note = 'he changed his mind in the next mail') then
    raise exception 'dismissed row not resolved as expected';
  end if;
  if not exists (select 1 from audit_log where action = 'dismiss_pending'
                  and target_id = qid::text and note = 'he changed his mind in the next mail') then
    raise exception 'dismiss_pending audit row missing';
  end if;

  begin
    perform admin_approve_pending(qid, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%already dismissed%';
  end;
  if not ok then raise exception 'a dismissed row must not be approvable'; end if;

  ok := false;
  begin
    perform admin_dismiss_pending(qid, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%already dismissed%';
  end;
  if not ok then raise exception 'a dismissed row must not be dismissable twice'; end if;

  -- The admin cannot reopen or edit a row by hand either.
  ok := false;
  begin
    update pending_actions set resolved_at = null, resolution = null, resolved_by = null where id = qid;
  exception when insufficient_privilege then
    ok := true;
  end;
  if not ok then raise exception 'admin must not be able to update pending_actions directly'; end if;

  -- Open rows are what the page lists: the two payment rows left open above.
  if (select count(*) from pending_actions where resolved_at is null) <> 2 then
    raise exception 'expected exactly two open rows, got %',
      (select count(*) from pending_actions where resolved_at is null);
  end if;
end $$;

-- ------------------------------------------------------------ admin: approve applies a pick via the RPC
do $$
declare
  e uuid := (select v from _q where k = 'entry')::uuid;
  qid uuid;
  id_future uuid;
  res jsonb;
  pick uuid;
  received timestamptz := '2026-09-01 16:00:00+00';
  ok boolean := false;
begin
  -- The reply arrived on Sep 1 and Anthony approves it now. The pick has to
  -- carry the arrival time and be judged late or not at THAT time, not at the
  -- approval: a reply that beat its deadline stays on time however long it
  -- waited in the queue.
  qid := admin_stage_pending('pick',
    jsonb_build_object('entry_id', e, 'week', 1, 'team', 'PHI', 'received_at', received),
    'gmail-msg-5', 'sweep');
  res := admin_approve_pending(qid, null, 'admin@test.local');
  pick := (res->'result'->>'pick_id')::uuid;
  if pick is null or not exists (select 1 from picks where id = pick and entry_id = e and week = 1 and team = 'PHI' and is_current) then
    raise exception 'pick approve must write the pick through admin_submit_pick';
  end if;
  if not exists (select 1 from picks where id = pick and submitted_at = received and late = false) then
    raise exception 'the approved pick must carry the mail''s arrival time, not the approval time';
  end if;
  if not exists (select 1 from audit_log where action = 'submit_pick' and target_id = pick::text) then
    raise exception 'submit_pick audit row missing - was the RPC bypassed?';
  end if;

  -- A received_at in the future is not a time a mail can have arrived; the
  -- approve is refused and the row stays open.
  id_future := admin_stage_pending('pick',
    jsonb_build_object('entry_id', e, 'week', 2, 'team', 'DAL', 'received_at', now() + interval '1 day'),
    'gmail-msg-6', 'sweep');
  begin
    perform admin_approve_pending(id_future, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%received_at is in the future%';
  end;
  if not ok then raise exception 'a future received_at must be refused'; end if;
  if (select resolved_at from pending_actions where id = id_future) is not null then
    raise exception 'a refused pick must leave the row open';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ------------------------------------------------------------ admin: a stale queued pick cannot roll back a newer one
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"admin@test.local"}', true);
-- The reply in the queue is older than the pick that is now current (a later
-- reply, or one Anthony keyed in). Approving it must be refused, not applied
-- over the newer choice; a newer queued reply still supersedes; and once the
-- week is scored nothing in the queue may replace the pick.
do $$
declare
  e uuid := (select v from _q where k = 'entry')::uuid;
  stale uuid; newer uuid; after_score uuid;
  res jsonb;
  ok boolean := false;
begin
  -- Current pick for week 1 is PHI, submitted 2026-09-01 16:00 (block above).
  stale := admin_stage_pending('pick',
    jsonb_build_object('entry_id', e, 'week', 1, 'team', 'DAL', 'received_at', '2026-08-31 12:00:00+00'::timestamptz),
    'gmail-msg-7', 'sweep');
  begin
    perform admin_approve_pending(stale, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%stale%';
  end;
  if not ok then raise exception 'a queued pick older than the current pick must be refused as stale'; end if;
  if (select resolved_at from pending_actions where id = stale) is not null then
    raise exception 'a refused stale pick must leave the row open';
  end if;
  if not exists (select 1 from picks where entry_id = e and week = 1 and is_current and team = 'PHI') then
    raise exception 'the refused stale pick must not touch the current pick';
  end if;

  -- A newer queued reply does supersede.
  newer := admin_stage_pending('pick',
    jsonb_build_object('entry_id', e, 'week', 1, 'team', 'DAL', 'received_at', '2026-09-02 12:00:00+00'::timestamptz),
    'gmail-msg-8', 'sweep');
  res := admin_approve_pending(newer, null, 'admin@test.local');
  if not exists (select 1 from picks where entry_id = e and week = 1 and is_current and team = 'DAL'
                   and submitted_at = '2026-09-02 12:00:00+00'::timestamptz) then
    raise exception 'a newer queued pick must supersede the current one at its own arrival time';
  end if;
  if not exists (select 1 from audit_log where action = 'override_pick'
                  and target_id = (res->'result'->>'pick_id')) then
    raise exception 'superseding through the queue must leave the override_pick audit row';
  end if;

  -- No arrival time and a pick already current: indeterminate, refused. The
  -- guard compares arrival against the current pick, and now() is not an
  -- arrival; without it an old reply would read as newer than anything.
  ok := false;
  begin
    perform admin_approve_pending(
      admin_stage_pending('pick',
        jsonb_build_object('entry_id', e, 'week', 1, 'team', 'NYJ'),
        'gmail-msg-13', 'sweep'),
      null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%received_at%';
  end;
  if not ok then raise exception 'a queued pick without received_at must be refused when a pick is already current'; end if;
  if not exists (select 1 from picks where entry_id = e and week = 1 and is_current and team = 'DAL') then
    raise exception 'the refused no-arrival pick must not touch the current pick';
  end if;

  -- Scored: nothing from the queue replaces it, however new the reply.
  perform admin_set_result(e, 1, 'win', 'manual', 'admin@test.local');
  after_score := admin_stage_pending('pick',
    jsonb_build_object('entry_id', e, 'week', 1, 'team', 'NYG', 'received_at', '2026-09-03 12:00:00+00'::timestamptz),
    'gmail-msg-9', 'sweep');
  ok := false;
  begin
    perform admin_approve_pending(after_score, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%already%';
  end;
  if not ok then raise exception 'a queued pick must not replace a scored pick'; end if;
  if (select resolved_at from pending_actions where id = after_score) is not null then
    raise exception 'a refused post-score pick must leave the row open';
  end if;
  if not exists (select 1 from picks where entry_id = e and week = 1 and is_current and team = 'DAL' and result = 'win') then
    raise exception 'the scored pick must be untouched';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ------------------------------------------------------------ admin: a row whose target moved on is refused
-- Staged against an owner that is merged away before approval, or a pick for
-- an entry voided before approval: nothing is written to the archived owner
-- or the dead entry, the row stays open, and Anthony re-stages or dismisses.
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"admin@test.local"}', true);
do $$
declare
  o uuid := (select v from _q where k = 'owner')::uuid;
  e uuid := (select v from _q where k = 'entry')::uuid;
  tgt uuid;
  pay uuid; adds uuid; pk uuid;
  ledger int; entries_before int; picks_before int;
  ok boolean;
begin
  select ow.id into tgt from owners ow
   where ow.id <> o and ow.deleted_at is null and ow.merged_into_owner_id is null
   order by ow.created_at limit 1;
  if tgt is null then raise exception 'fixture: need a second live owner'; end if;

  pay := admin_stage_pending('payment',
    jsonb_build_object('owner_id', o, 'amount_cents', 3000, 'paid_on', '2026-09-05', 'venmo_txn_id', 'QUEUE-TEST-TXN-MERGED'),
    'gmail-msg-10', 'sweep');
  adds := admin_stage_pending('entries',
    jsonb_build_object('owner_id', o, 'entry_names', jsonb_build_array('Pumpy321 #2')),
    'gmail-msg-11', 'sweep');

  perform admin_merge_owner(o, tgt, 'admin@test.local');
  if not exists (select 1 from owners where id = o and merged_into_owner_id = tgt) then
    raise exception 'fixture: merge did not archive the source owner';
  end if;

  select count(*) into ledger from payments;
  ok := false;
  begin
    perform admin_approve_pending(pay, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%merged%';
  end;
  if not ok then raise exception 'a payment staged against an owner merged since must be refused'; end if;
  if (select count(*) from payments) <> ledger then
    raise exception 'the refused payment must write nothing to the ledger';
  end if;
  if (select resolved_at from pending_actions where id = pay) is not null then
    raise exception 'the refused payment row must stay open';
  end if;

  select count(*) into entries_before from entries;
  ok := false;
  begin
    perform admin_approve_pending(adds, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%merged%';
  end;
  if not ok then raise exception 'entries staged against an owner merged since must be refused'; end if;
  if (select count(*) from entries) <> entries_before then
    raise exception 'the refused entries must add nothing';
  end if;
  if (select resolved_at from pending_actions where id = adds) is not null then
    raise exception 'the refused entries row must stay open';
  end if;

  -- The entry moved to the target in the merge and is still live; void it,
  -- then a queued pick for it is refused.
  pk := admin_stage_pending('pick',
    jsonb_build_object('entry_id', e, 'week', 3, 'team', 'BUF', 'received_at', '2026-09-04 12:00:00+00'::timestamptz),
    'gmail-msg-12', 'sweep');
  perform admin_void_entry(e, 'admin@test.local');
  select count(*) into picks_before from picks;
  ok := false;
  begin
    perform admin_approve_pending(pk, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%voided%';
  end;
  if not ok then raise exception 'a queued pick for an entry voided since must be refused'; end if;
  if (select count(*) from picks) <> picks_before then
    raise exception 'the refused pick must write nothing';
  end if;
  if (select resolved_at from pending_actions where id = pk) is not null then
    raise exception 'the refused pick row must stay open';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ------------------------------------------------------------ non-admin sees no rows
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', true);
do $$
begin
  if exists (select 1 from pending_actions) then
    raise exception 'a non-admin must see zero rows of pending_actions';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

rollback;
