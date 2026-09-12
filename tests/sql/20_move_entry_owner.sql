-- admin_move_entry_owner: one entry changes hands and nothing else moves.
--
-- The whole point of the function is what it does NOT write, so most of this
-- file asserts absence: the name, the numbering, the gift columns and the
-- week's pick are all read back after the move and compared to what they were
-- before it. A test that only checked owner_id would pass against a function
-- that also renamed the entry, which is the exact damage to avoid -- Lynne
-- holds the name and the number.

-- 1. The move itself, and the eight things it leaves alone.
begin;
do $$
declare
  a uuid; b uuid;
  e1 uuid; e2 uuid;
  before_row entries%rowtype;
  after_row  entries%rowtype;
  v_pick uuid;
  v_audit record;
  v_recruited_before int; v_recruited_after int;
  v_free_before int; v_free_after int;
begin
  select admin_create_owner('Split','Buyer','buyer@x.com','','email','',
         array['Pair #1','Pair #2'], true, 'test') into a;
  select admin_create_owner('Split','Giftee','giftee@x.com','','email','',
         array[]::text[], false, 'test') into b;

  select id into e1 from entries where owner_id = a and entry_index = 1;
  select id into e2 from entries where owner_id = a and entry_index = 2;

  -- Give the moving entry every distinguishing value, plus a live pick, so
  -- the assertions below have something to lose.
  perform admin_update_entry(e2, 'Pair #2', 'Pair #2 label', false, 4242, true,
                             'player@x.com', 'test');
  update weeks set early_deadline_at = now() + interval '2 days',
                   late_deadline_at  = now() + interval '3 days',
                   deadline_at       = now() + interval '3 days'
   where week = 1;
  v_pick := admin_submit_pick(e2, 1, 'KC', 'admin', 'test');

  select * into before_row from entries where id = e2;
  select count(*) filter (where not is_free_entry), count(*) filter (where is_free_entry)
    into v_recruited_before, v_free_before
    from entries where voided_at is null;

  perform admin_move_entry_owner(e2, b,
    'Pair #2 moves from Split Buyer to Split Giftee; they are two people.', 'test');

  select * into after_row from entries where id = e2;

  if after_row.owner_id <> b then
    raise exception 'owner did not move: %', after_row.owner_id;
  end if;
  if after_row.entry_name is distinct from before_row.entry_name then
    raise exception 'entry_name moved: % -> %', before_row.entry_name, after_row.entry_name;
  end if;
  if after_row.name_is_default is distinct from before_row.name_is_default then
    raise exception 'name_is_default moved';
  end if;
  if after_row.lynne_number is distinct from before_row.lynne_number then
    raise exception 'lynne_number moved: % -> %', before_row.lynne_number, after_row.lynne_number;
  end if;
  if after_row.lynne_label is distinct from before_row.lynne_label then
    raise exception 'lynne_label moved: % -> %', before_row.lynne_label, after_row.lynne_label;
  end if;
  if after_row.is_gifted is distinct from before_row.is_gifted then
    raise exception 'is_gifted moved';
  end if;
  if after_row.player_email is distinct from before_row.player_email then
    raise exception 'player_email moved';
  end if;
  if after_row.is_free_entry is distinct from before_row.is_free_entry then
    raise exception 'is_free_entry moved';
  end if;
  if after_row.voided_at is distinct from before_row.voided_at then
    raise exception 'voided_at moved';
  end if;

  -- The pick belongs to the ENTRY and rides along, unchanged and still current.
  if (select count(*) from picks where entry_id = e2 and week = 1) <> 1 then
    raise exception 'the move changed the pick row count';
  end if;
  if (select team from picks where id = v_pick) <> 'KC'
     or not (select is_current from picks where id = v_pick) then
    raise exception 'the week 1 pick did not survive the move intact';
  end if;

  -- The entry that did NOT move stays put.
  if (select owner_id from entries where id = e1) <> a then
    raise exception 'the other entry moved too';
  end if;

  -- Recruited and free counts are untouched, so no entitlement can shift.
  select count(*) filter (where not is_free_entry), count(*) filter (where is_free_entry)
    into v_recruited_after, v_free_after
    from entries where voided_at is null;
  if v_recruited_after <> v_recruited_before or v_free_after <> v_free_before then
    raise exception 'counts moved: recruited % -> %, free % -> %',
      v_recruited_before, v_recruited_after, v_free_before, v_free_after;
  end if;

  -- The audit row, in the same transaction, carrying the note.
  select * into v_audit from audit_log
   where action = 'move_entry_owner' and target_id = e2::text;
  if v_audit is null then
    raise exception 'no move_entry_owner audit row';
  end if;
  if v_audit.note not like '%Split Giftee%' then
    raise exception 'the note did not reach the audit row: %', v_audit.note;
  end if;
  if (v_audit.before ->> 'owner_id') <> a::text
     or (v_audit.after ->> 'owner_id') <> b::text then
    raise exception 'audit before/after do not name both owners';
  end if;
end $$;
rollback;

-- 2. Four refusals. Each writes nothing.
begin;
do $$
declare
  a uuid; b uuid; c uuid; e1 uuid; e2 uuid; ok boolean;
begin
  select admin_create_owner('Ref','A','ra@x.com','','email','',
         array['RA 1','RA 2'], true, 'test') into a;
  select admin_create_owner('Ref','B','rb@x.com','','email','',
         array[]::text[], false, 'test') into b;
  select id into e1 from entries where owner_id = a and entry_index = 1;
  select id into e2 from entries where owner_id = a and entry_index = 2;

  -- A blank note: the reason is the one thing the row cannot reconstruct.
  ok := false;
  begin
    perform admin_move_entry_owner(e2, b, '   ', 'test');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'a blank note was accepted'; end if;
  if (select owner_id from entries where id = e2) <> a then
    raise exception 'the refused move still wrote';
  end if;

  -- The same owner it already has.
  ok := false;
  begin
    perform admin_move_entry_owner(e2, a, 'noop', 'test');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'a move onto the current owner was accepted'; end if;

  -- A voided entry.
  perform admin_void_entry(e1, 'test');
  ok := false;
  begin
    perform admin_move_entry_owner(e1, b, 'voided', 'test');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'a voided entry was moved'; end if;

  -- An archived owner. admin_merge_owner archives its source.
  select admin_create_owner('Ref','C','rc@x.com','','email','',
         array['RC 1'], true, 'test') into c;
  perform admin_merge_owner(c, b, 'test');
  ok := false;
  begin
    perform admin_move_entry_owner(e2, c, 'archived target', 'test');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'an entry was moved onto an archived owner'; end if;
  if (select owner_id from entries where id = e2) <> a then
    raise exception 'a refused move still wrote';
  end if;
end $$;
rollback;

-- 3. The entry_index collision. UNIQUE (owner_id, entry_index) would reject
--    the move outright; the ordinal steps aside and the NAME does not.
begin;
do $$
declare
  a uuid; b uuid; e2 uuid; moved entries%rowtype;
begin
  select admin_create_owner('Coll','A','ca@x.com','','email','',
         array['CA 1','CA 2'], true, 'test') into a;
  -- Two entries, so index 1 AND index 2 are both taken under the target.
  select admin_create_owner('Coll','B','cb@x.com','','email','',
         array['CB 1','CB 2'], true, 'test') into b;
  select id into e2 from entries where owner_id = a and entry_index = 2;

  perform admin_move_entry_owner(e2, b, 'collision case', 'test');

  select * into moved from entries where id = e2;
  if moved.owner_id <> b then raise exception 'move failed on a collision'; end if;
  if moved.entry_index <> 3 then
    raise exception 'expected the next free ordinal 3, got %', moved.entry_index;
  end if;
  if moved.entry_name <> 'CA 2' then
    raise exception 'the ordinal change rewrote the name: %', moved.entry_name;
  end if;
  if (select count(*) from entries where owner_id = b) <> 3 then
    raise exception 'target owner should hold 3 entries';
  end if;
end $$;
rollback;
