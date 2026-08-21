-- Read-shaped views for the public routes. Each exposes only public-safe
-- fields (never email, phone, or per-owner payment state) and is queried
-- identically by the Supabase REST backend and the local-Postgres dev backend.

-- Per-entry summary with standing and owner display name.
create view v_entry_public as
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
where o.participation_status = 'confirmed';

-- Current pick per entry-week: the grid's cells.
create view v_grid_cells as
select
  p.entry_id,
  p.week,
  p.team,
  p.result,
  p.late,
  p.submitted_at,
  p.source,
  p.result_source
from picks p
where p.is_current;

-- Pool-level financials, aggregate only. Safe for the public pot card.
create view v_pot as
select
  coalesce(sum(f.amount_due_cents), 0)::bigint as due_cents,
  coalesce(sum(f.amount_paid_cents), 0)::bigint as paid_cents,
  (select count(*)
     from entries e
     join owners o on o.id = e.owner_id
    where o.participation_status = 'confirmed')::int as entry_count
from v_owner_finance f;
