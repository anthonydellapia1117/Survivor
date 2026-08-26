-- The recruited-vs-free split is a BILLING concept. It tells the runner what
-- he owes Lynne; it means nothing to a player, and a public 73-of-80 invites
-- exactly the question the public surface should never raise. Strip it from
-- the public payload entirely — structurally absent, not filtered in the UI.
--
-- Two places carried it:
--   1. v_pot.recruited_entry_count — the aggregate split.
--   2. v_entry_public.is_free_entry — the per-entry flag, from which anyone
--      could count the free entries themselves.
-- The admin views (v_entry_admin, v_owner_finance_admin) keep both.
--
-- is_admin_entry stays on v_entry_public on purpose: it marks OWNERSHIP, not
-- payment, and the public roster's admin-first default ordering is built on
-- it. It says whose an entry is, never whether anybody paid for it.

drop view if exists v_pot;

create view v_pot as
select
  -- Every entry competing — the same 80 the board, the grid and the alive
  -- count show. No billing split.
  (select count(*)
     from entries e
     join owners o on o.id = e.owner_id
    where o.participation_status = 'confirmed'
      and o.deleted_at is null
      and e.voided_at is null)::int as entry_count,
  c.pool_entry_count,
  c.pool_pot_cents
from config c;

grant select on v_pot to anon, authenticated;

-- CREATE OR REPLACE cannot remove a column, so the view is dropped
-- and rebuilt. Nothing else in the schema depends on it.
drop view if exists v_entry_public;

create view v_entry_public as
select
  e.id,
  e.entry_name,
  e.name_is_default,
  e.owner_id,
  o.first_name || ' ' || o.last_name as owner_name,
  s.wins,
  s.losses,
  s.lives_remaining,
  s.status,
  coalesce(pv.bye_used_public, false) as bye_used,
  pv.teams_used_public as teams_used,
  s.last_scored_week,
  (o.email is not null and lower(o.email) = coalesce(
     nullif(current_setting('app.admin_email', true), ''),
     'anthonydellapia@gmail.com')) as is_admin_entry
from entries e
join owners o on o.id = e.owner_id
join v_entry_standing s on s.entry_id = e.id
left join lateral (
  select
    bool_or(p.team = 'SKIP_WEEK') as bye_used_public,
    array_agg(p.team order by p.week)
      filter (where p.team not in ('SKIP_WEEK', 'MISSED')) as teams_used_public
  from picks p
  where p.entry_id = e.id
    and p.is_current
    and pick_is_public(p.team, p.week)
) pv on true
where o.participation_status = 'confirmed'
  and o.deleted_at is null
  and e.voided_at is null;

grant select on v_entry_public to anon, authenticated;
