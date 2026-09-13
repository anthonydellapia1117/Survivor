-- A masked cell of hers is served as LOCKED, not dropped. Anthony, 2026-09-12.
--
-- THE BUG
--
-- Our 121 rendered a locked chip for a pick that exists and is not revealed
-- yet; her ~1,318 rendered the empty-week dot for the same condition. Two
-- different things on screen for one state, and the blank one is the lie:
-- a reader could not tell "she has published nothing for this entry" from
-- "she has, and it is not your business until kickoff".
--
-- WHERE IT CAME FROM: the reveal test sat in the WHERE of the aggregate, so a
-- masked cell was never fed to jsonb_object_agg and its KEY VANISHED. The
-- distinction was destroyed here, in the view, before any TypeScript ran -
-- neither src/lib/master-list.ts nor grid-view.tsx could recover it, because
-- an absent key and a never-filled week are the same absence.
--
-- v_grid_cells has always had this right and is the model followed here: it
-- keeps the pick row and substitutes 'LOCKED' in the team column, which is
-- exactly why our own masked picks reach the component as a real cell and
-- render the chip. This does the same one level down - keeps the KEY and
-- substitutes 'LOCKED' as the VALUE - so both scopes now arrive at the same
-- branch by the same sentinel.
--
-- THE GATE IS UNCHANGED, and that is the whole point of the shape. The
-- condition is not touched; it only moves from the WHERE to a CASE. Her text
-- `c.value` is still emitted on exactly the branch that emitted it before,
-- and the masked branch emits a constant that carries no team information.
-- Nothing is revealed one second earlier than it was.
--
-- Still exactly five columns - row_no, names, cells, sheet_loaded_at,
-- entry_id - because the marker rides IN the cells object rather than beside
-- it. tests/sql/15_master_list.sql and tests/unit/master-list-wiring.test.ts
-- both pin that surface and both still hold.
--
-- A column that is not a week still never leaves the table: `w.week is not
-- null` stays in the WHERE, where it belongs, because that is a question
-- about the KEY and not about revealing anything.
--
-- One accepted collision, stated so it is not mistaken for a bug: her sheet
-- is free text, so a cell she literally typed as "LOCKED" would, once
-- revealed, be served as the sentinel and render as a locked chip. The cost
-- is one cell showing a padlock instead of the word; the alternative is a
-- second channel beside `cells`, which is the sixth column this view refuses
-- to grow. src/lib/master-list.ts is the one place the sentinel is read, and
-- it never reaches a screen as text.

create or replace view v_master_list as
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
  (select coalesce(
            jsonb_object_agg(
              c.key,
              -- The SAME condition as before, moved from the WHERE to here.
              -- Revealed: her text, verbatim. Masked: the sentinel, which
              -- says a cell exists and says nothing about which team.
              case
                when case
                       when t.abbr is not null then pick_is_public(t.abbr, w.week)
                       else exists (select 1 from nfl_games g where g.week = w.week)
                            and not exists (select 1 from nfl_games g where g.week = w.week and g.kickoff_at > now())
                     end
                then c.value
                else 'LOCKED'
              end),
            '{}'::jsonb)
     from jsonb_each_text(r.cells) c
     cross join lateral (
       select (regexp_match(c.key, '^\s*(?:week|wk)\s*(\d{1,2})\s*$', 'i'))[1]::int as week
     ) w
     left join lynne_team_names t on t.lname = lower(btrim(c.value))
    where w.week is not null
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
  'Lynne''s newest sheet for the public Master List: her NO., her NAMES verbatim, her week cells once the grid''s reveal rule (pick_is_public) allows them and the sentinel LOCKED until then, the load time, and this group''s entry id where the NO. is one of ours. A key is present for every week cell she has filled, so a MISSING key means she filled nothing; the team behind a LOCKED value is never served. Public by design; nothing else from lynne_roster is exposed.';

grant select on v_master_list to anon, authenticated;
