-- Track which entries have been submitted to Lynne, so late joiners can be
-- exported as a delta ("new since last send") instead of re-sending the full
-- roster. Null = she has not seen it yet.

alter table entries add column submitted_to_lynne_at timestamptz;

-- Backfill: the 75-entry roster was emailed to Lynne on 2026-08-24 at
-- 23:23:18 UTC (7:23 PM ET) and she confirmed receipt the same evening.
-- Every entry that existed then is stamped with the real send time.
update entries
   set submitted_to_lynne_at = '2026-08-24 23:23:18+00'
 where voided_at is null;

-- Stamp everything currently unsent as submitted now. Invoker rights: RLS on
-- entries (is_admin() FOR ALL) is the guard — a non-admin caller updates
-- nothing and the zero-count is returned, never an unaudited partial write.
create or replace function admin_mark_roster_sent(p_actor text)
returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  update entries
     set submitted_to_lynne_at = now()
   where submitted_to_lynne_at is null
     and voided_at is null;

  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into audit_log (actor, action, target_table, after)
    values (p_actor, 'mark_roster_sent', 'entries',
            jsonb_build_object('count', v_count));
  end if;

  return v_count;
end $$;

revoke execute on function admin_mark_roster_sent(text) from public;

do $$
begin
  revoke execute on function admin_mark_roster_sent(text) from anon;
  grant execute on function admin_mark_roster_sent(text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
