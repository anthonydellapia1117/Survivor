-- Capture the pre-state of a re-send in the audit row's `before` payload.
--
-- admin_mark_resent_as_new recorded the name Lynne had been holding, but only
-- inside `after.mapping`, leaving `before` null. Two problems with that:
--
--   * every other admin mutation writes both halves, so anyone tracing what an
--     entry used to be reads `before` — and would find nothing here;
--   * diffPayloads treats a null `before` as a create, so the row renders as
--     "these values were set" rather than "these replaced Alec Hess 1-4".
--
-- This write is the only thing standing between the app and a total loss of the
-- record that she once held those four under a different name — if she numbers
-- off a stale copy of her sheet, it is what the variance is traced through. It
-- belongs in the field a reader will actually look in.

create or replace function public.admin_mark_resent_as_new(
  p_entry_ids uuid[], p_actor text, p_note text
) returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_map jsonb;
  v_before jsonb;
  v_after jsonb;
  v_count int;
  v_bad text;
begin
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    raise exception 'no entries given';
  end if;

  select string_agg(x.id::text, ', ') into v_bad
    from unnest(p_entry_ids) as x(id)
   where not exists (select 1 from entries e where e.id = x.id);
  if v_bad is not null then
    raise exception 'entry % not found', v_bad;
  end if;

  select string_agg(e.entry_name, ', ' order by e.entry_name) into v_bad
    from entries e
   where e.id = any(p_entry_ids) and e.voided_at is not null;
  if v_bad is not null then
    raise exception
      'entry % is voided — a voided entry she was told to drop is a removal, not a re-send',
      v_bad;
  end if;

  select string_agg(e.entry_name, ', ' order by e.entry_name) into v_bad
    from entries e
   where e.id = any(p_entry_ids) and e.submitted_to_lynne_at is null;
  if v_bad is not null then
    raise exception
      'entry % was never sent to Lynne — there is nothing for her to have deleted; use admin_mark_new_entries_sent',
      v_bad;
  end if;

  -- Snapshot what Lynne was holding BEFORE anything is overwritten.
  select jsonb_agg(jsonb_build_object(
           'entry_id', e.id,
           'entry_name', e.entry_name,
           'lynne_held', e.submitted_as_name,
           'sent_at', e.submitted_to_lynne_at) order by e.entry_name)
    into v_before
    from entries e where e.id = any(p_entry_ids);

  update entries e
     set submitted_to_lynne_at = now(),
         submitted_as_name = e.entry_name
   where e.id = any(p_entry_ids);
  get diagnostics v_count = row_count;

  select jsonb_agg(jsonb_build_object(
           'entry_id', e.id,
           'entry_name', e.entry_name,
           'lynne_held', e.submitted_as_name,
           'sent_at', e.submitted_to_lynne_at) order by e.entry_name)
    into v_after
    from entries e where e.id = any(p_entry_ids);

  -- The old -> new pairing, kept alongside for a reader who wants it in one line.
  select jsonb_agg(jsonb_build_object(
           'entry', b->>'entry_name',
           'lynne_held', b->>'lynne_held',
           'previously_sent_at', b->>'sent_at',
           'now_sent_as', b->>'entry_name')
         order by b->>'entry_name')
    into v_map
    from jsonb_array_elements(v_before) as b;

  insert into audit_log (actor, action, target_table, note, before, after)
  values (p_actor, 'mark_resent_as_new', 'entries', p_note,
          jsonb_build_object('resent', v_count, 'entries', v_before),
          jsonb_build_object('resent', v_count, 'entries', v_after,
                             'mapping', v_map));

  return jsonb_build_object('resent', v_count, 'mapping', v_map);
end $function$;
