-- Week deadline confirmation. Weeks 2-18 were seeded from the standard NFL
-- pattern, not from the released schedule — a guess must never silently
-- produce an automatic loss. Each week now carries a confirmed flag:
--  * only the admin can set it, via the audited RPC below;
--  * the deadline sweep REFUSES to commit for an unconfirmed week.
-- Week 1 (Tue 2026-09-08 12:00 PM ET) is locked by the spec -> confirmed.

alter table weeks add column confirmed boolean not null default false;
update weeks set confirmed = true where week = 1;

create or replace function admin_update_week(
  p_week int,
  p_window_label text,
  p_deadline_at timestamptz,
  p_confirmed boolean,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if p_window_label not in ('thu_fri', 'sat_mon') then
    raise exception 'window must be thu_fri or sat_mon';
  end if;

  select to_jsonb(w) into v_before from weeks w where w.week = p_week;
  if v_before is null then
    raise exception 'week % does not exist', p_week;
  end if;

  update weeks
     set window_label = p_window_label,
         deadline_at = p_deadline_at,
         confirmed = p_confirmed
   where week = p_week;

  select to_jsonb(w) into v_after from weeks w where w.week = p_week;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'update_week', 'weeks', p_week::text, v_before, v_after);
end $$;

-- Sweep guard: an unconfirmed deadline may be previewed but never committed.
create or replace function admin_deadline_sweep(
  p_week int,
  p_commit boolean,
  p_actor text
) returns table (entry_id uuid, entry_name text, owner_name text)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_deadline timestamptz;
  v_confirmed boolean;
  v_count int := 0;
  r record;
begin
  select w.deadline_at, w.confirmed into v_deadline, v_confirmed
    from weeks w where w.week = p_week;
  if v_deadline is null then
    raise exception 'week % does not exist', p_week;
  end if;
  if p_commit and not v_confirmed then
    raise exception 'week % deadline is not confirmed — confirm it on the Weeks screen before sweeping', p_week;
  end if;
  if p_commit and now() <= v_deadline then
    raise exception 'week % deadline has not passed; sweep cannot commit', p_week;
  end if;

  drop table if exists _sweep;
  create temp table _sweep on commit drop as
  select e.id as entry_id,
         e.entry_name,
         o.first_name || ' ' || o.last_name as owner_name
  from entries e
  join owners o on o.id = e.owner_id
  join v_entry_standing s on s.entry_id = e.id
  where o.participation_status = 'confirmed'
    and e.voided_at is null
    and s.status <> 'eliminated'
    and not exists (
      select 1 from picks p
      where p.entry_id = e.id and p.week = p_week and p.is_current
    );

  if p_commit then
    for r in select * from _sweep loop
      insert into picks (entry_id, week, team, source, late, result, result_source, submitted_at)
      values (r.entry_id, p_week, 'MISSED', 'admin', false, 'missed', 'manual', now());
      insert into audit_log (actor, action, target_table, target_id, after)
      values (p_actor, 'deadline_sweep_miss', 'picks', r.entry_id::text,
              jsonb_build_object('week', p_week, 'entry_name', r.entry_name));
      v_count := v_count + 1;
    end loop;
    insert into audit_log (actor, action, target_table, target_id, note)
    values (p_actor, 'deadline_sweep', 'picks', p_week::text,
            format('week %s sweep: %s automatic losses', p_week, v_count));
  end if;

  return query select * from _sweep;
end $$;

do $$
begin
  execute 'revoke execute on function admin_update_week(int,text,timestamptz,boolean,text) from public';
  begin
    execute 'revoke execute on function admin_update_week(int,text,timestamptz,boolean,text) from anon';
    execute 'grant execute on function admin_update_week(int,text,timestamptz,boolean,text) to authenticated';
  exception when undefined_object then
    null;
  end;
end $$;
