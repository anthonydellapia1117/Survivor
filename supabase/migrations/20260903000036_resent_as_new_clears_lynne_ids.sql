-- Clear Lynne's identifiers when an entry is re-added to her sheet.
--
-- admin_mark_resent_as_new records that Lynne was told to DELETE a row and ADD a
-- new one. It moved the name and the date but left lynne_number and lynne_label
-- untouched — identifiers that belonged to the row she deleted.
--
-- plan-grid.ts matches a number BEFORE it tries a name (byNumber is consulted
-- first), so a stale number short-circuits the name path: her new row carries a
-- new number, our entry still claims the old one, and whichever of her rows now
-- holds that old number reports number_name_disagree instead of matching by
-- name. Keeping the number asserts something we know to be false — she deleted
-- the row it referred to.
--
-- Nulling both makes a re-added entry behave exactly like any other new row:
-- matched by name until her current number is imported, at which point
-- numberOnSheetNotOnFile carries it back. The old values go into the audit
-- before payload, since this write is what makes them untrue.
--
-- No entry carries either identifier today, so nothing changes on the current
-- roster; this matters from the first Lynne number import onward.

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
