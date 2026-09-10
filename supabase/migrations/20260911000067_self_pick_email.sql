-- Anthony's dictated picks, applied from his own self-email.
--
-- He takes picks by text and by phone and enters them by emailing HIMSELF,
-- subject carrying "Survivor", one pick per line. The parser and every
-- resolution rule live in scripts/picks/lib/self-email.ts; this function is
-- the write, and it exists so that each applied line carries the Gmail
-- message id in its own audit row and so a replay writes nothing.
--
-- It calls admin_submit_pick per row, which keeps every existing guard: the
-- deadline, the repeated team, the bye rules and the pick's own audit row.
-- Nothing here loosens any of them, and there is no path in it that writes a
-- pick admin_submit_pick would refuse.

create or replace function admin_apply_self_pick_email(
  p_message_id text,
  p_rows jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_pick uuid;
  v_applied int := 0;
  v_entry uuid;
begin
  if not is_admin() then
    raise exception 'admin_apply_self_pick_email: not the admin'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_message_id), '') = '' then
    raise exception 'admin_apply_self_pick_email: a Gmail message id is required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'admin_apply_self_pick_email: p_rows must be an array';
  end if;

  -- IDEMPOTENT ON THE MESSAGE. The guard is an audit_log row rather than a
  -- flag on a table, so it holds for a re-run of the command, a second ops
  -- run in the same window, and SQL applied by hand - the same shape as
  -- admin_apply_lynne_email_cells.
  if exists (
    select 1 from audit_log
    where action = 'self_pick_email' and after->>'message_id' = p_message_id
  ) then
    return jsonb_build_object('message_id', p_message_id, 'already_applied', true, 'applied', 0);
  end if;

  for r in select
             (x->>'entry_id')::uuid as entry_id,
             (x->>'week')::int      as week,
              x->>'team'            as team,
              x->>'line'            as line
           from jsonb_array_elements(p_rows) x
  loop
    if r.entry_id is null or r.week is null or coalesce(trim(r.team), '') = '' then
      raise exception 'self pick row needs entry_id, week and team: %', r.line;
    end if;
    select id into v_entry from entries where id = r.entry_id and voided_at is null;
    if v_entry is null then
      raise exception 'entry % is voided or missing', r.entry_id;
    end if;

    v_pick := admin_submit_pick(r.entry_id, r.week, r.team, 'text', p_actor);
    v_applied := v_applied + 1;

    -- EVERY APPLIED LINE carries the message id, so a pick written this way
    -- can always be traced back to the mail that said it.
    insert into audit_log (actor, action, target_table, target_id, before, after, note)
    values (p_actor, 'self_pick_applied', 'picks', v_pick::text, null,
            jsonb_build_object('message_id', p_message_id, 'entry_id', r.entry_id,
                               'week', r.week, 'team', r.team, 'line', r.line),
            'dictated pick from the admin self-email');
  end loop;

  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'self_pick_email', 'picks', p_message_id, null,
          jsonb_build_object('message_id', p_message_id, 'applied', v_applied),
          format('%s dictated pick(s) applied from one self-email', v_applied));

  return jsonb_build_object('message_id', p_message_id, 'already_applied', false, 'applied', v_applied);
end $$;

revoke all on function admin_apply_self_pick_email(text, jsonb, text) from public, anon;
grant execute on function admin_apply_self_pick_email(text, jsonb, text) to authenticated;
