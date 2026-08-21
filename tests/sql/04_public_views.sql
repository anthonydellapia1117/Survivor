-- Public read views expose exactly the public-safe surface.

do $$
declare
  n int;
  r record;
begin
  select count(*) into n from v_entry_public;
  if n <> 47 then raise exception 'v_entry_public should have 47 rows, got %', n; end if;

  select * into r from v_pot;
  if r.due_cents <> 121000 then raise exception 'v_pot due mismatch: %', r.due_cents; end if;
  if r.paid_cents <> 25000 then raise exception 'v_pot paid mismatch: %', r.paid_cents; end if;
  if r.entry_count <> 47 then raise exception 'v_pot entry_count mismatch: %', r.entry_count; end if;

  -- Acceptance 10: no contact or payment fields on any public view.
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('v_entry_public','v_grid_cells','v_pot','v_public_owners')
    and column_name ~ 'email|phone|amount_paid|venmo|notes|source_ref';
  if n <> 0 then
    raise exception 'public view leaks a private column';
  end if;
end $$;

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
