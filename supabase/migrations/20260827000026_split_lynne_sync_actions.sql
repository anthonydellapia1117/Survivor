-- Two different promises to Lynne, two different moments:
--   • "here are entries you have never seen"      (the additions email)
--   • "these entries you HAVE are now called X"   (the corrections email)
-- They were stamped by one RPC, so clearing either forced clearing both —
-- and marking a communicated rename would silently stamp unsent entries as
-- sent, dropping late joiners out of the delta before she ever saw them.
-- Split into two independent actions. Batching them is now two clicks, not
-- a constraint.

drop function if exists admin_mark_roster_sent(text);

-- Entries Lynne has never seen become submitted, recorded under the name
-- they went out as. Renamed entries are untouched.
create function admin_mark_new_entries_sent(p_actor text)
returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sent int;
begin
  update entries
     set submitted_to_lynne_at = now(),
         submitted_as_name = entry_name
   where submitted_to_lynne_at is null
     and voided_at is null;
  get diagnostics v_sent = row_count;

  if v_sent > 0 then
    insert into audit_log (actor, action, target_table, after)
    values (p_actor, 'mark_new_entries_sent', 'entries',
            jsonb_build_object('sent', v_sent));
  end if;

  return v_sent;
end $$;

-- Entries she already has, whose corrected names she has now been told:
-- re-record the name she holds. Unsent entries are untouched — critically,
-- the submitted_to_lynne_at IS NOT NULL guard keeps a never-sent entry from
-- being swept in by the null-vs-name "is distinct from" comparison.
create function admin_mark_renames_communicated(p_actor text)
returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_renamed int;
begin
  update entries
     set submitted_as_name = entry_name
   where submitted_to_lynne_at is not null
     and voided_at is null
     and submitted_as_name is distinct from entry_name;
  get diagnostics v_renamed = row_count;

  if v_renamed > 0 then
    insert into audit_log (actor, action, target_table, after)
    values (p_actor, 'mark_renames_communicated', 'entries',
            jsonb_build_object('renamed', v_renamed));
  end if;

  return v_renamed;
end $$;

revoke execute on function admin_mark_new_entries_sent(text) from public;
revoke execute on function admin_mark_renames_communicated(text) from public;

do $$
begin
  revoke execute on function admin_mark_new_entries_sent(text) from anon;
  revoke execute on function admin_mark_renames_communicated(text) from anon;
  grant execute on function admin_mark_new_entries_sent(text) to authenticated;
  grant execute on function admin_mark_renames_communicated(text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
