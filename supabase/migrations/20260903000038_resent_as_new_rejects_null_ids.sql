-- Reject a null element in the entry id list.
--
-- admin_mark_resent_as_new validates its argument by collecting ids that match
-- no entry and raising if any are found. A null element defeats that: the
-- not-exists test selects it, since no entry has a null id, but string_agg
-- discards nulls, so v_bad is null and the call proceeds as though every id
-- checked out.
--
--   [valid_id, null] -> the valid row IS updated, half-applying a call whose
--                       whole point is to fail whole
--   [null]           -> nothing is updated, but an audit row is still written
--                       recording 'resent': 0
--
-- Not reachable from the UI: p_entry_ids has no admin surface and the RPC is
-- invoked by hand for a specific correction, so this is robustness rather than
-- a live defect. Reported by Codex on PR #4.

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

  -- A null element has to be rejected explicitly. The not-exists check below
  -- does select it -- no entry has a null id -- but string_agg drops nulls, so
  -- v_bad comes back null and the guard reads as "everything found". A mixed
  -- array like [valid_id, null] would then fall through and update the valid
  -- row, breaking the fail-whole contract, and [null] alone would write an
  -- audit row claiming zero entries were re-sent.
  if exists (select 1 from unnest(p_entry_ids) as x(id) where x.id is null) then
    raise exception 'entry id list contains a null - refusing to apply it in part';
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
      'entry % is voided - a voided entry she was told to drop is a removal, not a re-send',
      v_bad;
  end if;

  select string_agg(e.entry_name, ', ' order by e.entry_name) into v_bad
    from entries e
   where e.id = any(p_entry_ids) and e.submitted_to_lynne_at is null;
  if v_bad is not null then
    raise exception
      'entry % was never sent to Lynne - there is nothing for her to have deleted; use admin_mark_new_entries_sent',
      v_bad;
  end if;

  select jsonb_agg(jsonb_build_object(
           'entry_id', e.id,
           'entry_name', e.entry_name,
           'lynne_held', e.submitted_as_name,
           'lynne_number', e.lynne_number,
           'lynne_label', e.lynne_label,
           'sent_at', e.submitted_to_lynne_at) order by e.entry_name)
    into v_before
    from entries e where e.id = any(p_entry_ids);

  update entries e
     set submitted_to_lynne_at = now(),
         submitted_as_name = e.entry_name,
         lynne_number = null,
         lynne_label = null
   where e.id = any(p_entry_ids);
  get diagnostics v_count = row_count;

  select jsonb_agg(jsonb_build_object(
           'entry_id', e.id,
           'entry_name', e.entry_name,
           'lynne_held', e.submitted_as_name,
           'lynne_number', e.lynne_number,
           'lynne_label', e.lynne_label,
           'sent_at', e.submitted_to_lynne_at) order by e.entry_name)
    into v_after
    from entries e where e.id = any(p_entry_ids);

  select jsonb_agg(jsonb_build_object(
           'entry', b->>'entry_name',
           'lynne_held', b->>'lynne_held',
           'previously_sent_at', b->>'sent_at',
           'previous_lynne_number', b->'lynne_number',
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
