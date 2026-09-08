-- The Master List: Lynne's whole pool on the public site, and her pool-wide
-- figures as she publishes them.
--
-- Set by Anthony on 2026-09-08. His group is interested in every entry in
-- her pool, not only his 121: the full NO./NAMES list, her week columns as
-- she fills them, and her four figures (Total in Pool, Free, Total, the pot).
-- His 121 are what he manages on the admin side; the public default is the
-- whole pool.
--
-- Two things change here:
--
-- 1. config carries her "Free" and "Total" lines beside the pool total and
--    the pot, each stored exactly as she published it. admin_set_pool_pot
--    takes all four. It refuses a triple that does not add up (free + paid
--    must equal the pool total) instead of computing any of them - a slip on
--    her sheet is reported, never silently corrected (CLAUDE.md). The
--    per-entry rate behind her pot is never stored and never printed.
--
-- 2. v_master_list exposes the newest sheet in lynne_roster to the public
--    site: her NO., her NAMES text verbatim, her filled week cells, when the
--    sheet was loaded, and which row is one of this group's live entries
--    (entry_id, already public through v_entry_public). Nothing else from
--    lynne_roster leaves the table: no file name, no Gmail id, no loader.
--    The view runs as its owner like every other public view, so the
--    table's admin-only RLS is untouched and the read surface is exactly
--    these five columns.

-- ----------------------------------------------------------------- config
alter table config add column pool_free_count int
  check (pool_free_count is null or pool_free_count >= 0);
alter table config add column pool_paid_count int
  check (pool_paid_count is null or pool_paid_count >= 0);

comment on column config.pool_free_count is
  'Her "Free" line: free entries in Lynne''s whole pool, as she publishes it. Admin-entered, stored as given. Public by design (Anthony, 2026-09-08); this is her pool-wide figure, not this group''s recruited-vs-free split, which stays admin-only.';
comment on column config.pool_paid_count is
  'Her "Total" line: paying entries in Lynne''s whole pool, as she publishes it. Admin-entered, stored as given; admin_set_pool_pot refuses a triple that does not add up rather than deriving one.';

-- ------------------------------------------------------------------ v_pot
-- Dropped and recreated: the column set changes, which CREATE OR REPLACE
-- cannot do. Same rows as before plus her two counts; still no money from
-- this group.
drop view if exists v_pot;

create view v_pot as
select
  (select count(*)
     from entries e
     join owners o on o.id = e.owner_id
    where o.participation_status = 'confirmed'
      and o.deleted_at is null
      and e.voided_at is null)::int as entry_count,
  c.pool_entry_count,
  c.pool_free_count,
  c.pool_paid_count,
  c.pool_pot_cents
from config c;

grant select on v_pot to anon, authenticated;

-- -------------------------------------------------------------------- RPC
-- The three-argument form is replaced, not overloaded: two signatures with
-- the same name would make PostgREST's call ambiguous for the admin screen.
drop function if exists admin_set_pool_pot(int, bigint, text);

create or replace function admin_set_pool_pot(
  p_entry_count int,
  p_free_count int,
  p_paid_count int,
  p_pot_cents bigint,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  n int;
begin
  if p_entry_count is not null and p_entry_count < 0 then
    raise exception 'pool entry count cannot be negative';
  end if;
  if p_free_count is not null and p_free_count < 0 then
    raise exception 'pool free count cannot be negative';
  end if;
  if p_paid_count is not null and p_paid_count < 0 then
    raise exception 'pool paid count cannot be negative';
  end if;
  if p_pot_cents is not null and p_pot_cents < 0 then
    raise exception 'pool pot cannot be negative';
  end if;
  -- Her three counts have to agree with each other. Nothing here fills a
  -- blank in from the other two: enter what she published, and if it does
  -- not add up the sheet is what needs a look.
  if p_entry_count is not null and p_free_count is not null and p_paid_count is not null
     and p_free_count + p_paid_count <> p_entry_count then
    raise exception 'her figures do not add up: % free + % paid is not % in pool; enter them as she published them and check the sheet',
      p_free_count, p_paid_count, p_entry_count;
  end if;

  select jsonb_build_object('pool_entry_count', pool_entry_count,
                            'pool_free_count', pool_free_count,
                            'pool_paid_count', pool_paid_count,
                            'pool_pot_cents', pool_pot_cents)
    into v_before
    from config where id = 1;

  update config
     set pool_entry_count = p_entry_count,
         pool_free_count = p_free_count,
         pool_paid_count = p_paid_count,
         pool_pot_cents = p_pot_cents,
         pool_updated_at = case
           when p_entry_count is null and p_free_count is null
            and p_paid_count is null and p_pot_cents is null then null
           else now()
         end
   where id = 1;

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'config not updated - admin privileges required';
  end if;

  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'set_pool_pot', 'config', '1', v_before,
          jsonb_build_object('pool_entry_count', p_entry_count,
                             'pool_free_count', p_free_count,
                             'pool_paid_count', p_paid_count,
                             'pool_pot_cents', p_pot_cents));
end $$;

revoke execute on function admin_set_pool_pot(int, int, int, bigint, text) from public;

do $$
begin
  revoke execute on function admin_set_pool_pot(int, int, int, bigint, text) from anon;
  grant execute on function admin_set_pool_pot(int, int, int, bigint, text) to authenticated;
exception when undefined_object then
  null; -- roles absent outside supabase-shaped databases
end $$;

-- ---------------------------------------------------------- v_master_list
-- The newest loaded sheet, one row per NO. The newest sheet is the one
-- with the latest loaded_at; every row of a load shares that timestamp
-- because admin_load_lynne_roster writes them in one statement.
--
-- Her cells obey the grid's reveal rule, in the view, so PostgREST cannot
-- serve what /grid still masks: a week cell that names one of her teams is
-- served once pick_is_public says that team's game has kicked off (the same
-- function v_grid_cells uses, override included); a week cell that is not a
-- team name (OUT, a note, a typo) is served only once every game of that
-- week has kicked off; a column that is not a week never leaves the table.
-- Her team vocabulary is the list in src/lib/lynne/names.ts, lower-cased;
-- tests/unit/lynne-team-names-sql.test.ts holds the two copies together.
create view v_master_list as
with newest as (
  select sheet_sha256, loaded_at
    from lynne_roster
   order by loaded_at desc
   limit 1
),
lynne_team_names(abbr, lname) as (
  values
    ('ARI', 'arizona'),
    ('ATL', 'atlanta'),
    ('BAL', 'baltimore'),
    ('BUF', 'buffalo'),
    ('CAR', 'carolina'),
    ('CHI', 'chicago'),
    ('CIN', 'cincinnati'),
    ('CLE', 'cleveland'),
    ('DAL', 'dallas'),
    ('DEN', 'denver'),
    ('DET', 'detroit'),
    ('GB', 'green bay'),
    ('HOU', 'houston'),
    ('IND', 'indianapolis'),
    ('JAX', 'jacksonville'),
    ('KC', 'kansas city'),
    ('LAC', 'la chargers'),
    ('LAR', 'la rams'),
    ('LV', 'lv raiders'),
    ('MIA', 'miami'),
    ('MIN', 'minnesota'),
    ('NE', 'new england'),
    ('NO', 'new orleans'),
    ('NYG', 'ny giants'),
    ('NYJ', 'ny jets'),
    ('PHI', 'philadelphia'),
    ('PIT', 'pittsburgh'),
    ('SEA', 'seattle'),
    ('SF', 'san francisco'),
    ('TB', 'tampa bay'),
    ('TEN', 'tennessee'),
    ('WAS', 'washington')
)
select
  r.row_no,
  r.names,
  (select coalesce(jsonb_object_agg(c.key, c.value), '{}'::jsonb)
     from jsonb_each_text(r.cells) c
     cross join lateral (
       select (regexp_match(c.key, '^\s*(?:week|wk)\s*(\d{1,2})\s*$', 'i'))[1]::int as week
     ) w
     left join lynne_team_names t on t.lname = lower(btrim(c.value))
    where w.week is not null
      and case
            when t.abbr is not null then pick_is_public(t.abbr, w.week)
            else exists (select 1 from nfl_games g where g.week = w.week)
                 and not exists (select 1 from nfl_games g where g.week = w.week and g.kickoff_at > now())
          end
  ) as cells,
  n.loaded_at as sheet_loaded_at,
  ours.id as entry_id
from lynne_roster r
join newest n on n.sheet_sha256 = r.sheet_sha256
left join lateral (
  select e.id
    from entries e
    join owners o on o.id = e.owner_id
   where e.lynne_number = r.row_no
     and e.voided_at is null
     and o.participation_status = 'confirmed'
     and o.deleted_at is null
   limit 1
) ours on true;

comment on view v_master_list is
  'Lynne''s newest sheet for the public Master List: her NO., her NAMES verbatim, her week cells once the grid''s reveal rule (pick_is_public) allows them, the load time, and this group''s entry id where the NO. is one of ours. Public by design; nothing else from lynne_roster is exposed.';

grant select on v_master_list to anon, authenticated;
