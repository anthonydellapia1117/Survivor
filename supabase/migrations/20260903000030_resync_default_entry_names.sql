-- An owner's identity gets corrected — wrong person recorded, a spelling fixed,
-- a married name. Their entries that are STILL DEFAULT-NAMED are derived from
-- that owner name, so they are now wrong too: the roster reads "Alec Hess #1"
-- under an owner called Jim Teti.
--
-- Doing it through admin_update_entry would set name_is_default = false, which
-- is wrong the same way it was for the separator conversion: the name is still
-- app-generated, and clearing the flag drops that owner off the list of people
-- who still owe real entry names. So re-derive them here, preserving the flag.
--
-- Scoped to ONE owner on purpose. This is a correction to a specific person's
-- record, not a roster-wide sweep, and a blanket version could only ever be
-- more dangerous.
--
-- Never touches:
--   * entries the owner actually named (name_is_default = false)
--   * free entries — "AAA #n" is the runner's own series and has nothing to do
--     with any owner's name
--   * submitted_as_name — Lynne still holds the ORIGINAL name, so the
--     correction she is owed stays "Alec Hess 1 -> Jim Teti #1", one hop to
--     the final name rather than two stacked renames she never saw.
--
-- Numbering follows entry_index across the owner's live billable entries, so a
-- mixed owner (some named, some default) keeps every entry at its own position.

create function admin_resync_default_entry_names(
  p_owner_id uuid,
  p_actor text,
  p_note text
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_map jsonb;
  v_count int;
  v_full text;
  v_live int;
begin
  select o.first_name || ' ' || o.last_name into v_full
    from owners o where o.id = p_owner_id;
  if v_full is null then
    raise exception 'owner % not found', p_owner_id;
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
end $$;

revoke execute on function admin_resync_default_entry_names(uuid, text, text) from public;

do $$
begin
  revoke execute on function admin_resync_default_entry_names(uuid, text, text) from anon;
  grant execute on function admin_resync_default_entry_names(uuid, text, text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
