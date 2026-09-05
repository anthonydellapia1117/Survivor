-- Queue: a stale queued pick cannot roll back a newer one (follow-up to 63).
--
-- 20260905000063 was applied to production on 2026-09-05 before review found
-- this hole: admin_approve_pending handed a queued pick to admin_submit_pick
-- unconditionally, and that function supersedes whichever pick is current.
-- So a reply that sat in the queue (ambiguous name, say) could be approved
-- AFTER the player sent a newer reply, or after Anthony keyed a pick in, and
-- silently put the older choice back. Worse, after the week was scored it
-- would replace a scored pick with a fresh pending one.
--
-- Two guards, both before anything is written, both leaving the row OPEN
-- (the same shape as every other refused approve, so Anthony sees it and
-- dismisses it):
--   * the current pick for that entry and week already carries a result
--     (win, loss, tie_loss, missed): nothing in the queue replaces it;
--   * the current pick was submitted later than this reply arrived
--     (payload.received_at, or now() when absent): the queued reply is stale.
-- A queued reply newer than the current pick still supersedes it, at its own
-- arrival time, exactly as before. Only the pick branch changes; the function
-- is restated whole because that is how a plpgsql body is replaced.
--
-- The check and the write are one critical section. Both this function and
-- the six-argument admin_submit_pick (restated below, unchanged otherwise)
-- take pg_advisory_xact_lock on (entry, week) first, so a pick submitted by
-- any path while an approve is between its check and its write waits for the
-- approve to commit, then supersedes it in order. One admin and one hourly
-- sweep do not produce that interleaving (CLAUDE.md, Working rules), but the
-- lock is one line in each place and the same shape mint_free_entries uses.
--
-- Not applied automatically. Apply to production after the local SQL suites
-- pass (tests/sql/13_pending_queue.sql, block "a stale queued pick cannot
-- roll back a newer one").

create or replace function admin_approve_pending(
  p_id uuid,
  p_note text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r pending_actions%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_applied boolean := false;
  v_result jsonb := null;
  v_uuid uuid;
  v_names text[];
  v_received timestamptz;
  v_cur_at timestamptz;
  v_cur_result text;
begin
  if not is_admin() then
    raise exception 'admin_approve_pending: not the admin'
      using errcode = 'insufficient_privilege';
  end if;

  select * into r from pending_actions where id = p_id for update;
  if r.id is null then
    raise exception 'pending action % not found', p_id;
  end if;
  if r.resolved_at is not null then
    raise exception 'pending action % is already %', p_id, r.resolution;
  end if;
  v_before := to_jsonb(r);

  case r.kind
    when 'payment' then
      -- owner_id may be null: an unmatched receipt goes to quarantine, which
      -- is what admin_record_payment does with a null owner already.
      if (r.payload->>'amount_cents') is null or (r.payload->>'paid_on') is null then
        raise exception 'payment payload needs amount_cents and paid_on';
      end if;
      v_uuid := admin_record_payment(
        (r.payload->>'owner_id')::uuid,
        (r.payload->>'amount_cents')::int,
        coalesce(nullif(r.payload->>'method', ''), 'venmo'),
        (r.payload->>'paid_on')::date,
        r.payload->>'venmo_txn_id',
        r.payload->>'note',
        (r.payload->>'corrects')::uuid,
        p_actor);
      v_applied := true;
      v_result := jsonb_build_object('payment_id', v_uuid);

    when 'pick' then
      if (r.payload->>'entry_id') is null or (r.payload->>'week') is null
         or nullif(r.payload->>'team', '') is null then
        raise exception 'pick payload needs entry_id, week and team';
      end if;
      -- The pick's time is when the player's mail arrived (payload.received_at,
      -- set by the sweep), not when Anthony clicks Approve: a reply that beat
      -- its deadline stays on time however long it waited here. The overload
      -- in 63 records and judges lateness at that timestamp; absent, it is
      -- now(), the same as a pick keyed in by hand.
      v_received := nullif(r.payload->>'received_at', '')::timestamptz;
      if v_received is not null and v_received > now() then
        raise exception 'pick payload received_at is in the future';
      end if;

      -- What is current for this entry and week, and is the queued reply
      -- allowed to replace it? A scored pick, never. A pick submitted after
      -- this reply arrived, never: the queued reply is stale, whichever way
      -- it got beaten (a later reply, or Anthony's own click). Refusing
      -- leaves the row open for him to dismiss. The lock is the one every
      -- pick submission takes (admin_submit_pick below), so the check and
      -- the write cannot be split by a submission committing in between.
      perform pg_advisory_xact_lock(
        hashtext('picks:' || (r.payload->>'entry_id') || ':' || (r.payload->>'week'))::bigint);
      select p.submitted_at, p.result into v_cur_at, v_cur_result
        from picks p
       where p.entry_id = (r.payload->>'entry_id')::uuid
         and p.week = (r.payload->>'week')::int
         and p.is_current;
      if v_cur_result in ('win', 'loss', 'tie_loss', 'missed') then
        raise exception 'the pick for this entry and week is already % - nothing in the queue replaces a scored pick',
          v_cur_result;
      end if;
      if v_cur_at is not null and v_cur_at > coalesce(v_received, now()) then
        raise exception 'stale: a newer pick (submitted %) is already current; this reply arrived %',
          v_cur_at, coalesce(v_received, now());
      end if;

      v_uuid := admin_submit_pick(
        (r.payload->>'entry_id')::uuid,
        (r.payload->>'week')::int,
        r.payload->>'team',
        coalesce(nullif(r.payload->>'source', ''), 'admin'),
        p_actor,
        v_received);
      v_applied := true;
      v_result := jsonb_build_object('pick_id', v_uuid, 'submitted_at', v_received);

    when 'entries' then
      if (r.payload->>'owner_id') is null
         or jsonb_typeof(r.payload->'entry_names') <> 'array'
         or jsonb_array_length(r.payload->'entry_names') = 0 then
        raise exception 'entries payload needs owner_id and a non-empty entry_names array';
      end if;
      select array_agg(x) into v_names
        from jsonb_array_elements_text(r.payload->'entry_names') x;
      perform admin_add_entries(
        (r.payload->>'owner_id')::uuid,
        v_names,
        coalesce((r.payload->>'name_is_default')::boolean, false),
        coalesce((r.payload->>'is_free')::boolean, false),
        p_actor);
      v_applied := true;
      v_result := jsonb_build_object('owner_id', r.payload->>'owner_id',
                                     'added', cardinality(v_names));

    else
      -- No RPC for this kind. The decision is recorded (resolution =
      -- approved, note kept) and NOTHING is applied: Anthony makes the change
      -- on the relevant admin screen. new_owner is here on purpose - creating
      -- an owner from a JSON payload skips the search-before-create that
      -- Quick add carries, and a duplicate owner is exactly the kind of row
      -- this pool has had to unpick before.
      v_applied := false;
  end case;

  update pending_actions
     set resolved_at = now(),
         resolution = 'approved',
         resolution_note = nullif(trim(coalesce(p_note, '')), ''),
         resolved_by = p_actor
   where id = p_id;

  select to_jsonb(a) into v_after from pending_actions a where a.id = p_id;
  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'approve_pending', 'pending_actions', p_id::text,
          v_before,
          v_after || jsonb_build_object('applied', v_applied, 'result', v_result),
          nullif(trim(coalesce(p_note, '')), ''));

  return jsonb_build_object('id', p_id, 'kind', r.kind,
                            'applied', v_applied, 'result', v_result);
end $$;

-- ---------------------------------------------------------------------------
-- admin_submit_pick (six arguments, 63) restated with the same (entry, week)
-- advisory lock taken first. Every pick submission passes through here (the
-- five-argument form delegates), so the queue's check-then-write above is
-- serialised against all of them. Nothing else changes.
create or replace function admin_submit_pick(
  p_entry_id uuid,
  p_week int,
  p_team text,
  p_source text,
  p_actor text,
  p_submitted_at timestamptz
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_at timestamptz := coalesce(p_submitted_at, now());
  v_deadline timestamptz;
  v_old_id uuid;
  v_new_id uuid;
  v_double_through int;
  v_losses int;
  v_bye_used boolean;
begin
  perform pg_advisory_xact_lock(
    hashtext('picks:' || p_entry_id::text || ':' || p_week::text)::bigint);

  select pick_deadline(p_week, p_team) into v_deadline;
  if v_deadline is null then
    raise exception 'week % does not exist', p_week;
  end if;

  if p_team = 'SKIP_WEEK' then
    select double_elim_through_week into v_double_through from config;
    if p_week <= v_double_through then
      raise exception 'bye may only be used from week % on', v_double_through + 1;
    end if;
    select count(*) filter (where p.result in ('loss','tie_loss','missed') and p.week <= v_double_through),
           bool_or(p.team = 'SKIP_WEEK')
      into v_losses, v_bye_used
      from picks p
     where p.entry_id = p_entry_id and p.is_current;
    if coalesce(v_losses, 0) > 0 then
      raise exception 'bye not earned: entry took a loss in weeks 1-%', v_double_through;
    end if;
    if coalesce(v_bye_used, false) then
      raise exception 'bye already used';
    end if;
  end if;

  select id into v_old_id from picks
   where entry_id = p_entry_id and week = p_week and is_current;

  if v_old_id is not null then
    update picks set is_current = false where id = v_old_id;
  end if;

  insert into picks (entry_id, week, team, source, supersedes_id, late, result, submitted_at)
  values (p_entry_id, p_week, p_team,
          coalesce(nullif(p_source, ''), 'admin'),
          v_old_id,
          v_at > v_deadline,
          case when p_team = 'SKIP_WEEK' then 'bye' else 'pending' end,
          v_at)
  returning id into v_new_id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor,
          case when v_old_id is null then 'submit_pick' else 'override_pick' end,
          'picks', v_new_id::text,
          jsonb_build_object('entry_id', p_entry_id, 'week', p_week,
                             'team', p_team, 'supersedes', v_old_id));
  return v_new_id;
end $$;

-- create or replace keeps the grants of 63: execute revoked from public and
-- anon, granted to authenticated. Restated so a fresh database gets the same.
revoke execute on function admin_approve_pending(uuid, text, text) from public;
do $$
begin
  revoke execute on function admin_approve_pending(uuid, text, text) from anon;
  grant execute on function admin_approve_pending(uuid, text, text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
