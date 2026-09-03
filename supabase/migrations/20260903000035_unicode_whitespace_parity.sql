-- Use one whitespace definition in both name generators.
--
-- JavaScript String.prototype.trim() strips the full Unicode whitespace set:
-- non-breaking space (U+00A0), the U+2000 block, the BOM. PostgreSQL's
-- one-argument btrim() strips ONLY the ASCII space. So a last name pasted out
-- of an email with a trailing U+00A0 gave:
--
--   app  ownerFullName("Ernie", "DellaPia\u00A0") -> "Ernie DellaPia"
--   sql  btrim("DellaPia\u00A0")                  -> "DellaPia\u00A0"
--                                                  -> "Ernie DellaPia\u00A0 #1"
--
-- the same app-vs-RPC drift on the string Lynne matches that the
-- component-trimming fix was meant to end, one character class further out.
--
-- trim_name_ws spells the set out and mirrors the ECMAScript definition of
-- WhiteSpace + LineTerminator, so the two layers agree by construction rather
-- than by coincidence. Pure text, no data access, so deliberately not
-- admin-gated.

create or replace function public.trim_name_ws(p text) returns text
language sql
immutable
strict
set search_path to 'public', 'pg_temp'
as $fn$
  select btrim(p, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')
$fn$;

comment on function public.trim_name_ws(text) is
  'Edge-trim a name using the same whitespace set as JavaScript String.trim(), so app-generated and RPC-generated entry names agree. Spacing INSIDE the value is untouched - that belongs to the owner.';

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

  v_full := trim_name_ws(
              trim_name_ws(coalesce(v_first, '')) || ' ' ||
              trim_name_ws(coalesce(v_last, '')));
  if v_full = '' then
    raise exception
      'owner % has no usable name (first_name %, last_name %) - cannot build default entry names',
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
