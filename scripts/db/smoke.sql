-- Post-migration smoke check. Runs INSIDE the migration's transaction, after
-- a savepoint, and everything it writes is rolled back to that savepoint by
-- whoever is applying the migration (the attended procedure in
-- docs/MERGE_AUTOMATION.md). Any raise here aborts the whole transaction,
-- migration included: that is the point.
--
-- The RPCs check is_admin() through the JWT claims, so the check acts as the
-- admin for the duration of the transaction only.

select set_config('request.jwt.claims',
  '{"email":"anthonydellapia@gmail.com","role":"authenticated"}', true);

do $smoke$
declare
  v_entries   int;
  v_recruited int;
  v_due       bigint;
  v_paid      bigint;
  v_entry     entries%rowtype;
  v_owner     uuid;
  v_scratch   uuid;
  v_week      int;
  v_team      text;
  v_pick      uuid;
  v_entries_after int;
  v_due_after bigint;
  v_paid_after bigint;
  v_due_moved boolean;
  v_paid_moved boolean;
begin
  -- 1. Entry count and money totals still read.
  select count(*), count(*) filter (where not is_free_entry)
    into v_entries, v_recruited
    from entries where voided_at is null;
  select coalesce(sum(amount_due_cents), 0), coalesce(sum(amount_paid_cents), 0)
    into v_due, v_paid
    from v_owner_finance;
  if v_entries < 1 then
    raise exception 'smoke: no live entries read back';
  end if;
  -- The totals are read and compared, never printed: a person reads this log
  -- and pastes it into a report, and the money is admin-only (CLAUDE.md).
  -- tests/unit/smoke-sql.test.ts holds every raise below to that.
  raise notice 'smoke: % live entries (% recruited); money totals read',
    v_entries, v_recruited;

  -- 2. One entry save: an existing entry re-submitted with its own values.
  select * into v_entry from entries where voided_at is null order by created_at limit 1;
  perform admin_update_entry(v_entry.id, v_entry.entry_name, v_entry.lynne_label,
    v_entry.is_free_entry, v_entry.lynne_number, v_entry.is_gifted, v_entry.player_email,
    'post-merge smoke check');
  raise notice 'smoke: entry save ok (%)', v_entry.entry_name;

  -- 3. One pick submit against a scratch entry (rolled back with the savepoint).
  v_owner := admin_create_owner('Smoke', 'Check', 'smoke-check@example.invalid', null,
    'smoke', 'post-merge smoke check; rolled back', array['Smoke Check'], false,
    'post-merge smoke check');
  select id into v_scratch from entries where owner_id = v_owner limit 1;
  if v_scratch is null then
    raise exception 'smoke: scratch entry was not created';
  end if;
  select week into v_week from weeks order by week limit 1;
  select home_team into v_team from nfl_games where week = v_week order by kickoff_at limit 1;
  v_pick := admin_submit_pick(v_scratch, v_week, v_team, 'admin', 'post-merge smoke check');
  if v_pick is null then
    raise exception 'smoke: pick submit returned null';
  end if;
  raise notice 'smoke: scratch pick ok (% week %)', v_team, v_week;

  -- 4. The scratch owner is the only change: everyone else's money is as before.
  select count(*) into v_entries_after from entries where voided_at is null;
  select coalesce(sum(amount_due_cents), 0), coalesce(sum(amount_paid_cents), 0)
    into v_due_after, v_paid_after
    from v_owner_finance where owner_id <> v_owner;
  if v_entries_after < v_entries + 1 then
    raise exception 'smoke: entry count % after the scratch entry, expected at least %',
      v_entries_after, v_entries + 1;
  end if;
  v_due_moved := v_due_after <> v_due;
  v_paid_moved := v_paid_after <> v_paid;
  if v_due_moved or v_paid_moved then
    raise exception 'smoke: money moved for existing owners (due changed: %, paid changed: %)',
      v_due_moved, v_paid_moved;
  end if;
  raise notice 'smoke: ok';
end
$smoke$;
