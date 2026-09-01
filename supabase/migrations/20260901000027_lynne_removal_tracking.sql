-- The third way our roster drifts from Lynne's copy.
--
-- Two were already tracked: entries she has never seen (submitted_to_lynne_at
-- is null) and entries she has under a stale name (submitted_as_name differs).
-- The third is an entry she HAS that we have since killed — someone asks out
-- after the roster went over. Voiding it removed it from our side and from
-- every roster view, because those views filter voided entries out first, so
-- the one fact that still needed an email — "pull these four off your sheet"
-- — became the only drift the app could not show. Her sheet then carries live
-- entries nobody is picking for, and their numbers come back unmatched.
--
-- Same shape as the other two: record the moment she was told, derive the
-- pending set, and keep the stamp INDEPENDENT of the send and rename stamps —
-- three different emails, three different moments.

alter table entries add column removal_communicated_at timestamptz;

comment on column entries.removal_communicated_at is
  'When Lynne was told to drop this entry from her sheet. Only meaningful for
   an entry that is voided AND was previously submitted: she holds it, we do
   not. Null on such an entry means the removal email still owes to be sent.
   Stays null forever on entries she never received — there is nothing to
   tell her about those.';

-- No backfill: at the time of this migration no entry is voided at all, so
-- there is no historical removal that could be wrongly marked as already
-- communicated. A backfill here would have to invent a date.

-- "I told Lynne to pull these." Touches only entries she actually has and we
-- have voided. New sends and renames are untouched — the same independence
-- the send/rename split established. Invoker rights: the entries RLS policy
-- (is_admin() FOR ALL) is the guard, so a non-admin caller updates nothing
-- and gets zero back rather than an unaudited partial write.
create function admin_mark_removals_communicated(p_actor text)
returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_removed int;
begin
  update entries
     set removal_communicated_at = now()
   where voided_at is not null
     and submitted_to_lynne_at is not null
     and removal_communicated_at is null;
  get diagnostics v_removed = row_count;

  if v_removed > 0 then
    insert into audit_log (actor, action, target_table, after)
    values (p_actor, 'mark_removals_communicated', 'entries',
            jsonb_build_object('removed', v_removed));
  end if;

  return v_removed;
end $$;

revoke execute on function admin_mark_removals_communicated(text) from public;

do $$
begin
  revoke execute on function admin_mark_removals_communicated(text) from anon;
  grant execute on function admin_mark_removals_communicated(text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
