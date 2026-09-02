-- The numbering convention has a second case the first pass did not cover.
--
-- A single-entry owner holds the plain name with no number. The moment they
-- buy a second entry the convention says every entry is numbered, so that
-- bare entry has to become "#1" — otherwise the owner reads
-- "Charles Raudenbush / #2 / #3 / #4" and Lynne, who matches by exact name,
-- sees a set with a hole in it.
--
-- Doing this through admin_update_entry would set name_is_default = false,
-- which is wrong twice over: the name is still app-generated, and clearing
-- the flag drops that owner off the list of people who still owe real entry
-- names. So it lives here, alongside the separator conversion, preserving
-- every flag exactly as that one does.
--
-- The rule is deliberately narrow: ONLY an entry whose name is exactly the
-- owner's full name AND is still flagged default. That is the fingerprint of
-- defaultEntryNames(name, 1). An owner-supplied bare name on a multi-entry
-- owner — "Philadelphia Poultry", "E.A.T.", "TNat" — is untouched, because
-- numbering those would be the app inventing a number nobody chose.

create or replace function admin_normalize_entry_numbering(p_actor text, p_note text)
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
    -- Case 1: "Name N" -> "Name #N". Only the separator moves.
    select e.id, e.entry_name as old_name,
           regexp_replace(e.entry_name, '^(.*[^ ]) +([0-9]+)$', '\1 #\2') as new_name
      from entries e
      join multi m on m.owner_id = e.owner_id
     where e.voided_at is null
       and position('#' in e.entry_name) = 0
       and e.entry_name ~ '^.*[^ ] +[0-9]+$'
    union all
    -- Case 2: a former single-entry owner's bare default name -> "Name #1".
    select e.id, e.entry_name, e.entry_name || ' #1'
      from entries e
      join multi m on m.owner_id = e.owner_id
      join owners o on o.id = e.owner_id
     where e.voided_at is null
       and e.name_is_default
       and e.entry_name = o.first_name || ' ' || o.last_name
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
