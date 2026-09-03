-- Guard the default-name generator against an owner name that is blank or
-- carries edge whitespace.
--
-- admin_resync_default_entry_names built the entry name straight from
-- `first_name || ' ' || last_name`. Two ways that produces a name Lynne cannot
-- match, neither of which the old `v_full is null` check caught:
--
--   * edge whitespace — "DellaPia Jr. " yields "Ernie DellaPia Jr.  #1" with a
--     doubled space, a different string to her than the one on her sheet;
--   * both parts blank — yields a bare " #1", which is not a name at all.
--
-- The NULL case the check was written for cannot occur: owners.first_name and
-- owners.last_name are both NOT NULL. Worse, when the check did fire it
-- reported 'owner % not found', sending the reader after a row that exists.
--
-- So: trim each part before joining, refuse outright when nothing is left, and
-- keep 'not found' meaning genuinely not found. Internal spacing stays the
-- owner's, per the naming convention — only the edges are touched, and only in
-- the generated entry name. The owners row itself is never rewritten here.

create or replace function public.admin_resync_default_entry_names(
  p_owner_id uuid, p_actor text, p_note text
) returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_map jsonb;
  v_count int;
  v_first text;
  v_last text;
  v_full text;
  v_live int;
begin
  select o.first_name, o.last_name into v_first, v_last
    from owners o where o.id = p_owner_id;
  if not found then
    raise exception 'owner % not found', p_owner_id;
  end if;

  v_full := btrim(btrim(coalesce(v_first, '')) || ' ' || btrim(coalesce(v_last, '')));
  if v_full = '' then
    raise exception
      'owner % has no usable name (first_name %, last_name %) — cannot build default entry names',
      p_owner_id, quote_literal(coalesce(v_first, '')), quote_literal(coalesce(v_last, ''));
  end if;

  select count(*) into v_live
    from entries
   where owner_id = p_owner_id and voided_at is null and not is_free_entry;

  with ranked as (
    select e.id, e.entry_name as old_name, e.name_is_default,
           row_number() over (order by e.entry_index) as rn
      from entries e
     where e.owner_id = p_owner_id
       and e.voided_at is null
       and not e.is_free_entry
  ),
  target as (
    select id, old_name,
           case when v_live = 1 then v_full else v_full || ' #' || rn end as new_name
      from ranked
     where name_is_default
  ),
  upd as (
    update entries e
       set entry_name = t.new_name
      from target t
     where e.id = t.id
       and e.entry_name is distinct from t.new_name
    returning t.old_name, t.new_name,
              e.submitted_as_name,
              e.submitted_to_lynne_at is not null as lynne_has_it
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'from', old_name, 'to', new_name,
           'lynne_holds', submitted_as_name,
           'lynne_has_it', lynne_has_it) order by new_name), '[]'::jsonb),
         count(*)
    into v_map, v_count
    from upd;

  if v_count > 0 then
    insert into audit_log (actor, action, target_table, target_id, note, after)
    values (p_actor, 'resync_default_entry_names', 'entries', p_owner_id::text,
            p_note, jsonb_build_object('owner', v_full, 'renamed', v_count,
                                       'mapping', v_map));
  end if;

  return jsonb_build_object('owner', v_full, 'renamed', v_count, 'mapping', v_map);
end $function$;
