-- V2 Part H: owners are never deleted, only merged — plus Part C's
-- lynne_number. An owner row holding entries or payments can only be
-- archived (deleted_at) after its holdings move; the ledger stays
-- append-only, so moving a payment is a reversal + repost pair, never an
-- UPDATE. Every owner-reading view filters archived shells out.

alter table owners add column deleted_at timestamptz;
alter table owners add column merged_into_owner_id uuid references owners(id);

-- Lynne assigns every entry a number; it is how she matches everything.
alter table entries add column lynne_number int;
create unique index entries_lynne_number_key
  on entries (lynne_number) where lynne_number is not null;

-- Corrections reference their original via corrects_payment_id and are
-- exempt from the txn-id uniqueness; a genuinely new inbound transaction
-- still lands exactly once.
alter table payments drop constraint payments_venmo_txn_id_key;
create unique index payments_venmo_txn_id_key
  on payments (venmo_txn_id)
  where corrects_payment_id is null and venmo_txn_id is not null;

-- ---------------------------------------------------------------- views
-- Same shapes as before, now excluding archived owners everywhere.

create or replace view v_owner_finance as
select
  o.id as owner_id,
  count(e.id) as entry_count,
  count(e.id) filter (where not e.is_free_entry) as paid_entry_count,
  case when count(e.id) filter (where not e.is_free_entry) >= 4
       then count(e.id) filter (where not e.is_free_entry) * c.tier_4plus_cents
       else count(e.id) filter (where not e.is_free_entry) * c.tier_1_3_cents
  end as amount_due_cents,
  coalesce((select sum(p.amount_cents) from payments p where p.owner_id = o.id), 0) as amount_paid_cents
from owners o
left join entries e on e.owner_id = o.id and e.voided_at is null
cross join config c
where o.participation_status = 'confirmed'
  and o.deleted_at is null
group by o.id, c.tier_1_3_cents, c.tier_4plus_cents;

create or replace view v_public_owners as
select id, first_name, last_name
from owners
where participation_status = 'confirmed'
  and deleted_at is null;

create or replace view v_entry_public as
select
  e.id,
  e.entry_name,
  e.name_is_default,
  e.is_free_entry,
  e.owner_id,
  o.first_name || ' ' || o.last_name as owner_name,
  s.wins,
  s.losses,
  s.lives_remaining,
  s.status,
  s.bye_used,
  s.teams_used,
  s.last_scored_week
from entries e
join owners o on o.id = e.owner_id
join v_entry_standing s on s.entry_id = e.id
where o.participation_status = 'confirmed'
  and o.deleted_at is null
  and e.voided_at is null;

create or replace view v_pot as
select
  coalesce(sum(f.amount_due_cents), 0)::bigint as due_cents,
  coalesce(sum(f.amount_paid_cents), 0)::bigint as paid_cents,
  (select count(*)
     from entries e
     join owners o on o.id = e.owner_id
    where o.participation_status = 'confirmed'
      and o.deleted_at is null
      and e.voided_at is null)::int as entry_count
from v_owner_finance f;

-- ----------------------------------------------------------------- RPCs

-- Hard delete: ONLY the genuine-typo case — zero entries, zero payments.
create or replace function admin_delete_owner(
  p_owner_id uuid,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
begin
  select to_jsonb(o) into v_before from owners o where o.id = p_owner_id;
  if v_before is null then
    raise exception 'owner % not found', p_owner_id;
  end if;
  if exists (select 1 from entries where owner_id = p_owner_id) then
    raise exception 'owner holds entries — merge instead of deleting';
  end if;
  if exists (select 1 from payments where owner_id = p_owner_id) then
    raise exception 'owner holds payments — merge instead of deleting';
  end if;

  insert into audit_log (actor, action, target_table, target_id, before)
  values (p_actor, 'delete_owner', 'owners', p_owner_id::text, v_before);
  delete from owners where id = p_owner_id;
end $$;

-- Merge source into target. Entries reassign; each payment is reversed
-- against the source and reposted against the target (both referencing the
-- original); the source becomes an archived shell. Nothing is lost.
create or replace function admin_merge_owner(
  p_source uuid,
  p_target uuid,
  p_actor text
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_source owners%rowtype;
  v_target owners%rowtype;
  v_entries int;
  v_pay record;
  v_moved_cents bigint := 0;
  v_moved_count int := 0;
begin
  if p_source = p_target then
    raise exception 'cannot merge an owner into itself';
  end if;
  select * into v_source from owners where id = p_source;
  if v_source.id is null then raise exception 'source owner not found'; end if;
  select * into v_target from owners where id = p_target;
  if v_target.id is null then raise exception 'target owner not found'; end if;
  if v_source.deleted_at is not null then
    raise exception 'source owner is already archived';
  end if;
  if v_target.deleted_at is not null then
    raise exception 'target owner is archived — pick a live target';
  end if;
  if exists (select 1 from owners where merged_into_owner_id = p_source) then
    raise exception 'owner has already absorbed a merge and cannot be merged away';
  end if;

  select count(*) into v_entries from entries where owner_id = p_source;

  -- Genuine typo case: nothing held, hard delete.
  if v_entries = 0
     and not exists (select 1 from payments where owner_id = p_source) then
    insert into audit_log (actor, action, target_table, target_id, before, note)
    values (p_actor, 'merge_owner', 'owners', p_source::text, to_jsonb(v_source),
            format('empty owner deleted during merge into %s', p_target));
    delete from owners where id = p_source;
    return jsonb_build_object('deleted', true, 'entries_moved', 0, 'payments_moved', 0);
  end if;

  -- Append-only payment move: reversal on the source, repost on the target.
  for v_pay in
    select * from payments where owner_id = p_source order by created_at
  loop
    insert into payments (owner_id, amount_cents, method, paid_on,
                          venmo_txn_id, note, corrects_payment_id)
    values (p_source, -v_pay.amount_cents, 'correction', v_pay.paid_on,
            v_pay.venmo_txn_id,
            format('merge reversal → %s %s', v_target.first_name, v_target.last_name),
            v_pay.id);
    insert into payments (owner_id, amount_cents, method, paid_on,
                          venmo_txn_id, note, corrects_payment_id)
    values (p_target, v_pay.amount_cents, v_pay.method, v_pay.paid_on,
            v_pay.venmo_txn_id,
            format('merge repost ← %s %s', v_source.first_name, v_source.last_name),
            v_pay.id);
    v_moved_cents := v_moved_cents + v_pay.amount_cents;
    v_moved_count := v_moved_count + 1;
  end loop;

  -- Reassign entries, renumbering after the target's last index so the
  -- (owner_id, entry_index) uniqueness holds; relative order is kept.
  with base as (
    select coalesce(max(entry_index), 0) as m from entries where owner_id = p_target
  ), ordered as (
    select e.id, row_number() over (order by e.entry_index, e.created_at) as rn
    from entries e where e.owner_id = p_source
  )
  update entries e
     set owner_id = p_target,
         entry_index = base.m + ordered.rn
    from ordered, base
   where e.id = ordered.id;

  update owners
     set deleted_at = now(),
         merged_into_owner_id = p_target
   where id = p_source;

  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'merge_owner', 'owners', p_source::text,
          to_jsonb(v_source), to_jsonb(v_target),
          format('%s entries and %s payments (%s cents) moved to %s %s',
                 v_entries, v_moved_count, v_moved_cents,
                 v_target.first_name, v_target.last_name));

  return jsonb_build_object('deleted', false, 'entries_moved', v_entries,
                            'payments_moved', v_moved_count,
                            'cents_moved', v_moved_cents);
end $$;

-- admin_update_entry gains lynne_number (6-arg form); the 5-arg form stays
-- for the currently deployed app and delegates.
create or replace function admin_update_entry(
  p_entry_id uuid,
  p_entry_name text,
  p_lynne_label text,
  p_is_free boolean,
  p_lynne_number int,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select to_jsonb(e) - 'created_at' into v_before from entries e where id = p_entry_id;
  if v_before is null then
    raise exception 'entry % not found', p_entry_id;
  end if;

  update entries
     set entry_name = p_entry_name,
         name_is_default = false,
         lynne_label = nullif(p_lynne_label, ''),
         is_free_entry = coalesce(p_is_free, is_free_entry),
         lynne_number = p_lynne_number
   where id = p_entry_id;

  select to_jsonb(e) - 'created_at' into v_after from entries e where id = p_entry_id;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'update_entry', 'entries', p_entry_id::text, v_before, v_after);
end $$;

do $$
begin
  execute 'revoke execute on function admin_delete_owner(uuid,text) from public';
  execute 'revoke execute on function admin_merge_owner(uuid,uuid,text) from public';
  execute 'revoke execute on function admin_update_entry(uuid,text,text,boolean,int,text) from public';
  begin
    execute 'revoke execute on function admin_delete_owner(uuid,text) from anon';
    execute 'revoke execute on function admin_merge_owner(uuid,uuid,text) from anon';
    execute 'revoke execute on function admin_update_entry(uuid,text,text,boolean,int,text) from anon';
    execute 'grant execute on function admin_delete_owner(uuid,text) to authenticated';
    execute 'grant execute on function admin_merge_owner(uuid,uuid,text) to authenticated';
    execute 'grant execute on function admin_update_entry(uuid,text,text,boolean,int,text) to authenticated';
  exception when undefined_object then
    null;
  end;
end $$;
