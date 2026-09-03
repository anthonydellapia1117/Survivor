-- Record entries that Lynne was told to DELETE and RE-ADD rather than rename.
--
-- The drift model has three states — never sent, renamed since submission,
-- removed since submission — and they all assume a rename on her sheet stays
-- the same row. A substitution can be communicated the other way: on 2026-09-03
-- the four Jim Teti entries went to her as "delete Alec Hess 1-4, add Jim Teti
-- #1-#4", so she has four brand new rows and never renamed anything.
--
-- Marking those as renames communicated would set submitted_as_name correctly
-- but leave submitted_to_lynne_at at the date she received the OLD name, so the
-- app would answer "when did I send you Jim Teti" with the day Alec Hess went
-- out. That timestamp is what a reconciliation against her returned numbers is
-- read from, so it has to say the day the rows actually reached her.
--
-- Takes explicit ids rather than sweeping: this is a surgical correction about
-- what was said in one email, never a state the app can infer on its own. The
-- name Lynne was holding is captured in the audit row, because this write is
-- the moment that association stops being true anywhere else.

create or replace function public.admin_mark_resent_as_new(
  p_entry_ids uuid[], p_actor text, p_note text
) returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_map jsonb;
  v_count int;
  v_bad text;
begin
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    raise exception 'no entries given';
  end if;

  -- Every id must exist, still be live, and be one she already held. Anything
  -- else means the caller has the wrong rows — fail whole rather than half-apply.
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

  with before as (
    select id,
           entry_name,
           submitted_as_name    as old_lynne_name,
           submitted_to_lynne_at as old_sent_at
      from entries
     where id = any(p_entry_ids)
  ),
  upd as (
    update entries e
       set submitted_to_lynne_at = now(),
           submitted_as_name = e.entry_name
      from before b
     where e.id = b.id
    returning e.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'entry', b.entry_name,
           'lynne_held', b.old_lynne_name,
           'previously_sent_at', b.old_sent_at,
           'now_sent_as', b.entry_name) order by b.entry_name), '[]'::jsonb),
         count(*)
    into v_map, v_count
    from before b
    join upd u on u.id = b.id;

  insert into audit_log (actor, action, target_table, note, after)
  values (p_actor, 'mark_resent_as_new', 'entries', p_note,
          jsonb_build_object('resent', v_count, 'mapping', v_map));

  return jsonb_build_object('resent', v_count, 'mapping', v_map);
end $function$;
