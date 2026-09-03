-- Section 3 locked rules that live in the database, each asserted.
-- (Pricing, remittance, free entries, naming are covered in 01 + vitest.)

-- Deadline windows: EVERY week 1-18 carries a Wednesday-noon early window
-- and a Friday-noon late window derived from the verified schedule, with
-- deadline_at kept as the late (full-lock) boundary. Week 1 is in the loop
-- deliberately -- it used to be excluded, seeded early = late = Tuesday
-- 2026-09-08 as a special case, and there is no such rule. Its Tuesday
-- deadline is now what it always should have been: the derived Wednesday-game
-- tier, one day before the early window, not a lock on the whole week.
-- Schedule-derived weeks are auto-confirmed.
do $$
declare
  r record;
begin
  for r in select * from weeks where week between 1 and 18 loop
    if to_char(r.early_deadline_at at time zone 'America/New_York', 'Dy HH24:MI') <> 'Wed 12:00' then
      raise exception 'week % early deadline must be Wednesday noon ET, got %', r.week, r.early_deadline_at;
    end if;
    if to_char(r.late_deadline_at at time zone 'America/New_York', 'Dy HH24:MI') <> 'Fri 12:00' then
      raise exception 'week % late deadline must be Friday noon ET, got %', r.week, r.late_deadline_at;
    end if;
    if r.late_deadline_at <> r.early_deadline_at + interval '2 days' then
      raise exception 'week % windows are not the same game week', r.week;
    end if;
    if r.deadline_at <> r.late_deadline_at then
      raise exception 'week % deadline_at must equal the late boundary', r.week;
    end if;
  end loop;

  -- Every week's windows came from the verified schedule -> auto-confirmed.
  if exists (select 1 from weeks where not confirmed) then
    raise exception 'schedule-derived weeks must start confirmed';
  end if;
end $$;

-- Deadline sweep: preview commits nothing; commit applies exactly one loss
-- per pickless alive entry; running twice changes nothing; eliminated and
-- voided entries and entries with picks are untouched. No bye rescue: a
-- bye-eligible entry with no pick still takes the loss.
begin;
do $$
declare
  scratch uuid;
  e_nopick uuid; e_haspick uuid; e_elim uuid; e_void uuid; e_byeel uuid;
  n int;
  before_picks int;
begin
  insert into owners (first_name, last_name) values ('Sweep','Test') returning id into scratch;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 1, 'S nopick') returning id into e_nopick;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 2, 'S haspick') returning id into e_haspick;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 3, 'S elim') returning id into e_elim;
  insert into entries (owner_id, entry_index, entry_name, voided_at) values (scratch, 4, 'S void', now()) returning id into e_void;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 5, 'S byeel') returning id into e_byeel;

  insert into picks (entry_id, week, team, result) values (e_haspick, 6, 'KC', 'pending');
  insert into picks (entry_id, week, team, result) values (e_elim, 1, 'NYG', 'loss');
  insert into picks (entry_id, week, team, result) values (e_elim, 2, 'CHI', 'loss');
  for wk in 1..5 loop
    insert into picks (entry_id, week, team, result) values (e_byeel, wk, 'B' || wk, 'win');
  end loop;
  -- e_byeel is loss-free but has no week 6 pick: it takes the loss (no rescue).

  -- Unconfirmed week: commit refused even before any deadline check.
  -- (Weeks now start confirmed from the schedule; unconfirm to test the guard.)
  update weeks set confirmed = false where week = 6;
  begin
    perform admin_deadline_sweep(6, true, 'test');
    raise exception 'sweep committed for an unconfirmed week';
  exception when others then
    if sqlerrm not like '%not confirmed%' then raise; end if;
  end;
  update weeks set confirmed = true where week = 6;

  -- Sweep commit before the deadline must refuse.
  begin
    perform admin_deadline_sweep(6, true, 'test');
    raise exception 'sweep committed before the deadline';
  exception when others then
    if sqlerrm not like '%has not passed%' then raise; end if;
  end;

  -- Preview: lists candidates, writes nothing.
  select count(*) into before_picks from picks;
  select count(*) into n from admin_deadline_sweep(6, false, 'test')
   where entry_id in (e_nopick, e_haspick, e_elim, e_void, e_byeel);
  if n <> 2 then
    raise exception 'preview should list exactly nopick + byeel of scratch entries, got %', n;
  end if;
  if (select count(*) from picks) <> before_picks then
    raise exception 'preview wrote picks';
  end if;

  -- Pass the LATE deadline (the sweep boundary), commit.
  update weeks set late_deadline_at = now() - interval '1 minute',
                   deadline_at = now() - interval '1 minute'
   where week = 6;
  perform admin_deadline_sweep(6, true, 'test');

  if (select count(*) from picks where entry_id = e_nopick and week = 6 and result = 'missed') <> 1 then
    raise exception 'nopick entry did not take exactly one automatic loss';
  end if;
  if (select count(*) from picks where entry_id = e_byeel and week = 6 and result = 'missed') <> 1 then
    raise exception 'bye-eligible entry must NOT be rescued from a missed pick';
  end if;
  if exists (select 1 from picks where entry_id in (e_elim, e_void) and week = 6) then
    raise exception 'eliminated/voided entries must be untouched';
  end if;
  if (select result from picks where entry_id = e_haspick and week = 6 and is_current) <> 'pending' then
    raise exception 'entry with a pick must be untouched';
  end if;

  -- Idempotent: second run changes nothing.
  select count(*) into before_picks from picks;
  perform admin_deadline_sweep(6, true, 'test');
  if (select count(*) from picks) <> before_picks then
    raise exception 'second sweep changed picks — not idempotent';
  end if;

  -- The missed entry is now at risk (auto loss counted).
  if (select status from v_entry_standing where entry_id = e_nopick) <> 'at_risk' then
    raise exception 'missed pick did not cost a life';
  end if;
end $$;
rollback;

-- Bye guards: not before week 8, not after a week 1-7 loss, not twice.
begin;
do $$
declare
  scratch uuid;
  e1 uuid; e2 uuid; e3 uuid;
begin
  insert into owners (first_name, last_name) values ('Bye','Guard') returning id into scratch;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 1, 'BG clean') returning id into e1;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 2, 'BG lossy') returning id into e2;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 3, 'BG twice') returning id into e3;

  -- Too early.
  begin
    perform admin_submit_pick(e1, 7, 'SKIP_WEEK', 'admin', 'test');
    raise exception 'bye accepted before week 8';
  exception when others then
    if sqlerrm not like '%week%' then raise; end if;
  end;

  -- Clean entry: allowed at week 8.
  for wk in 1..7 loop
    insert into picks (entry_id, week, team, result) values (e1, wk, 'C' || wk, 'win');
  end loop;
  perform admin_submit_pick(e1, 8, 'SKIP_WEEK', 'admin', 'test');
  if (select result from picks where entry_id = e1 and week = 8 and is_current) <> 'bye' then
    raise exception 'earned bye not recorded';
  end if;

  -- Lossy entry: refused.
  insert into picks (entry_id, week, team, result) values (e2, 2, 'NYJ', 'tie_loss');
  begin
    perform admin_submit_pick(e2, 9, 'SKIP_WEEK', 'admin', 'test');
    raise exception 'bye accepted despite an early loss';
  exception when others then
    if sqlerrm not like '%not earned%' then raise; end if;
  end;

  -- Second bye: refused.
  for wk in 1..7 loop
    insert into picks (entry_id, week, team, result) values (e3, wk, 'D' || wk, 'win');
  end loop;
  insert into picks (entry_id, week, team, result) values (e3, 8, 'SKIP_WEEK', 'bye');
  begin
    perform admin_submit_pick(e3, 9, 'SKIP_WEEK', 'admin', 'test');
    raise exception 'second bye accepted';
  exception when others then
    if sqlerrm not like '%already used%' then raise; end if;
  end;
end $$;
rollback;

-- Duplicate team: recorded as submitted (a UI warning, never a database block).
begin;
do $$
declare
  scratch uuid; e uuid;
begin
  insert into owners (first_name, last_name) values ('Dup','Team') returning id into scratch;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 1, 'DT 1') returning id into e;
  perform admin_submit_pick(e, 1, 'KC', 'admin', 'test');
  perform admin_set_result(e, 1, 'win', 'manual', 'test');
  perform admin_submit_pick(e, 2, 'KC', 'admin', 'test');
  if (select count(*) from picks where entry_id = e and team = 'KC' and is_current) <> 2 then
    raise exception 'duplicate team pick was blocked — it must be recorded';
  end if;
end $$;
rollback;
