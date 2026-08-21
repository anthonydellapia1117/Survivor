-- Rules engine: the missed-pick deadline sweep, and bye submission guards.

-- Bye guards (spec section 3, locked):
--   SKIP_WEEK is submitted explicitly, week 8 or later, and only by an entry
--   that stayed loss-free through week 7 and has not already used its bye.
create or replace function admin_submit_pick(
  p_entry_id uuid,
  p_week int,
  p_team text,
  p_source text,
  p_actor text
) returns uuid
language plpgsql
as $$
declare
  v_deadline timestamptz;
  v_old_id uuid;
  v_new_id uuid;
  v_double_through int;
  v_losses int;
  v_bye_used boolean;
begin
  select deadline_at into v_deadline from weeks where week = p_week;
  if v_deadline is null then
    raise exception 'week % does not exist', p_week;
  end if;

  if p_team = 'SKIP_WEEK' then
    select double_elim_through_week into v_double_through from config;
    if p_week <= v_double_through then
      raise exception 'bye may only be used from week % on', v_double_through + 1;
    end if;
    select count(*) filter (where p.result in ('loss','tie_loss','missed') and p.week <= v_double_through),
           bool_or(p.team = 'SKIP_WEEK')
      into v_losses, v_bye_used
      from picks p
     where p.entry_id = p_entry_id and p.is_current;
    if coalesce(v_losses, 0) > 0 then
      raise exception 'bye not earned: entry took a loss in weeks 1-%', v_double_through;
    end if;
    if coalesce(v_bye_used, false) then
      raise exception 'bye already used';
    end if;
  end if;

  select id into v_old_id from picks
   where entry_id = p_entry_id and week = p_week and is_current;

  if v_old_id is not null then
    update picks set is_current = false where id = v_old_id;
  end if;

  insert into picks (entry_id, week, team, source, supersedes_id, late, result)
  values (p_entry_id, p_week, p_team,
          coalesce(nullif(p_source, ''), 'admin'),
          v_old_id,
          now() > v_deadline,
          case when p_team = 'SKIP_WEEK' then 'bye' else 'pending' end)
  returning id into v_new_id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor,
          case when v_old_id is null then 'submit_pick' else 'override_pick' end,
          'picks', v_new_id::text,
          jsonb_build_object('entry_id', p_entry_id, 'week', p_week,
                             'team', p_team, 'supersedes', v_old_id));
  return v_new_id;
end $$;

-- Missed-pick sweep (spec: automatic loss at deadline, no confirmation, no
-- grace period, no bye rescue — but never run without an explicit click).
-- Preview any time with p_commit = false; committing requires the deadline
-- to have passed. Idempotent: an entry with any current pick for the week
-- (including a prior MISSED) is skipped, so running twice changes nothing.
create or replace function admin_deadline_sweep(
  p_week int,
  p_commit boolean,
  p_actor text
) returns table (entry_id uuid, entry_name text, owner_name text)
language plpgsql
as $$
declare
  v_deadline timestamptz;
  v_count int := 0;
  r record;
begin
  select deadline_at into v_deadline from weeks w where w.week = p_week;
  if v_deadline is null then
    raise exception 'week % does not exist', p_week;
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
  execute 'revoke execute on function admin_deadline_sweep(int,boolean,text) from public';
  begin
    execute 'revoke execute on function admin_deadline_sweep(int,boolean,text) from anon, authenticated';
  exception when undefined_object then
    null;
  end;
end $$;
