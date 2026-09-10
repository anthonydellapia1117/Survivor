-- Anthony's dictated picks from a self-email (20260911000067).
--
-- The command decides WHAT to apply; this function is the write, and the four
-- things asserted here are the ones a TypeScript test cannot see:
--   * it is admin-only, and anon cannot call it at all;
--   * each applied line writes its pick, its own audit row carrying the Gmail
--     message id, and the picks row is stamped with the RECEIPT time, not
--     now() - so a run after the deadline does not mark a pick late that the
--     mail beat;
--   * the rows the caller reports staged are really staged, in the same
--     transaction, with the message id on the payload;
--   * a replay of the same message writes NOTHING - no pick, no staged row,
--     no audit row - and says so.
--
-- Everything rolls back.

begin;

select set_config('app.admin_email', 'admin@test.local', true);

create temp table _s(k text primary key, v text) on commit drop;
grant select, insert on _s to anon, authenticated;
insert into _s
select 'entry', (select en.id::text from entries en
                  join owners o on o.id = en.owner_id
                 where en.voided_at is null
                 order by en.created_at, en.entry_index limit 1);

-- ------------------------------------------------------------ anon is refused
set local role anon;
do $$
declare ok boolean := false;
begin
  begin
    perform admin_apply_self_pick_email('m-anon', '[]'::jsonb, '[]'::jsonb, 'anon');
  exception when others then
    ok := true;
  end;
  if not ok then raise exception 'anon must not be able to apply a self-pick email'; end if;
end $$;
reset role;

-- ------------------------------------------------------------ a signed-in stranger is refused
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', true);
do $$
declare ok boolean := false;
begin
  begin
    perform admin_apply_self_pick_email('m-stranger', '[]'::jsonb, '[]'::jsonb, 'stranger');
  exception when insufficient_privilege then
    ok := true;
  end;
  if not ok then raise exception 'a non-admin must be refused'; end if;
end $$;
select set_config('request.jwt.claims', '', true);
reset role;

-- ------------------------------------------------------------ the admin applies one line
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"admin@test.local"}', true);
do $$
declare
  e uuid := (select v from _s where k = 'entry')::uuid;
  wk int;
  team text;
  received timestamptz;
  audits int;
  res jsonb;
  n int;
  p record;
begin
  -- A week whose late deadline is already past, so a pick stamped now() would
  -- be late and one stamped with the receipt time is not. That difference is
  -- the whole point of passing the receipt through.
  select w.week into wk from weeks w where w.late_deadline_at < now() order by w.week limit 1;
  if wk is null then
    -- Every week is still ahead: make the first one past for this transaction.
    select min(w.week) into wk from weeks w;
    update weeks set early_deadline_at = now() - interval '9 days',
                     late_deadline_at  = now() - interval '7 days'
     where week = wk;
  end if;
  select g.home_team into team from nfl_games g where g.week = wk limit 1;
  if team is null then raise exception 'fixture has no game in week %', wk; end if;
  -- The deadline is the TEAM's, not the week's: a Wednesday game closes two
  -- days before the Friday boundary, so measuring against the week's late
  -- deadline would call a perfectly timely pick late.
  received := pick_deadline(wk, team) - interval '1 hour';
  if received >= now() then
    raise exception 'fixture week % is not in the past; a now() stamp would not be late either', wk;
  end if;

  select count(*) into audits from audit_log;

  res := admin_apply_self_pick_email(
    'gmail-self-1',
    jsonb_build_array(jsonb_build_object(
      'entry_id', e, 'week', wk, 'team', team, 'line', format('%s %s', 1, team),
      'submitted_at', received)),
    jsonb_build_array(jsonb_build_object(
      'kind', 'pick', 'entry_id', e, 'week', wk, 'team', 'ZZZ',
      'line', 'nonsense line', 'reason', 'staged on purpose')),
    'admin@test.local');

  if (res->>'applied')::int <> 1 then raise exception 'expected one applied, got %', res->>'applied'; end if;
  if (res->>'staged')::int <> 1 then raise exception 'expected one staged, got %', res->>'staged'; end if;
  if (res->>'already_applied')::boolean then raise exception 'first run must not report already_applied'; end if;

  select * into p from picks where entry_id = e and week = wk and is_current;
  if p.team <> team then raise exception 'pick not written'; end if;
  if p.source <> 'text' then raise exception 'a dictated pick is source text, got %', p.source; end if;
  -- THE RECEIPT TIME, not now(). Both halves matter: the stamp is the mail's,
  -- and because the mail beat the deadline the pick is not late.
  if p.submitted_at <> received then
    raise exception 'submitted_at is % and should be the receipt time %', p.submitted_at, received;
  end if;
  if p.late then raise exception 'a pick the mail beat must not be marked late'; end if;

  select count(*) into n from audit_log
   where action = 'self_pick_applied' and after->>'message_id' = 'gmail-self-1';
  if n <> 1 then raise exception 'the applied line must carry the message id in its own audit row'; end if;

  -- The staged row is real, on the queue, with the message id on it.
  select count(*) into n from pending_actions
   where source_message_id = 'gmail-self-1' and resolved_at is null
     and kind = 'pick' and payload->>'message_id' = 'gmail-self-1';
  if n <> 1 then raise exception 'the row reported staged is not on the queue'; end if;

  if (select count(*) from audit_log) <= audits then
    raise exception 'the run wrote no audit rows at all';
  end if;
end $$;

-- ------------------------------------------------------------ a replay writes nothing
do $$
declare
  e uuid := (select v from _s where k = 'entry')::uuid;
  wk int := (select week from picks where entry_id = (select v from _s where k = 'entry')::uuid and is_current limit 1);
  audits int;
  picks_before int;
  queue_before int;
  res jsonb;
begin
  select count(*) into audits from audit_log;
  select count(*) into picks_before from picks;
  select count(*) into queue_before from pending_actions;

  res := admin_apply_self_pick_email(
    'gmail-self-1',
    jsonb_build_array(jsonb_build_object(
      'entry_id', e, 'week', wk, 'team', 'PHI', 'line', 'replay', 'submitted_at', now())),
    jsonb_build_array(jsonb_build_object('kind', 'pick', 'line', 'replay staged')),
    'admin@test.local');

  if not (res->>'already_applied')::boolean then raise exception 'a replay must report already_applied'; end if;
  if (res->>'applied')::int <> 0 then raise exception 'a replay must apply nothing'; end if;
  if (select count(*) from picks) <> picks_before then raise exception 'a replay wrote a pick'; end if;
  if (select count(*) from pending_actions) <> queue_before then raise exception 'a replay staged a row'; end if;
  if (select count(*) from audit_log) <> audits then raise exception 'a replay wrote an audit row'; end if;
end $$;

select set_config('request.jwt.claims', '', true);
reset role;
rollback;
