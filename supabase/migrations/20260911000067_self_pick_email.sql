-- Anthony's dictated picks, applied from his own self-email.
--
-- He takes picks by text and by phone and enters them by emailing HIMSELF,
-- subject carrying "Survivor", one pick per line. The parser and every
-- resolution rule live in scripts/picks/lib/self-email.ts; this function is
-- the write, and it exists so that each applied line carries the Gmail
-- message id in its own audit row and so a replay writes nothing.
--
-- WHAT admin_submit_pick DOES AND DOES NOT GUARD. It refuses a week that does
-- not exist and it enforces every bye rule, and it stamps the late flag from
-- the submit time. It does NOT know a team was used before, and it does NOT
-- look at what is already current: it supersedes whatever it finds. So the
-- two rules that matter most here - a repeated team is an ELIMINATION in her
-- pool, and a pick already scored or already newer is Anthony's call - are
-- caught BEFORE this function is reached (guardSelfRows) and arrive in
-- p_staged instead of p_rows. Nothing in here loosens a guard; the point is
-- that two of them never existed at this level and are not invented here.

create or replace function admin_apply_self_pick_email(
  p_message_id text,
  p_rows jsonb,
  p_staged jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  s record;
  v_pick uuid;
  v_applied int := 0;
  v_staged int := 0;
  v_entry uuid;
begin
  if not is_admin() then
    raise exception 'admin_apply_self_pick_email: not the admin'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_message_id), '') = '' then
    raise exception 'admin_apply_self_pick_email: a Gmail message id is required';
  end if;
  -- Every row this writes is audited under p_actor. A blank one would leave
  -- picks and queue rows nobody can be traced to, which is the one thing an
  -- audit row exists to prevent.
  if coalesce(trim(p_actor), '') = '' then
    raise exception 'admin_apply_self_pick_email: an actor is required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'admin_apply_self_pick_email: p_rows must be an array';
  end if;
  if p_staged is not null and jsonb_typeof(p_staged) <> 'array' then
    raise exception 'admin_apply_self_pick_email: p_staged must be an array';
  end if;

  -- Serialise two runs of the same message. The audit row below is what makes
  -- a replay a no-op, and two transactions that both read before either wrote
  -- it would both apply. One person at one terminal does not produce that
  -- (CLAUDE.md, Working rules), but this command is meant for the hourly ops
  -- run as well as a hand run, and those are two invocations rather than two
  -- admins. Taken before the read, released at commit, keyed on the message.
  perform pg_advisory_xact_lock(hashtext('self_pick_email:' || p_message_id)::bigint);

  -- IDEMPOTENT ON THE MESSAGE. The guard is an audit_log row rather than a
  -- flag on a table, so it holds for a re-run of the command, a second ops
  -- run in the same window, and SQL applied by hand - the same shape as
  -- admin_apply_lynne_email_cells.
  if exists (
    select 1 from audit_log
    where action = 'self_pick_email' and after->>'message_id' = p_message_id
  ) then
    return jsonb_build_object('message_id', p_message_id, 'already_applied', true,
                              'applied', 0, 'staged', 0);
  end if;

  for r in select
             (x->>'entry_id')::uuid     as entry_id,
             (x->>'week')::int          as week,
              x->>'team'                as team,
              x->>'line'                as line,
             (x->>'submitted_at')::timestamptz as submitted_at
           from jsonb_array_elements(p_rows) x
  loop
    if r.entry_id is null or r.week is null or coalesce(trim(r.team), '') = '' then
      raise exception 'self pick row needs entry_id, week and team: %', r.line;
    end if;
    select id into v_entry from entries where id = r.entry_id and voided_at is null;
    if v_entry is null then
      raise exception 'entry % is voided or missing', r.entry_id;
    end if;

    -- The six-argument form, with the time the MAIL arrived. The five-argument
    -- one stamps now(), which would mark a pick late for no reason other than
    -- the command running after its deadline.
    v_pick := admin_submit_pick(r.entry_id, r.week, r.team, 'text', p_actor, r.submitted_at);
    v_applied := v_applied + 1;

    -- EVERY APPLIED LINE carries the message id, so a pick written this way
    -- can always be traced back to the mail that said it.
    insert into audit_log (actor, action, target_table, target_id, before, after, note)
    values (p_actor, 'self_pick_applied', 'picks', v_pick::text, null,
            jsonb_build_object('message_id', p_message_id, 'entry_id', r.entry_id,
                               'week', r.week, 'team', r.team, 'line', r.line),
            'dictated pick from the admin self-email');
  end loop;

  -- EVERY ROW THE COMMAND CALLS STAGED IS STAGED HERE, in the same
  -- transaction as the applies and before the row that makes the message
  -- applied. Staging afterwards, or from the command, would leave the
  -- unresolved lines with nowhere to go the moment a replay short-circuits:
  -- the applied rows would be permanent and the questions would be lost.
  for s in select x->>'kind' as kind, x as body
           from jsonb_array_elements(coalesce(p_staged, '[]'::jsonb)) x
  loop
    if jsonb_typeof(s.body) <> 'object' then
      raise exception 'admin_apply_self_pick_email: each staged row must be an object';
    end if;
    perform admin_stage_pending(
      coalesce(nullif(trim(s.kind), ''), 'player_question'),
      (s.body - 'kind') || jsonb_build_object('message_id', p_message_id),
      p_message_id,
      p_actor);
    v_staged := v_staged + 1;
  end loop;

  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'self_pick_email', 'picks', p_message_id, null,
          jsonb_build_object('message_id', p_message_id, 'applied', v_applied,
                             'staged', v_staged),
          format('%s dictated pick(s) applied and %s staged from one self-email',
                 v_applied, v_staged));

  return jsonb_build_object('message_id', p_message_id, 'already_applied', false,
                            'applied', v_applied, 'staged', v_staged);
end $$;

revoke all on function admin_apply_self_pick_email(text, jsonb, jsonb, text) from public, anon;
grant execute on function admin_apply_self_pick_email(text, jsonb, jsonb, text) to authenticated;

-- The three-argument form of the first draft never reached production. Dropped
-- so a database that somehow has it cannot be called with the old shape, where
-- a staged row had nowhere to go.
drop function if exists admin_apply_self_pick_email(text, jsonb, text);
