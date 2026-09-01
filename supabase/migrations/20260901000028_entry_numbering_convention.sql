-- Anthony's entry-name numbering convention, applied to the whole roster.
--
--   an owner with MORE THAN ONE entry:  "Name #1", "Name #2" — space, hash,
--                                        digit, nothing between hash and digit
--   an owner with exactly ONE entry:     the plain name, no hash, no number
--
-- Only the SEPARATOR changes. Case, spelling and spacing inside the name are
-- untouched, so "Tommybrads 1"/"tommybrads 2" become "Tommybrads #1"/
-- "tommybrads #2" and stay a flagged near-collision, which is the point.
--
-- This is ANTHONY'S normalization, not the app's. It runs once, on his
-- instruction, and records the complete old -> new mapping in its audit row
-- because Lynne holds the OLD names and has to be sent the corrections.
--
-- Deliberately NOT done here:
--   * name_is_default is PRESERVED. A separator change is not the owner
--     supplying a real name — 18 entries across five owners are still
--     awaiting one, and the generic admin_update_entry would have cleared
--     that flag and lost the list of who still owes names.
--   * submitted_as_name is PRESERVED, so every already-submitted entry
--     lands in the rename-pending state on its own.
--   * lynne_number / lynne_label are untouched.
--   * Names with no trailing number ("Philadelphia Poultry", "TNat") are
--     left alone — there is no separator to change, and inventing a number
--     would be the app deciding.

create function admin_normalize_entry_numbering(p_actor text, p_note text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_map jsonb;
  v_count int;
begin
  with multi as (
    select owner_id
      from entries
     where voided_at is null
     group by owner_id
    having count(*) > 1
  ),
  target as (
    select e.id, e.entry_name as old_name,
           regexp_replace(e.entry_name, '^(.*[^ ]) +([0-9]+)$', '\1 #\2') as new_name
      from entries e
      join multi m on m.owner_id = e.owner_id
     where e.voided_at is null
       and position('#' in e.entry_name) = 0      -- already converted, skip
       and e.entry_name ~ '^.*[^ ] +[0-9]+$'      -- has a trailing " N"
  ),
  upd as (
    update entries e
       set entry_name = t.new_name
      from target t
     where e.id = t.id
    returning t.old_name, t.new_name,
              (select o.first_name || ' ' || o.last_name
                 from owners o where o.id = e.owner_id) as owner_name,
              e.submitted_to_lynne_at is not null as lynne_has_it
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'owner', owner_name, 'from', old_name, 'to', new_name,
           'lynne_has_it', lynne_has_it) order by owner_name, new_name), '[]'::jsonb),
         count(*)
    into v_map, v_count
    from upd;

  if v_count > 0 then
    insert into audit_log (actor, action, target_table, note, after)
    values (p_actor, 'normalize_entry_numbering', 'entries', p_note,
            jsonb_build_object('renamed', v_count, 'mapping', v_map));
  end if;

  return jsonb_build_object('renamed', v_count, 'mapping', v_map);
end $$;

revoke execute on function admin_normalize_entry_numbering(text, text) from public;

do $$
begin
  revoke execute on function admin_normalize_entry_numbering(text, text) from anon;
  grant execute on function admin_normalize_entry_numbering(text, text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
