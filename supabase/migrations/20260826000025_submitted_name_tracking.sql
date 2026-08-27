-- People send real entry names AFTER a batch has already gone to Lynne. Her
-- list then says "Nick DiVirgilio 1" while ours says "Nicky DiVirgilio 1",
-- and when her NUMBERS come back keyed to her names, nothing matches.
--
-- Rather than a bare "renamed since submission" flag, keep THE NAME SHE HAS.
-- The flag is then derived (submitted_as_name <> entry_name) and, unlike a
-- flag, it also answers the two questions a flag leaves open: what exactly
-- to tell her, and what her incoming numbers are keyed to.

alter table entries add column submitted_as_name text;

comment on column entries.submitted_as_name is
  'The entry name as it appeared on the last roster sent to Lynne. Null until
   the entry has been submitted. Differs from entry_name exactly when the
   entry was renamed after submission — that difference is the renamed-after-
   submission signal, and it is what her returned numbers match against.';

-- Backfill: every entry already submitted went out under its current name
-- (the only rename so far, Tommybrads, predates the 2026-08-24 roster).
update entries
   set submitted_as_name = entry_name
 where submitted_to_lynne_at is not null;

-- Return type changes from int to jsonb, so the old signature is dropped.
drop function if exists admin_mark_roster_sent(text);

-- "Lynne's list now matches ours." Stamps entries she has not seen AND
-- re-syncs the recorded name for entries renamed since she got them, in one
-- transaction with its audit row. Invoker rights: the entries RLS policy is
-- the guard, so a non-admin caller changes nothing and gets zeroes back.
create function admin_mark_roster_sent(p_actor text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sent int;
  v_renamed int;
begin
  update entries
     set submitted_to_lynne_at = now(),
         submitted_as_name = entry_name
   where submitted_to_lynne_at is null
     and voided_at is null;
  get diagnostics v_sent = row_count;

  update entries
     set submitted_as_name = entry_name
   where submitted_to_lynne_at is not null
     and voided_at is null
     and submitted_as_name is distinct from entry_name;
  get diagnostics v_renamed = row_count;

  if v_sent > 0 or v_renamed > 0 then
    insert into audit_log (actor, action, target_table, after)
    values (p_actor, 'mark_roster_sent', 'entries',
            jsonb_build_object('sent', v_sent, 'renamed', v_renamed));
  end if;

  return jsonb_build_object('sent', v_sent, 'renamed', v_renamed);
end $$;

revoke execute on function admin_mark_roster_sent(text) from public;

do $$
begin
  revoke execute on function admin_mark_roster_sent(text) from anon;
  grant execute on function admin_mark_roster_sent(text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
