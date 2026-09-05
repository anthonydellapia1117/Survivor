-- The NEEDS ANTHONY queue.
--
-- The hourly sweep finds things it may not act on by itself: a Venmo receipt
-- at a tier amount, a pick in a reply, an owner asking for more entries, a
-- name it cannot place. Today those come back as lines in a report and
-- Anthony re-keys each one on an admin screen. This table holds them as rows
-- instead. The sweep stages each item through admin_stage_pending; Anthony
-- resolves it at /admin/queue with Approve or Dismiss.
--
-- What Approve does depends on the kind, and ONLY through an existing admin_*
-- RPC: payment -> admin_record_payment, pick -> admin_submit_pick,
-- entries -> admin_add_entries. Nothing here writes entries, blocks, picks,
-- owners or payments directly, so every rule those RPCs carry (the ledger is
-- append-only, the mint trigger, the txn-per-owner dedupe, the audit row in
-- the same transaction) holds for a row approved from the queue exactly as it
-- does for one keyed in by hand. A kind with no RPC (new_owner, identity,
-- anything new) is recorded as approved and left for Anthony to apply on the
-- relevant screen; see the comment in admin_approve_pending.
--
-- Write path. The other admin_* RPCs run with INVOKER rights and lean on the
-- tables' is_admin() RLS policies. This table has NO write policy and no
-- insert/update/delete grant to either client role, so the three RPCs below
-- are SECURITY DEFINER and gate on is_admin() themselves - that is the only
-- way "the RPCs are the only write path" can be literally true. search_path
-- is pinned, execute is revoked from public and anon and granted to
-- authenticated, the same grant shape as every other admin_* function.
--
-- Nothing here is public. No view reads this table, anon has no privilege on
-- it, and a non-admin authenticated user sees zero rows through RLS.

create table pending_actions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind <> ''),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_message_id text,
  staged_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution in ('approved', 'dismissed')),
  resolution_note text,
  staged_by text,
  resolved_by text,
  -- A row is open or it is resolved; the three resolution columns move
  -- together, so a half-resolved row cannot be written.
  check ((resolved_at is null) = (resolution is null)),
  check ((resolved_at is null) = (resolved_by is null))
);

create index pending_actions_open_idx
  on pending_actions (staged_at) where resolved_at is null;
create index pending_actions_source_idx
  on pending_actions (source_message_id) where source_message_id is not null;

comment on table pending_actions is
  'NEEDS ANTHONY items staged by the sweep (admin_stage_pending) and resolved '
  'at /admin/queue (admin_approve_pending, admin_dismiss_pending). Admin-only. '
  'Approve applies a row only by calling an existing admin_* RPC chosen by kind.';
comment on column pending_actions.kind is
  'payment | pick | entries apply automatically on approve; any other kind is '
  'recorded as approved and applied by hand.';
comment on column pending_actions.source_message_id is
  'Gmail message id the item came from, so the sweep can find the thread again.';

alter table pending_actions enable row level security;

-- Read: the admin only. No write policy exists on purpose.
create policy admin_read_pending_actions on pending_actions
  for select using (is_admin());

do $$
begin
  revoke all on pending_actions from anon;
  revoke insert, update, delete, truncate, references, trigger
    on pending_actions from authenticated;
  grant select on pending_actions to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;

-- ---------------------------------------------------------------------------
-- admin_stage_pending: the sweep's write.
--
-- Idempotent on (kind, source_message_id, payload) while the row is open: the
-- sweep runs hourly and re-reading the same message must not stack duplicates.
-- Returning the existing id is the whole no-op, so no audit row is written in
-- that case - nothing changed. It is a lookup under an advisory lock, not a
-- unique index, because one message legitimately carries two items of the
-- same kind (a $200 Venmo settling two owners is two payment rows from one
-- receipt) that differ only in payload.
create or replace function admin_stage_pending(
  p_kind text,
  p_payload jsonb,
  p_source_message_id text,
  p_actor text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind text := trim(coalesce(p_kind, ''));
  v_source text := nullif(trim(coalesce(p_source_message_id, '')), '');
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'admin_stage_pending: not the admin'
      using errcode = 'insufficient_privilege';
  end if;
  if v_kind = '' then
    raise exception 'admin_stage_pending: kind is required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'admin_stage_pending: payload must be a JSON object';
  end if;

  -- Serialise concurrent stages of one message. The lookup below is what
  -- makes re-staging a no-op, and two transactions that both read before
  -- either inserts would both insert. One hourly sweep does not produce that
  -- interleaving (CLAUDE.md, Working rules), but the lock is one line and the
  -- same shape mint_free_entries uses: taken before the read, released at
  -- commit. Keyed on kind and message id, so unrelated messages never wait.
  perform pg_advisory_xact_lock(
    hashtext('pending_actions:' || v_kind || ':' || coalesce(v_source, ''))::bigint);

  select id into v_id
    from pending_actions
   where resolved_at is null
     and kind = v_kind
     and source_message_id is not distinct from v_source
     and payload = p_payload
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into pending_actions (kind, payload, source_message_id, staged_by)
  values (v_kind, p_payload, v_source, p_actor)
  returning id into v_id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'stage_pending', 'pending_actions', v_id::text,
          (select to_jsonb(a) from pending_actions a where a.id = v_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- admin_approve_pending: Anthony's yes.
--
-- Returns {id, kind, applied, result}. applied is true when the kind has an
-- RPC and it ran; result carries what that RPC returned (a payment id, a pick
-- id). When applied is false the row is still resolved as approved - the
-- decision is recorded - and the application is Anthony's next click.
--
-- The dispatched RPC raises on anything it refuses (a duplicate txn per owner,
-- a week that does not exist), and that raise unwinds this whole call, so a
-- refused row stays OPEN with nothing half-written. That is the point of
-- calling the RPC rather than copying its insert.
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
      v_uuid := admin_submit_pick(
        (r.payload->>'entry_id')::uuid,
        (r.payload->>'week')::int,
        r.payload->>'team',
        coalesce(nullif(r.payload->>'source', ''), 'admin'),
        p_actor);
      v_applied := true;
      v_result := jsonb_build_object('pick_id', v_uuid);

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
-- admin_dismiss_pending: Anthony's no. Resolves the row, applies nothing.
create or replace function admin_dismiss_pending(
  p_id uuid,
  p_note text,
  p_actor text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r pending_actions%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  if not is_admin() then
    raise exception 'admin_dismiss_pending: not the admin'
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

  update pending_actions
     set resolved_at = now(),
         resolution = 'dismissed',
         resolution_note = nullif(trim(coalesce(p_note, '')), ''),
         resolved_by = p_actor
   where id = p_id;

  select to_jsonb(a) into v_after from pending_actions a where a.id = p_id;
  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'dismiss_pending', 'pending_actions', p_id::text,
          v_before, v_after, nullif(trim(coalesce(p_note, '')), ''));
end $$;

-- ---------------------------------------------------------------------------
-- Grants: the same shape as every other admin_* function. public and anon
-- revoked, authenticated granted; the is_admin() gate inside each function is
-- what turns "any signed-in user" into "the admin".
revoke execute on function admin_stage_pending(text, jsonb, text, text) from public;
revoke execute on function admin_approve_pending(uuid, text, text) from public;
revoke execute on function admin_dismiss_pending(uuid, text, text) from public;

do $$
begin
  revoke execute on function admin_stage_pending(text, jsonb, text, text) from anon;
  revoke execute on function admin_approve_pending(uuid, text, text) from anon;
  revoke execute on function admin_dismiss_pending(uuid, text, text) from anon;
  grant execute on function admin_stage_pending(text, jsonb, text, text) to authenticated;
  grant execute on function admin_approve_pending(uuid, text, text) to authenticated;
  grant execute on function admin_dismiss_pending(uuid, text, text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
