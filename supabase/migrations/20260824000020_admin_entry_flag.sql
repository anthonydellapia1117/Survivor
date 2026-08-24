-- Admin entries: any entry belonging to the pool runner (the app.admin_email
-- owner — free or paid) sorts first everywhere by default. The flag is
-- DERIVED from ownership at read time, sharing is_admin()'s email source,
-- so it can never drift; no email ever appears in a public payload.

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

create or replace view v_entry_admin as
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
  s.last_scored_week,
  (o.email is not null and lower(o.email) = coalesce(
     nullif(current_setting('app.admin_email', true), ''),
     'anthonydellapia@gmail.com')) as is_admin_entry
from entries e
join owners o on o.id = e.owner_id
join v_entry_standing s on s.entry_id = e.id
where is_admin()
  and o.participation_status = 'confirmed'
  and o.deleted_at is null
  and e.voided_at is null;
