-- Team pick counts, public once a week has locked. Anthony, 2026-09-13.
--
-- The Teams page used to show a team's count only once its game was final.
-- Now the count for every team appears as soon as that week's pick deadline
-- has passed: the full board, every team with at least one pick, whether its
-- game is scheduled, in progress or final. Before the deadline the counts
-- stay hidden - a published count before picks lock is strategic information
-- and would change what undecided players choose.
--
-- WHY THIS IS A VIEW AND NOT A RENDER. The count is every live entry in the
-- pool that picked that team that week, ours and the master pool, and it
-- does NOT depend on the per-pick reveal gate - an aggregate names nobody.
-- But the two public reads the page had (v_grid_cells, v_master_list) both
-- serve a pick as LOCKED until its own game has kicked off, which is right
-- for a cell that names an entry and useless for a count: from Friday 2 PM
-- to Sunday 1 PM every Sunday team would be a LOCKED cell and its count
-- would be zero. So the aggregate is served by the database, gated on the
-- WEEK's lock rather than the PICK's kickoff, and nothing about the
-- per-pick gate moves: v_grid_cells and v_master_list are untouched, and an
-- individual pick is still never revealed earlier than its own kickoff.
--
-- The gate is the week's LATE deadline (weeks.late_deadline_at), the moment
-- the whole week is locked (CLAUDE.md, pick deadlines) - not the early one,
-- because at the early deadline the Sunday picks are still open and a
-- Thursday-team count would already be a number an undecided player reads.
-- Read from the weeks table on every query; nothing here hardcodes a day or
-- an hour.
--
-- Four columns and nothing else: scope, week, team, n.
--   scope 'ours' is this group's current picks - the same entries
--     v_entry_public serves (confirmed owner, not deleted, not voided) - on a
--     real team, so a bye and a missed week carry no count;
--   scope 'pool' is her NEWEST sheet's week cells, mapped through her
--     vocabulary exactly as v_master_list maps them (the copy below is held
--     to src/lib/lynne/names.ts by tests/unit/lynne-team-names-sql.test.ts);
--     a cell that is not a team name (OUT, a note, a typo) counts nothing.
-- Her sheet already carries our 121 as rows of hers, so 'pool' is the whole
-- pool and 'ours' is our group; the page shows one or the other, never the
-- sum.
--
-- Colour is not this view's business: a team's result still comes off a
-- stored FINAL on nfl_games (teamResults), and a count on a game that is not
-- final is shown with no fill.

create or replace view public.v_team_pick_counts as
with locked as (
  select week from weeks where late_deadline_at <= now()
),
newest as (
  select sheet_sha256 from lynne_roster order by loaded_at desc limit 1
),
lynne_team_names(abbr, lname) as (
  values
    ('ARI', 'arizona'), ('ATL', 'atlanta'), ('BAL', 'baltimore'), ('BUF', 'buffalo'),
    ('CAR', 'carolina'), ('CHI', 'chicago'), ('CIN', 'cincinnati'), ('CLE', 'cleveland'),
    ('DAL', 'dallas'), ('DEN', 'denver'), ('DET', 'detroit'), ('GB', 'green bay'),
    ('HOU', 'houston'), ('IND', 'indianapolis'), ('JAX', 'jacksonville'), ('KC', 'kansas city'),
    ('LAC', 'la chargers'), ('LAR', 'la rams'), ('LV', 'lv raiders'), ('MIA', 'miami'),
    ('MIN', 'minnesota'), ('NE', 'new england'), ('NO', 'new orleans'), ('NYG', 'ny giants'),
    ('NYJ', 'ny jets'), ('PHI', 'philadelphia'), ('PIT', 'pittsburgh'), ('SEA', 'seattle'),
    ('SF', 'san francisco'), ('TB', 'tampa bay'), ('TEN', 'tennessee'), ('WAS', 'washington')
),
ours as (
  select p.week, p.team, count(*)::int as n
    from picks p
    join entries e on e.id = p.entry_id
    join owners o on o.id = e.owner_id
   where p.is_current
     and e.voided_at is null
     and o.deleted_at is null
     and o.participation_status = 'confirmed'
     and p.team not in ('SKIP_WEEK', 'MISSED')
   group by p.week, p.team
),
pool as (
  select w.week, t.abbr as team, count(*)::int as n
    from lynne_roster r
    join newest n on n.sheet_sha256 = r.sheet_sha256
    cross join lateral jsonb_each_text(r.cells) c(key, value)
    cross join lateral (
      select (regexp_match(c.key, '^\s*(?:week|wk)\s*(\d{1,2})\s*$', 'i'))[1]::int as week
    ) w
    join lynne_team_names t on t.lname = lower(btrim(c.value))
   where w.week is not null
   group by w.week, t.abbr
)
select 'ours'::text as scope, o.week, o.team, o.n
  from ours o
  join locked l on l.week = o.week
union all
select 'pool'::text as scope, p.week, p.team, p.n
  from pool p
  join locked l on l.week = p.week;

grant select on v_team_pick_counts to anon, authenticated;
