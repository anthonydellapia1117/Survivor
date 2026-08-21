-- Entries with picks can never be deleted (auditability); they are voided.
-- Voided entries vanish from public views and from owner financials.

alter table entries add column voided_at timestamptz;

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
group by o.id, c.tier_1_3_cents, c.tier_4plus_cents;

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
  and e.voided_at is null;
