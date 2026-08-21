# SURVIVOR POOL APP - COMPLETE BUILD SPECIFICATION

Repo: `git@github.com:anthonydellapia1117/Survivor.git`
Owner: Anthony DellaPia
Season: 2026 NFL Survivor Pool, run under Lynne Piazza's master pool
Target: production-deployed, publicly shareable, mobile-first, desktop-capable

---

## 0. MISSION AND OPERATING RULES

Build a live Survivor pool tracker that replaces a spreadsheet-plus-agent system. It must be beautiful, fast, and correct about money and eliminations. Players get a read-only link. Anthony gets an admin surface.

**Work autonomously inside this repo.** Everything here is scoped to the repo, its Supabase project, and its Vercel deployment. There is no reason to stop for approval on file creation, schema migration, component work, or deploys to preview. Stop only for: destructive operations outside the repo, a decision this spec does not answer, or anything touching Anthony's Gmail or the legacy Google Sheet beyond a one-time read.

**Commit continuously.** Small, descriptive commits. Push to `main`. Do not batch a day of work into one commit.

**Definition of done for each phase:** it builds, it deploys, the deployed URL renders it correctly on a phone and a laptop, and the tests pass.

---

## 1. STACK

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript strict | Server components for the public read path, route handlers for admin writes |
| Styling | Tailwind CSS v4 + shadcn/ui | Anthony's existing stack; shadcn gives accessible primitives without visual lock-in |
| Database | Supabase Postgres | Real relational integrity, computed views, row-level security for public read |
| Auth | Supabase Auth, single admin account | Players need no login. Anthony logs in for writes |
| Charts | Recharts | Pick distribution, survival curve |
| Tables | TanStack Table | Sorting, filtering, virtualization on the grid |
| Excel | SheetJS (`xlsx`) | Export the full picks matrix |
| Deploy | Vercel, connected to the repo | Push to main deploys production |

**Environment variables** in `.env.local` and Vercel:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ADMIN_EMAIL
```

---

## 2. DATA MODEL

Postgres. Migrations in `supabase/migrations/`. **Every rule below exists because the previous system got it wrong.**

### 2.1 Core principle: nothing derived is ever stored

The old system stored `amount_paid` on the owner row and let it drift from the payment ledger. Three different totals appeared in one report: $190, $310, $220. **Money is always a SUM over the ledger, computed at read time, never a column anyone writes.** Same for entry counts, wins, losses, lives, and status - all derived from picks and results.

### 2.2 Schema

```sql
-- OWNERS
create table owners (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text unique,                  -- nullable: text/in-person signups are legitimate
  phone text,
  source text not null default 'email', -- email | text | in_person | import
  source_ref text,                    -- gmail message id, or free text
  participation_status text not null default 'confirmed'
    check (participation_status in ('confirmed','declined','pending')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ENTRIES
create table entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete restrict,
  entry_index int not null,
  entry_name text not null,           -- VERBATIM. Never normalized, cased, or trimmed for display.
  name_is_default boolean not null default false, -- true when auto-generated "Full Name 1"
  lynne_label text,                   -- what Lynne's file calls it, if different
  is_free_entry boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, entry_index)
);
create index on entries (lower(entry_name));  -- matching only; display uses entry_name raw

-- PAYMENTS: append-only ledger. Corrections are new rows, never edits or deletes.
create table payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references owners(id),  -- null = unmatched, quarantined
  amount_cents int not null,            -- negative allowed for corrections
  method text not null check (method in ('venmo','cash','check','correction','comp')),
  paid_on date not null,
  venmo_txn_id text unique,             -- unique constraint IS the dedupe
  source_ref text,
  note text,
  corrects_payment_id uuid references payments(id),
  created_at timestamptz not null default now()
);

-- WEEKS
create table weeks (
  week int primary key check (week between 1 and 18),
  window_label text not null,          -- 'thu_fri' | 'sat_mon'
  deadline_at timestamptz not null,
  results_final boolean not null default false
);

-- PICKS: append-only with supersession. Never UPDATE a pick row's team.
create table picks (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  week int not null references weeks(week),
  team text not null,                  -- NFL abbreviation, or 'SKIP_WEEK' for a bye
  submitted_at timestamptz not null default now(),
  source text not null default 'admin' check (source in ('admin','lynne_import','player','override')),
  source_ref text,
  supersedes_id uuid references picks(id),
  is_current boolean not null default true,
  late boolean not null default false, -- submitted_at > week deadline
  result text check (result in ('win','loss','tie_loss','bye','pending','missed')),
  result_source text,                  -- 'lynne' | 'manual'
  created_at timestamptz not null default now()
);
create unique index picks_one_current on picks (entry_id, week) where is_current;

-- AUDIT: every write, no exceptions
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target_table text not null,
  target_id text,
  before jsonb,
  after jsonb,
  note text
);

-- LYNNE IMPORTS: idempotent by file hash
create table lynne_imports (
  id uuid primary key default gen_random_uuid(),
  week int references weeks(week),
  filename text not null,
  file_sha256 text not null unique,    -- re-importing the same file is a no-op
  imported_at timestamptz not null default now(),
  row_count int,
  matched_count int,
  unmatched jsonb,                     -- rows that could not be matched, for review
  variances jsonb                      -- where Lynne disagrees with local state
);

-- CONFIG: single row, editable in admin
create table config (
  id int primary key default 1 check (id = 1),
  tier_1_3_cents int not null default 3000,
  tier_4plus_cents int not null default 2500,
  lynne_rate_cents int not null default 2500,
  free_entry_ratio int not null default 10,
  double_elim_through_week int not null default 7,
  season_status text not null default 'open',
  timezone text not null default 'America/New_York'
);
```

### 2.3 Derived views - the only place totals come from

```sql
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

-- Entry standing, fully derived from picks
create view v_entry_standing as
with scored as (
  select
    e.id as entry_id,
    count(*) filter (where p.result in ('loss','tie_loss','missed')) as losses,
    count(*) filter (where p.result = 'win') as wins,
    max(p.week) filter (where p.result is not null and p.result <> 'pending') as last_scored_week,
    bool_or(p.team = 'SKIP_WEEK') as bye_used,
    array_agg(p.team order by p.week) filter (where p.team <> 'SKIP_WEEK' and p.result is not null) as teams_used
  from entries e
  left join picks p on p.entry_id = e.id and p.is_current
  group by e.id
)
select
  s.*,
  greatest(0, 2 - s.losses) as lives_remaining,
  case
    when s.losses >= 2 then 'eliminated'
    when s.losses = 1 then 'at_risk'
    when s.last_scored_week >= 7 and s.losses = 0 and not s.bye_used then 'bye_eligible'
    else 'active'
  end as status
from scored s;
```

**Elimination rule encoded above:** two lives. Weeks 1-7 a loss costs one. From week 8, `results_final` weeks apply single elimination - enforce in the scoring function by treating any loss at week >= 8 as terminal regardless of lives.

### 2.4 Row-level security

```sql
alter table owners enable row level security;
alter table entries enable row level security;
alter table picks enable row level security;
alter table payments enable row level security;

-- Public: read entries, picks, weeks. NOT payments, NOT owner emails or phones.
create policy public_read_entries on entries for select using (true);
create policy public_read_picks on picks for select using (true);
create policy admin_all_payments on payments for all
  using (auth.jwt() ->> 'email' = current_setting('app.admin_email', true));
```

Expose a `v_public_owners` view that returns id, first_name, last_name only. Never leak email, phone, or payment status to the public route.

---

## 3. BUSINESS RULES - LOCKED

These are final. Do not reinterpret them.

| Rule | Value |
|---|---|
| Pricing | 1-3 entries: $30 each. 4 or more: $25 each. Applied to the owner's total paid entries |
| Lynne remittance | $25 per entry, every tier, always |
| Free entries | `FLOOR(paid_entries / 10)`. Additive new entry rows with `is_free_entry = true`. Must be named before Week 1 |
| Week 1 deadline | Tuesday 2026-09-08, 12:00 PM America/New_York |
| Thu/Fri window | Wednesday 12:00 PM ET |
| Sat-Mon window | Friday 12:00 PM ET |
| Tie | Always a loss. `result = 'tie_loss'`, counts identically to a loss |
| Weeks 1-7 | Double elimination. First loss -> at risk. Second -> eliminated |
| Week 8+ | Single elimination. Any loss -> eliminated immediately |
| Missed pick | Automatic loss at deadline. No confirmation, no grace period, no bye rescue |
| Bye | `SKIP_WEEK`. Earned only by staying loss-free through Week 7. Submitted explicitly, Week 8 or later. Use it or lose it. Advances with no win or loss. Does not add to `teams_used` |
| Duplicate team | A warning surfaced in the UI, never a block. Record the pick as submitted |
| Authority | Lynne's published results win on wins, losses, standings, and elimination. Anthony's record wins on what was submitted and when. Variances are reported, never auto-resolved |
| Entry names | Stored and displayed exactly as supplied. `tommybrads2` is lowercase and stays lowercase. Never normalize for display; lowercase only inside match logic |
| Default naming | When an owner supplies no names: full name plus numeric suffix. Single entry gets the plain name. Mark `name_is_default = true` |
| Payments | Never marked paid from a claim. A Venmo transaction ID, or an explicit cash/check entry by Anthony. Ledger is append-only; corrections are new rows |

---

## 4. SCREENS

### 4.1 Public routes (no auth)

**`/` - Dashboard**

Hero strip, four stat cards, then panels. Everything below the fold is scannable on a phone.

| Card | Content |
|---|---|
| Pot | Total collected / total due, with a progress bar |
| Alive | Count of active + at-risk entries out of total |
| Week | Current week, next deadline with a live countdown |
| Eliminated | Count, with a sparkline of the survival curve |

Panels:
- **Survival curve** - area chart, entries remaining by week
- **This week's pick distribution** - horizontal bar, team by count, with percentage. Hidden until the deadline passes, then revealed. This is the single most-wanted view in a survivor pool
- **Standings breakdown** - active / at risk / bye eligible / bye used / eliminated, as a segmented bar with counts
- **Recent activity** - last 10 results, entry name, team, W/L

**`/grid` - The Grid**

The core screen. Modeled on survivorgrid.com's density, but readable.

- Rows: entries, sorted by status then owner name. Sticky first column showing entry name and a status dot
- Columns: weeks 1-18. Sticky header
- Cell: team abbreviation on a colored background. Green = win, red = loss, amber = tie-loss, slate = bye, gray outline = pending, hatched = missed
- Hover or tap a cell: popover with team, submitted timestamp, late flag, result source
- Filters above the grid: status, owner, week range, "show only alive"
- Mobile: horizontal scroll with a pinned entry column, cells shrink to 44px minimum touch target. Never collapse to a list - the grid is the point
- Toggle: "compact" (abbreviations only) and "comfortable" (abbreviation plus a small team logo block)

**`/teams` - Team Availability**

For each entry, which teams remain unused. Rendered as a 32-team chip grid per entry, used teams dimmed and struck. Selectable entry from a dropdown. Also a global heatmap: team by week showing how many entries picked it.

**`/entries` - Roster**

Table of all entries: entry name, owner, status, lives, weeks survived, current pick, teams used count. Sortable, filterable, searchable. Public sees no payment data.

**`/entry/[id]` - Entry detail**

One entry's full history. Timeline of picks by week with results. Teams used. Status trail. Shareable link a player can bookmark.

**`/lynne` - Lynne's Board**

Separate tab, clearly labeled as the master pool's data. Shows the most recent import: week, filename, imported timestamp, row count, matched count. A table of Lynne's rows as received. A **variance panel** listing every disagreement between her file and local state, with both values side by side and no auto-resolution. This is the D10 authority split made visible.

### 4.2 Admin routes (auth required)

**`/admin`** - overview with quick actions

**`/admin/owners`** - add, edit, mark declined. Add entries to an existing owner inline. Remove an entry only if it has no picks; otherwise void it

**`/admin/entries`** - rename entries, set Lynne labels, flag free entries. Bulk-add with the default naming convention

**`/admin/payments`** - the ledger. Add a payment, add a correction referencing the row it corrects. Never a delete button. Shows computed owner balance beside the raw ledger so drift is impossible to hide

**`/admin/picks`** - enter picks for a week, one screen, all entries, keyboard-navigable. Team dropdown per entry with used teams disabled but selectable-with-warning. Bulk paste from text. Override an existing pick creates a supersession, never an edit

**`/admin/import`** - drop Lynne's file. Preview the parse. Show matched, unmatched, and variances before committing. Idempotent by file hash

**`/admin/deadline`** - run the missed-pick sweep for a week. Preview which entries would take an automatic loss, then commit. Never automatic without a click

---

## 5. DESIGN SYSTEM

**Direction: Premium Executive.** Clean, high-density, sophisticated. Think Linear or Vercel's dashboard, not a fantasy sports site. No gradients on buttons, no drop shadows doing structural work, no rounded-everything.

```css
/* Base - dark first, light mode as a proper alternate not an afterthought */
--bg:            #0B0D0F;   /* near-black, slightly warm */
--surface:       #14171A;
--surface-2:     #1C2024;
--border:        #262B31;
--text:          #E8EAED;
--text-muted:    #8A9099;

/* Semantic - results */
--win:           #10B981;
--loss:          #EF4444;
--tie:           #F59E0B;
--bye:           #64748B;
--pending:       #3F4650;

/* Accent - use sparingly, one per screen */
--accent:        #4F7CFF;
```

**Typography:** Inter or Geist for UI. Tabular numerals everywhere numbers align - `font-variant-numeric: tabular-nums`. Type scale: 12 / 13 / 14 / 16 / 20 / 28 / 40. Weight 400 for body, 500 for labels, 600 for headings. Never 700 outside the hero.

**Density:** table rows 40px on desktop, 48px on mobile. 8px base spacing unit. Grid cells 44px minimum on touch.

**Borders over shadows.** 1px `--border` defines surfaces. Shadows only on genuine overlays.

**Motion:** 150ms ease-out on hover, 200ms on layout shift. No bounce, no spring. Respect `prefers-reduced-motion`.

**Mobile is not a fallback.** Design the phone view first for every screen except `/grid`, which is designed for the grid and adapted to the phone with pinned columns.

If an Ayvede brand token file exists in a sibling repo, read it and use those values instead of the palette above. Otherwise this palette is authoritative.

---

## 6. IMPORT AND EXPORT

### 6.1 Lynne import

Accept `.xlsx` and `.csv`. Her format varies between weeks - build the parser tolerant:

1. Hash the file. If the hash exists in `lynne_imports`, stop and report "already imported"
2. Detect the header row by scanning for a cell matching entry/name/team patterns
3. Map columns loosely: entry name, team, result. Ignore unknown columns
4. Match each row to an entry: exact `lynne_label` first, then exact `entry_name`, then case-insensitive `entry_name`. **Never fuzzy.** No match goes to `unmatched`
5. For matched rows, compare against local state. Any disagreement goes to `variances` - do not write
6. Show the preview. Only on explicit commit do results get written
7. Write an audit row per result applied

### 6.2 Exports

**Full picks matrix to Excel** - `/api/export/picks.xlsx`. Sheet 1: entries down, weeks across, team abbreviations in cells with conditional fill by result. Sheet 2: flat pick log with timestamps and sources. Sheet 3: standings. Sheet 4: financials (admin only, gated).

**Player export** - `/entry/[id]/export`. A clean one-page PDF or PNG: entry name, status, pick history, teams used. Shareable to a text thread.

**Roster CSV** - `/api/export/roster.csv`. Entry name, owner, status, current pick.

**Lynne submission package** - `/api/export/lynne-week/[n].csv`. Exactly the columns her sheet expects: entry label, team. This closes the loop back to the master pool.

---

## 7. WHAT THE PREVIOUS SYSTEM GOT WRONG

Encode each of these as a test, not just a comment.

| Failure | Architectural answer |
|---|---|
| Stored `amount_paid` drifted from the ledger; three totals in one report | Never store derived money. `v_owner_finance` computes it. Add a test asserting no code path writes an owner balance |
| 14 payment rows for 3 real payments, blank owner IDs, double-counted corrections | `venmo_txn_id UNIQUE` blocks the duplicate at the database. Corrections reference `corrects_payment_id`. Admin UI shows ledger and computed balance side by side |
| Four entry names invented by an agent | `entry_name` is required and `name_is_default` marks anything auto-generated. Default convention is explicit, never inferred |
| `tommybrads2` capitalized on write | Store verbatim. Lowercase only inside `lower(entry_name)` index for matching. Add a test round-tripping mixed-case names |
| A draft treated as a sent reply, silencing a real signup | Not applicable in this architecture - no email sending. But keep the lesson: a queued or pending state is never a completed state |
| Scan cursor set to "when I looked" rather than last processed | No cursors here. Idempotency is by file hash and unique constraint |
| Agent monitored one of three email threads | Not applicable - this app is the source of truth. Import replaces scanning |
| A live signup misfiled as "declined" | `participation_status` is admin-set only, with an audit row. Every status change is reversible and logged |
| Eight people written to the audit log but never to the roster | Single transaction per write. Audit and data commit together or neither does |
| Skills existed as text but never loaded at runtime | Business rules live in typed functions with unit tests, not prose. If a rule is not tested, it is not implemented |

---

## 8. BUILD ORDER

**Phase 1 - Foundation**
Scaffold Next.js, Tailwind, shadcn. Supabase project, all migrations, RLS policies. Seed `weeks` with the 2026 schedule and correct deadlines. Deploy an empty shell to Vercel. Confirm the URL loads.

**Phase 2 - Data in**
Seed script importing the roster in section 9. Verify: 47 entries, 14 owners, $250 collected, $860 due, computed not stored. Write the finance and standing view tests here.

**Phase 3 - Public read**
`/entries`, `/entry/[id]`, `/grid`. Get the grid right before anything else - it is the screen Anthony will look at most. Mobile pinned column working.

**Phase 4 - Dashboard**
`/` with stat cards, survival curve, pick distribution, standings breakdown. Distribution hidden until deadline.

**Phase 5 - Admin**
Auth, then owners, entries, payments, picks. The picks entry screen must be fast - all entries on one page, keyboard-navigable.

**Phase 6 - Rules engine**
Deadline sweep, automatic loss, elimination, bye handling, tie-as-loss. Full unit test coverage on every rule in section 3. This phase is not done until every locked rule has a passing test.

**Phase 7 - Lynne**
`/lynne`, the import pipeline, variance reporting, and the week submission export.

**Phase 8 - Exports and polish**
Excel matrix, player export, roster CSV. Loading states, empty states, error boundaries. Lighthouse pass on mobile.

---

## 9. SEED DATA - CURRENT ROSTER

47 entries, 14 owners. $250 collected, $860 due, $1,110 pool value. Entry names are verbatim and case-sensitive.

| Owner | Entries | Names | Due | Paid |
|---|---|---|---|---|
| Maria DiCicco | 4 | ReRe #1, ReRe #2, ReRe #3, ReRe #4 | $100 | **$100** |
| Brian Yost | 2 | Brian Yost 1, Brian Yost 2 | $60 | **$60** |
| Tim Flaherty | 1 | Pumpy321 | $30 | **$30** |
| Marc Massimino | 2 | Mass1, Mass2 | $60 | **$60** |
| Ashley Scalia | 4 | Waggs1, Waggs2, Waggs3, Waggs4 | $100 | - |
| Ernie DellaPia Sr | 4 | ernie sr 1, ernie sr 2, poultry 1, poultry 2 | $100 | - |
| John Vassallo | 4 | John Vassallo 1-4 *(default names)* | $100 | - |
| Joe Santaguida | 4 | BepeSant 1, BepeSant 2, BepeSant 3, BepeSant 4 | $100 | - |
| Mike Penna | 4 | Mike Penna 1-4 *(default names)* | $100 | - |
| Nolan Lawrence | 4 | Nolan Lawrence 1-4 *(default names)* | $100 | - |
| Tom Bradley | 2 | Tommybrads1, **tommybrads2** *(lowercase t)* | $60 | - |
| Tommy Nataloni | 4 | Tommy, TNat, Ttboy, Tomasso | $100 | - |
| Ron Malandro Jr | 4 | rondro 1, rondro 2, rondro 3, rondro 4 | $100 | - |
| Nicholas James | 4 | Nick&Kels 1, Nick&Kels 2, Nick&Kels 3, Nick&Kels 4 | $100 | - |

Payments to seed:
```
Maria DiCicco   $100  venmo  2026-08-14  txn 4663800776141712543
Brian Yost      $60   venmo  2026-08-17  txn 4665778505896168187
Tim Flaherty    $30   venmo  2026-08-16  txn 4665247903916912167
Marc Massimino  $60   venmo  2026-08-17  txn 204311868M648504R
```

Free entries earned: `FLOOR(9 paid / 10) = 0`.

The legacy Google Sheet is `1CDNZTOLuimbr6A3ydNnUxe9gyodPliH1-JaHzOVojlQ`. Read it once if a field is ambiguous. After the seed, this app is the sole source of truth - do not build a sync.

---

## 10. ACCEPTANCE

The build is done when all of these pass:

1. Public URL loads on a phone in under 2 seconds
2. `/grid` shows 47 entries by 18 weeks, scrolls horizontally with a pinned entry column, cells are legible at 44px
3. Dashboard totals match the ledger exactly, and there is no code path that writes a derived total
4. `tommybrads2` renders lowercase everywhere
5. A duplicate `venmo_txn_id` insert is rejected by the database, not by application code
6. A missed-pick sweep at a passed deadline produces exactly one loss per entry, and running it twice changes nothing
7. Re-importing the same Lynne file is a no-op
8. A variance between Lynne and local state is displayed, never auto-resolved
9. Excel export opens in Excel with the picks matrix intact and conditional fills applied
10. A player opening `/entry/[id]` sees no email, phone, or payment data
11. Every rule in section 3 has a passing unit test
12. Lighthouse mobile performance and accessibility both above 90
