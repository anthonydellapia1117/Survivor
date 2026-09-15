-- v_entry_standing serves LIVE entries only.
--
-- Found by Anthony on 2026-09-15: "v_entry_standing has a bug and it is the
-- view every standings figure reads. It returns 130 rows against 121 live
-- entries. It does not filter voided_at. Its own counts are active 84 and
-- at_risk 46, which sum to 130 - nine voided entries are being counted as
-- active."
--
-- The scored CTE had been `from entries e cross join config c left join
-- picks p` with no filter on e.voided_at since 20260821000002. Every reader
-- in the database - v_entry_public, v_entry_admin and admin_deadline_sweep -
-- inner-joins the view from entries and filters e.voided_at is null on its
-- own side, and so does the local-pg admin list, so the public site, the
-- admin list and the sweep were right all along. The view ITSELF was wrong,
-- and so was anything that read it directly: a status tally taken off the
-- view carried nine voided entries as active, and its row count was not the
-- roster.
--
-- The body below is the live definition (20260821000002, security_invoker
-- off since 20260821000012, select revoked from the client roles since
-- 20260824000018) carried forward exactly, plus one line: `where
-- e.voided_at is null` in the scored CTE. From now on the view's row count
-- IS the live entry count. tests/sql/22_entry_standing_live.sql holds it
-- there by voiding an entry through admin_void_entry, and
-- scripts/db/smoke.sql raises on the same comparison inside every attended
-- apply.
--
-- Idempotent: create or replace against a database that already carries
-- the filter changes nothing, and the option and the revoke below re-assert
-- what is already true.

create or replace view v_entry_standing as
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
  where e.voided_at is null
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

-- Definer, as 20260821000012 left it: the public projections built on top
-- of this view are the deliberate boundary, and an invoker view underneath
-- them checks the original caller and hands anon nothing. Stated here
-- rather than inherited, so a fresh database reads the same as production.
alter view v_entry_standing set (security_invoker = off);

-- Out of direct client reach, as 20260824000018 put it: the raw base
-- bypasses the picks RLS, and the admin reads v_entry_admin instead.
do $$
begin
  execute 'revoke select on v_entry_standing from anon, authenticated';
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;
