-- v_entry_standing serves LIVE entries only: its row count is the live entry
-- count, and a voided entry is in it under no status at all.
--
-- Found by Anthony on 2026-09-15: production returned 130 rows against 121
-- live entries, nine voided entries counted as active. Every reader filtered
-- voided_at on its own side, so no public figure was wrong; the view itself
-- was, and so was any tally read straight off it. 20260915000077 puts the
-- filter in the view's scored CTE.
--
-- The seed carries no voided entry, so block 1 alone passes against the old
-- view. Block 2 voids one through admin_void_entry, the audited RPC the app
-- uses, and is the assertion that FAILS without the migration; block 3 shows
-- the same failure as a status tally, which is how Anthony saw it.

-- 1. The view's row count equals the live entry count, as seeded.
begin;
do $$
declare
  v_live int; v_view int;
begin
  select count(*) into v_live from entries where voided_at is null;
  select count(*) into v_view from v_entry_standing;
  if v_live < 1 then
    raise exception 'seed has no live entries; nothing to compare';
  end if;
  if v_view <> v_live then
    raise exception 'v_entry_standing returns % rows against % live entries', v_view, v_live;
  end if;
  raise notice 'entry standing: % rows, % live entries', v_view, v_live;
end $$;
rollback;

-- 2. Void one entry through the RPC: the view drops exactly that row and the
--    equality still holds. Rolled back with the block.
begin;
do $$
declare
  v_target uuid; v_name text;
  v_live_before int; v_view_before int;
  v_live_after int; v_view_after int;
  v_dead_rows int;
begin
  select count(*) into v_live_before from entries where voided_at is null;
  select count(*) into v_view_before from v_entry_standing;
  if v_view_before <> v_live_before then
    raise exception 'before the void: v_entry_standing returns % rows against % live entries',
      v_view_before, v_live_before;
  end if;

  select id, entry_name into v_target, v_name
    from entries where voided_at is null order by entry_name, id limit 1;
  perform admin_void_entry(v_target, 'test');

  if exists (select 1 from v_entry_standing where entry_id = v_target) then
    raise exception 'voided entry "%" is still in v_entry_standing', v_name;
  end if;

  select count(*) into v_live_after from entries where voided_at is null;
  select count(*) into v_view_after from v_entry_standing;
  if v_live_after <> v_live_before - 1 then
    raise exception 'admin_void_entry did not void exactly one entry: % live before, % after',
      v_live_before, v_live_after;
  end if;
  if v_view_after <> v_live_after then
    raise exception 'after the void: v_entry_standing returns % rows against % live entries',
      v_view_after, v_live_after;
  end if;

  -- And nothing voided is left in it under any status, not only the one
  -- just voided.
  select count(*) into v_dead_rows
    from v_entry_standing s
    join entries e on e.id = s.entry_id
   where e.voided_at is not null;
  if v_dead_rows <> 0 then
    raise exception 'v_entry_standing carries % voided entries', v_dead_rows;
  end if;
  raise notice 'entry standing: "%" voided and gone from the view, % rows against % live',
    v_name, v_view_after, v_live_after;
end $$;
rollback;

-- 3. The buckets. A scratch owner gets four entries: one with a stored loss
--    (at_risk), one with two (eliminated), one with no pick (active), and one
--    with a stored loss that is then VOIDED. active + at_risk + eliminated +
--    bye_eligible must equal the live count, at_risk and eliminated must each
--    have moved by exactly one, and the voided loser must count nowhere.
--    Under the old view the voided loser was one more at_risk row and the sum
--    was live + 1. The live count is read AFTER the inserts rather than
--    computed from before them, because the mint_free_entries trigger may add
--    a free entry when recruited crosses a multiple of the ratio, and that
--    entry is live too.
begin;
do $$
declare
  scratch uuid;
  e_loss uuid; e_out uuid; e_none uuid; e_void uuid;
  v_at_risk_before int; v_elim_before int;
  v_live int; v_active int; v_at_risk int; v_elim int; v_bye int; v_sum int;
begin
  select count(*) filter (where status = 'at_risk'), count(*) filter (where status = 'eliminated')
    into v_at_risk_before, v_elim_before
    from v_entry_standing;

  insert into owners (first_name, last_name) values ('Scratch','Standing') returning id into scratch;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 1, 'S loss') returning id into e_loss;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 2, 'S out')  returning id into e_out;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 3, 'S none') returning id into e_none;
  insert into entries (owner_id, entry_index, entry_name) values (scratch, 4, 'S void') returning id into e_void;

  insert into picks (entry_id, week, team, result) values (e_loss, 1, 'NYJ', 'loss');
  insert into picks (entry_id, week, team, result) values (e_out, 1, 'NYG', 'loss');
  insert into picks (entry_id, week, team, result) values (e_out, 2, 'CHI', 'loss');
  insert into picks (entry_id, week, team, result) values (e_void, 1, 'CAR', 'loss');
  perform admin_void_entry(e_void, 'test');

  select count(*) into v_live from entries where voided_at is null;
  select
    count(*) filter (where status = 'active'),
    count(*) filter (where status = 'at_risk'),
    count(*) filter (where status = 'eliminated'),
    count(*) filter (where status = 'bye_eligible'),
    count(*)
    into v_active, v_at_risk, v_elim, v_bye, v_sum
    from v_entry_standing;

  if v_sum <> v_active + v_at_risk + v_elim + v_bye then
    raise exception 'a status outside the four buckets: % rows, % active + % at_risk + % eliminated + % bye_eligible',
      v_sum, v_active, v_at_risk, v_elim, v_bye;
  end if;
  if v_sum <> v_live then
    raise exception 'buckets sum to % against % live entries (active %, at_risk %, eliminated %, bye_eligible %)',
      v_sum, v_live, v_active, v_at_risk, v_elim, v_bye;
  end if;
  if v_at_risk <> v_at_risk_before + 1 then
    raise exception 'at_risk moved from % to %; one live loser and one voided loser should move it by exactly one',
      v_at_risk_before, v_at_risk;
  end if;
  if v_elim <> v_elim_before + 1 then
    raise exception 'eliminated moved from % to %, expected exactly one more', v_elim_before, v_elim;
  end if;
  if exists (select 1 from v_entry_standing where entry_id = e_void) then
    raise exception 'the voided loser is in v_entry_standing';
  end if;
  raise notice 'entry standing: % live = % active + % at_risk + % eliminated + % bye_eligible',
    v_live, v_active, v_at_risk, v_elim, v_bye;
end $$;
rollback;
