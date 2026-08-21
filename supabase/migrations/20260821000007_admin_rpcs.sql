-- Admin write RPCs. Every function writes its data AND its audit row in one
-- transaction — they commit together or neither does (spec section 7).
-- Executed only by the server's service role; execute is revoked from the
-- public-facing roles at the bottom.

-- Create an owner, optionally with entries.
create or replace function admin_create_owner(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_source text,
  p_notes text,
  p_entry_names text[],
  p_name_is_default boolean,
  p_actor text
) returns uuid
language plpgsql
as $$
declare
  v_owner_id uuid;
  v_name text;
  v_idx int := 0;
begin
  insert into owners (first_name, last_name, email, phone, source, notes)
  values (p_first_name, p_last_name, nullif(p_email, ''), nullif(p_phone, ''),
          coalesce(nullif(p_source, ''), 'email'), nullif(p_notes, ''))
  returning id into v_owner_id;

  if p_entry_names is not null then
    foreach v_name in array p_entry_names loop
      v_idx := v_idx + 1;
      insert into entries (owner_id, entry_index, entry_name, name_is_default)
      values (v_owner_id, v_idx, v_name, coalesce(p_name_is_default, false));
    end loop;
  end if;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'create_owner', 'owners', v_owner_id::text,
          jsonb_build_object('first_name', p_first_name, 'last_name', p_last_name,
                             'entries', coalesce(array_length(p_entry_names, 1), 0)));
  return v_owner_id;
end $$;

-- Update owner fields, including participation status (admin-set only, audited).
create or replace function admin_update_owner(
  p_owner_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_participation_status text,
  p_notes text,
  p_actor text
) returns void
language plpgsql
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select to_jsonb(o) - 'created_at' - 'updated_at' into v_before from owners o where id = p_owner_id;
  if v_before is null then
    raise exception 'owner % not found', p_owner_id;
  end if;

  update owners
     set first_name = p_first_name,
         last_name = p_last_name,
         email = nullif(p_email, ''),
         phone = nullif(p_phone, ''),
         participation_status = p_participation_status,
         notes = nullif(p_notes, ''),
         updated_at = now()
   where id = p_owner_id;

  select to_jsonb(o) - 'created_at' - 'updated_at' into v_after from owners o where id = p_owner_id;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'update_owner', 'owners', p_owner_id::text, v_before, v_after);
end $$;

-- Add entries to an existing owner.
create or replace function admin_add_entries(
  p_owner_id uuid,
  p_entry_names text[],
  p_name_is_default boolean,
  p_is_free boolean,
  p_actor text
) returns void
language plpgsql
as $$
declare
  v_name text;
  v_idx int;
begin
  select coalesce(max(entry_index), 0) into v_idx from entries where owner_id = p_owner_id;
  foreach v_name in array p_entry_names loop
    v_idx := v_idx + 1;
    insert into entries (owner_id, entry_index, entry_name, name_is_default, is_free_entry)
    values (p_owner_id, v_idx, v_name, coalesce(p_name_is_default, false), coalesce(p_is_free, false));
  end loop;
  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'add_entries', 'entries', p_owner_id::text,
          jsonb_build_object('names', p_entry_names, 'is_free', p_is_free));
end $$;

-- Rename / relabel an entry. The name is stored VERBATIM.
create or replace function admin_update_entry(
  p_entry_id uuid,
  p_entry_name text,
  p_lynne_label text,
  p_is_free boolean,
  p_actor text
) returns void
language plpgsql
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select to_jsonb(e) - 'created_at' into v_before from entries e where id = p_entry_id;
  if v_before is null then
    raise exception 'entry % not found', p_entry_id;
  end if;

  update entries
     set entry_name = p_entry_name,
         name_is_default = false,
         lynne_label = nullif(p_lynne_label, ''),
         is_free_entry = coalesce(p_is_free, is_free_entry)
   where id = p_entry_id;

  select to_jsonb(e) - 'created_at' into v_after from entries e where id = p_entry_id;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'update_entry', 'entries', p_entry_id::text, v_before, v_after);
end $$;

-- Remove an entry ONLY if it has no picks; otherwise the caller must void.
create or replace function admin_remove_entry(
  p_entry_id uuid,
  p_actor text
) returns void
language plpgsql
as $$
declare
  v_before jsonb;
begin
  select to_jsonb(e) into v_before from entries e where id = p_entry_id;
  if v_before is null then
    raise exception 'entry % not found', p_entry_id;
  end if;
  if exists (select 1 from picks where entry_id = p_entry_id) then
    raise exception 'entry has picks — void it instead of removing';
  end if;
  delete from entries where id = p_entry_id;
  insert into audit_log (actor, action, target_table, target_id, before)
  values (p_actor, 'remove_entry', 'entries', p_entry_id::text, v_before);
end $$;

create or replace function admin_void_entry(
  p_entry_id uuid,
  p_actor text
) returns void
language plpgsql
as $$
declare
  v_before jsonb;
begin
  select to_jsonb(e) into v_before from entries e where id = p_entry_id;
  if v_before is null then
    raise exception 'entry % not found', p_entry_id;
  end if;
  update entries set voided_at = now() where id = p_entry_id;
  insert into audit_log (actor, action, target_table, target_id, before, note)
  values (p_actor, 'void_entry', 'entries', p_entry_id::text, v_before,
          'entry had picks; voided rather than removed');
end $$;

-- Record a payment or a correction. The venmo_txn_id unique constraint is the
-- dedupe; violations bubble up to the caller.
create or replace function admin_record_payment(
  p_owner_id uuid,
  p_amount_cents int,
  p_method text,
  p_paid_on date,
  p_venmo_txn_id text,
  p_note text,
  p_corrects uuid,
  p_actor text
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into payments (owner_id, amount_cents, method, paid_on, venmo_txn_id, note, corrects_payment_id)
  values (p_owner_id, p_amount_cents, p_method, p_paid_on,
          nullif(p_venmo_txn_id, ''), nullif(p_note, ''), p_corrects)
  returning id into v_id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'record_payment', 'payments', v_id::text,
          jsonb_build_object('owner_id', p_owner_id, 'amount_cents', p_amount_cents,
                             'method', p_method, 'corrects', p_corrects));
  return v_id;
end $$;

-- Submit or override a pick. Overrides supersede — the old row is never edited.
-- `late` is computed against the week's deadline at submission time.
create or replace function admin_submit_pick(
  p_entry_id uuid,
  p_week int,
  p_team text,
  p_source text,
  p_actor text
) returns uuid
language plpgsql
as $$
declare
  v_deadline timestamptz;
  v_old_id uuid;
  v_new_id uuid;
begin
  select deadline_at into v_deadline from weeks where week = p_week;
  if v_deadline is null then
    raise exception 'week % does not exist', p_week;
  end if;

  select id into v_old_id from picks
   where entry_id = p_entry_id and week = p_week and is_current;

  if v_old_id is not null then
    update picks set is_current = false where id = v_old_id;
  end if;

  insert into picks (entry_id, week, team, source, supersedes_id, late, result)
  values (p_entry_id, p_week, p_team,
          coalesce(nullif(p_source, ''), 'admin'),
          v_old_id,
          now() > v_deadline,
          case when p_team = 'SKIP_WEEK' then 'bye' else 'pending' end)
  returning id into v_new_id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor,
          case when v_old_id is null then 'submit_pick' else 'override_pick' end,
          'picks', v_new_id::text,
          jsonb_build_object('entry_id', p_entry_id, 'week', p_week,
                             'team', p_team, 'supersedes', v_old_id));
  return v_new_id;
end $$;

-- Set a result on the current pick of an entry-week (manual scoring path;
-- the Lynne import uses its own pipeline). Only the result changes — never
-- the team.
create or replace function admin_set_result(
  p_entry_id uuid,
  p_week int,
  p_result text,
  p_result_source text,
  p_actor text
) returns void
language plpgsql
as $$
declare
  v_id uuid;
  v_before jsonb;
begin
  select id, to_jsonb(picks) into v_id, v_before from picks
   where entry_id = p_entry_id and week = p_week and is_current;
  if v_id is null then
    raise exception 'no current pick for entry % week %', p_entry_id, p_week;
  end if;

  update picks set result = p_result, result_source = coalesce(nullif(p_result_source, ''), 'manual')
   where id = v_id;

  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'set_result', 'picks', v_id::text, v_before,
          jsonb_build_object('result', p_result, 'result_source', p_result_source));
end $$;

-- Server-only: these run via the service role.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'admin_create_owner(text,text,text,text,text,text,text[],boolean,text)',
    'admin_update_owner(uuid,text,text,text,text,text,text,text)',
    'admin_add_entries(uuid,text[],boolean,boolean,text)',
    'admin_update_entry(uuid,text,text,boolean,text)',
    'admin_remove_entry(uuid,text)',
    'admin_void_entry(uuid,text)',
    'admin_record_payment(uuid,int,text,date,text,text,uuid,text)',
    'admin_submit_pick(uuid,int,text,text,text)',
    'admin_set_result(uuid,int,text,text,text)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    begin
      execute format('revoke execute on function %s from anon, authenticated', fn);
    exception when undefined_object then
      null; -- roles absent outside supabase
    end;
  end loop;
end $$;
