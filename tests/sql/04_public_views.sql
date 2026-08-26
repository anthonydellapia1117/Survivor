-- Public read views expose exactly the public-safe surface.

do $$
declare
  n int;
  r record;
begin
  select count(*) into n from v_entry_public;
  if n <> 47 then raise exception 'v_entry_public should have 47 rows, got %', n; end if;

  -- v_pot carries counts and the pool-wide pot only. The runner's own
  -- collection status (due/paid) must not exist as a column at all.
  select * into r from v_pot;
  if r.entry_count <> 47 then raise exception 'v_pot entry_count mismatch: %', r.entry_count; end if;
  if r.recruited_entry_count <> 47 then
    raise exception 'v_pot recruited_entry_count mismatch: %', r.recruited_entry_count;
  end if;
  if r.pool_entry_count is not null or r.pool_pot_cents is not null then
    raise exception 'pool numbers should start unset (pending)';
  end if;

  -- Free entries are excluded from the recruited count.
  update entries set is_free_entry = true
   where id in (select id from entries where voided_at is null limit 3);
  select * into r from v_pot;
  if r.recruited_entry_count <> 44 then
    raise exception 'free entries must not count as recruited, got %', r.recruited_entry_count;
  end if;
  if r.entry_count <> 47 then
    raise exception 'total entry_count should still be 47, got %', r.entry_count;
  end if;
  update entries set is_free_entry = false;

  -- Acceptance 10: no contact or payment fields on any public view, and no
  -- column carrying THIS group's money in any shape.
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('v_entry_public','v_grid_cells','v_pot','v_public_owners')
    and column_name ~ 'email|phone|amount_paid|venmo|notes|source_ref';
  if n <> 0 then
    raise exception 'public view leaks a private column';
  end if;

  select count(*) into n
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('v_entry_public','v_grid_cells','v_pot','v_public_owners')
    and column_name ~ 'due|paid|collected|amount|owed|remit|margin';
  if n <> 0 then
    raise exception 'a public view carries a money column';
  end if;
end $$;

-- The pool-wide numbers round-trip through the admin RPC and are audited.
begin;
do $$
declare
  r record;
  n int;
begin
  perform admin_set_pool_pot(1250, 3125000, 'test');
  select * into r from v_pot;
  if r.pool_entry_count <> 1250 or r.pool_pot_cents <> 3125000 then
    raise exception 'pool numbers did not save: % / %', r.pool_entry_count, r.pool_pot_cents;
  end if;
  select count(*) into n from audit_log where action = 'set_pool_pot';
  if n <> 1 then raise exception 'set_pool_pot not audited'; end if;

  -- Clearing both puts the card back to pending.
  perform admin_set_pool_pot(null, null, 'test');
  select * into r from v_pot;
  if r.pool_entry_count is not null or r.pool_pot_cents is not null then
    raise exception 'pool numbers did not clear';
  end if;

  begin
    perform admin_set_pool_pot(-1, null, 'test');
    raise exception 'negative pool entry count accepted';
  exception when others then
    if sqlerrm not like '%negative%' then raise; end if;
  end;
end $$;
rollback;

-- A declined owner's entries drop out of the public views.
begin;
do $$
declare
  n int;
begin
  update owners set participation_status = 'declined' where last_name = 'Yost';
  select count(*) into n from v_entry_public;
  if n <> 45 then
    raise exception 'declined owner entries should leave the public view (expected 45, got %)', n;
  end if;
end $$;
rollback;
