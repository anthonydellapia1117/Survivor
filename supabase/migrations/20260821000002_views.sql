-- Derived views — the ONLY place totals come from (spec 2.3).
-- No table stores a balance, a win count, or a status.

-- Owner financials
create view v_owner_finance as
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
left join entries e on e.owner_id = o.id
cross join config c
where o.participation_status = 'confirmed'
group by o.id, c.tier_1_3_cents, c.tier_4plus_cents;

-- Entry standing, fully derived from picks.
-- Elimination rule: two lives through config.double_elim_through_week (7).
-- From week 8 on, any loss is terminal regardless of lives remaining.
create view v_entry_standing as
with scored as (
  select
    e.id as entry_id,
    count(*) filter (where p.result in ('loss','tie_loss','missed')) as losses,
    count(*) filter (where p.result = 'win') as wins,
    max(p.week) filter (where p.result is not null and p.result <> 'pending') as last_scored_week,
    max(p.week) filter (where p.result in ('loss','tie_loss','missed')
                        and p.week > c.double_elim_through_week) as single_elim_loss_week,
    bool_or(p.team = 'SKIP_WEEK') as bye_used,
    array_agg(p.team order by p.week) filter (where p.team <> 'SKIP_WEEK' and p.result is not null) as teams_used
  from entries e
  cross join config c
  left join picks p on p.entry_id = e.id and p.is_current
  group by e.id, c.double_elim_through_week
)
select
  s.entry_id,
  s.losses,
  s.wins,
  s.last_scored_week,
  s.bye_used,
  s.teams_used,
  case
    when s.single_elim_loss_week is not null then 0
    else greatest(0, 2 - s.losses)
  end as lives_remaining,
  case
    when s.losses >= 2 or s.single_elim_loss_week is not null then 'eliminated'
    when s.losses = 1 then 'at_risk'
    when s.last_scored_week >= 7 and s.losses = 0 and not s.bye_used then 'bye_eligible'
    else 'active'
  end as status
from scored s;

-- Public owner projection: id and name only. Never email, phone, or payment state.
create view v_public_owners as
select id, first_name, last_name
from owners
where participation_status = 'confirmed';
