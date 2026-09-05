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
grant select on _q to anon, authenticated;

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

  insert into _q values ('pay1', id1::text), ('pay2', id3::text);
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
  id uuid;
  ok boolean := false;
  ledger int;
begin
  select count(*) into ledger from payments;
  id := admin_stage_pending('payment', '{"note": "no amount, no date"}'::jsonb, 'gmail-msg-2', 'sweep');
  begin
    perform admin_approve_pending(id, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%amount_cents and paid_on%';
  end;
  if not ok then raise exception 'a payment without amount and date must be refused'; end if;
  if (select resolved_at from pending_actions where id = id) is not null then
    raise exception 'a refused payload must leave the row open';
  end if;
  if (select count(*) from payments) <> ledger then
    raise exception 'a refused payload must write nothing';
  end if;
end $$;

-- ------------------------------------------------------------ admin: no RPC for the kind
do $$
declare
  id uuid;
  owners_before int;
  res jsonb;
begin
  select count(*) into owners_before from owners;
  id := admin_stage_pending('new_owner',
    '{"first_name": "Queue", "last_name": "Person", "email": "queue@example.com"}'::jsonb,
    'gmail-msg-3', 'sweep');
  res := admin_approve_pending(id, 'add him on Quick add', 'admin@test.local');
  if (res->>'applied')::boolean then
    raise exception 'a kind with no RPC must not report applied';
  end if;
  if (select count(*) from owners) <> owners_before then
    raise exception 'approving new_owner must create nothing - that is Anthony''s click on Quick add';
  end if;
  if not exists (select 1 from pending_actions where id = id and resolution = 'approved') then
    raise exception 'the decision must still be recorded';
  end if;
  if not exists (select 1 from audit_log where action = 'approve_pending'
                  and target_id = id::text and not (after->>'applied')::boolean) then
    raise exception 'approve_pending audit row must say applied = false';
  end if;
end $$;

-- ------------------------------------------------------------ admin: dismiss applies nothing
do $$
declare
  e uuid := (select v from _q where k = 'entry')::uuid;
  id uuid;
  picks_before int;
  ok boolean := false;
begin
  select count(*) into picks_before from picks;
  id := admin_stage_pending('pick',
    jsonb_build_object('entry_id', e, 'entry_name', 'Pumpy321', 'week', 1, 'team', 'PHI'),
    'gmail-msg-4', 'sweep');

  perform admin_dismiss_pending(id, 'he changed his mind in the next mail', 'admin@test.local');

  if (select count(*) from picks) <> picks_before then
    raise exception 'dismiss must not write a pick';
  end if;
  if not exists (select 1 from pending_actions
                  where id = id and resolution = 'dismissed' and resolved_at is not null
                    and resolved_by = 'admin@test.local'
                    and resolution_note = 'he changed his mind in the next mail') then
    raise exception 'dismissed row not resolved as expected';
  end if;
  if not exists (select 1 from audit_log where action = 'dismiss_pending'
                  and target_id = id::text and note = 'he changed his mind in the next mail') then
    raise exception 'dismiss_pending audit row missing';
  end if;

  begin
    perform admin_approve_pending(id, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%already dismissed%';
  end;
  if not ok then raise exception 'a dismissed row must not be approvable'; end if;

  ok := false;
  begin
    perform admin_dismiss_pending(id, null, 'admin@test.local');
  exception when others then
    ok := sqlerrm like '%already dismissed%';
  end;
  if not ok then raise exception 'a dismissed row must not be dismissable twice'; end if;

  -- The admin cannot reopen or edit a row by hand either.
  ok := false;
  begin
    update pending_actions set resolved_at = null, resolution = null, resolved_by = null where id = id;
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
  id uuid;
  res jsonb;
  pick uuid;
begin
  id := admin_stage_pending('pick',
    jsonb_build_object('entry_id', e, 'week', 1, 'team', 'PHI'),
    'gmail-msg-5', 'sweep');
  res := admin_approve_pending(id, null, 'admin@test.local');
  pick := (res->'result'->>'pick_id')::uuid;
  if pick is null or not exists (select 1 from picks where id = pick and entry_id = e and week = 1 and team = 'PHI' and is_current) then
    raise exception 'pick approve must write the pick through admin_submit_pick';
  end if;
  if not exists (select 1 from audit_log where action = 'submit_pick' and target_id = pick::text) then
    raise exception 'submit_pick audit row missing - was the RPC bypassed?';
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
