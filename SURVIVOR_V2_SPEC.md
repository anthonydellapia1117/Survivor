# SURVIVOR APP — V2 ENHANCEMENT SPECIFICATION

Repo: `github.com/anthonydellapia1117/Survivor`
Live: `survivor-khaki-eight.vercel.app`
Supabase: project `rpbzsmeqaqzdymfxkrzr`
Written 2026-08-24. Week 1 locks **Tuesday 2026-09-08, 12:00 PM ET**.

Work autonomously inside this repo, its Supabase project, and its Vercel deployment. Do not stop for file creation, migrations, components, or deploys.

**Nothing in this document is ever deleted from view.** Eliminated entries stay in the data and stay reachable. The default view filters to who is still alive; a toggle brings the rest back. That is the governing principle for every list, grid, and table below.

Parts C, F, and G come from reading two seasons of Lynne Piazza's actual emails and her final 2025 spreadsheet. Her conventions are the specification, because her sheet is the system of record that mine feeds.

---

## PART A — ADMIN UX

**A1. Email is the primary contact field.** Phone is secondary and optional. Every add and edit form leads with email. Warn visibly when an owner is saved without one — not a block, but I should never accidentally create an emailless owner.

**A2. Every table sorts and filters.** Owners, entries, payments, picks. Click any column header to sort. A search box filtering across all visible columns. Sort and filter state persists in the URL so a view is bookmarkable and shareable.

**A3. Entries table leads with owner name**, then entry name, status, lives, current pick, teams used. Right now I cannot tell whose entry is whose without cross-referencing.

**A4. One unified owner drawer** opening from any owner row: name, email, phone, source, add entries, rename entries, record payment, merge. Replaces the split between quick-add and the owners table. No hunting across screens.

**A5. Inline editing** for names, emails, phones, and entry names. Anything touching money routes through the ledger.

**A6. `/admin/emails`** — every owner email as a list with a COPY ALL button producing a comma-separated string ready to paste into a BCC field. Filters: all, paid, unpaid, missing email. Show a count and flag anyone missing an address.

**A7. Keyboard navigation** on the pick entry screen. Arrow between entries, type to filter teams, enter to commit.

**A8. Mobile.** Every screen usable one-handed. Grids keep pinned columns and fit-to-width behavior.

---

## PART B — ALIVE / ELIMINATED FILTERING

This replaces any notion of deleting or hiding data.

**B1. Default state is alive-only.** Every entry list, the grid, the roster, and the dashboard standings default to showing entries whose status is No Losses or Loss/Bye. Eliminated entries are filtered out of the default view, never removed from the database.

**B2. A persistent segmented toggle** sits at the top of every entry-bearing screen:

```
[ ALIVE 42 ]  [ OUT 17 ]  [ ALL 59 ]
```

Counts are live. Selection persists in the URL and in localStorage so the choice survives navigation and reload. `ALIVE` is the default on first visit.

**B3. Eliminated entries stay fully inspectable.** Selecting `OUT` or `ALL` reveals them with their complete history: every week's pick, which team knocked them out, what week they went out, and how many weeks they survived. Nothing is truncated because an entry is eliminated.

**B4. Visual treatment for eliminated rows** — present but retired:
- Row opacity 55%
- Status chip reads `OUT` in red with the elimination week: `OUT · WK 6`
- The killing pick is marked distinctly in their history — red fill plus a skull or X glyph
- Their remaining unused teams render struck through, since those no longer matter

**B5. The grid honors the same toggle.** In `ALIVE` mode the grid shows only living entries, which keeps it readable as the season progresses. In `OUT` or `ALL` mode eliminated rows return in place, dimmed, with their full pick history intact so I can see exactly where each one died.

**B6. Owners are never deleted, only merged.** See Part H.

---

## PART C — LYNNE INTELLIGENCE

**C1. She assigns every entry a number**, and it is how she matches everything. Add `lynne_number` (integer, nullable, unique) to entries. My 2025 entries sat around 977-1037 inside her pool of roughly 1,250.

My weekly submission to her looks exactly like this and nothing else is accepted:

```
NO.    NAMES                    Week 13
977    Anthony DellaPia 2       San Francisco
978    Anthony DellaPia 3       LA Chargers
984    Cheeky 2k                LA Rams
1037   Nolan Lawrence 1         Jacksonville
```

Build **`/admin/lynne-submit`**: pick a week, get that exact three-column block as plain text with a copy button. Sorted by `lynne_number` ascending. Only alive entries with a current pick. Entries missing a `lynne_number` surface as a loud warning — I cannot submit those.

**C2. Her standings vocabulary, verbatim.** Every week she writes some version of:

> "No Losses=3, 1 Loss/Bye used=53 and Out=1192. We are down to 56 left in the pool."

Three buckets: **No Losses**, **Loss/Bye**, **Out**. Use her exact words on the dashboard standings panel and every Lynne-facing view. Internal statuses can stay as they are, but what I read and what I send her speaks her language.

**C3. Duplicate team is an elimination in her pool, not a warning.** She wrote:

> "#1121 Adrianna Novello is out due to picking the Chargers twice. Picked in Week 9 and 13."

My app currently treats a repeat as a soft flag. Escalate it:
- Full-width red banner in the pick entry screen, not a badge
- The team appears in the dropdown struck through, marked `USED WEEK N`
- Saving requires a second explicit confirm naming the week it was used
- Entry detail carries a persistent `DUPLICATE TEAM RISK` marker until resolved
- `/admin` shows a red alert if any current pick reuses a team

This is the most common way someone loses a season by accident. Make it impossible to do quietly.

**C4. Her weekly cadence, which the app should mirror:**
- Wed/Thu — she emails Thursday-game picks only, formatted `Dallas-#1110-Damon Dambrosia and #1158-Sondra F`
- Fri/Sat — full week picks with a spreadsheet attached
- Mon/Tue — "Week N Final Sheet" with the three-bucket standings
- Corrections arrive as follow-up emails and must be re-checked

Build **`/admin/week/[n]`** as a single game-week cockpit showing that rhythm: who has submitted, who has not, what locks when, what went to Lynne, what came back.

**C5. I forward her final sheet to my players every week.** Build **`/admin/recap`** — generates a weekly email body I paste and send: my group's standings in her three buckets, who lost and to which team, who is still alive, the next deadline, and any duplicate-team warnings. Plain text and HTML versions, copy button on each.

**C6. Remaining teams is a proven need.** She once forwarded a spreadsheet a friend built showing each player's available teams and called it out as making things easier. Make `/teams` excellent: per entry, all 32 teams as a grid, used ones struck and dimmed with the week they were used, remaining ones clickable to see upcoming matchups.

**C7. Free entries are excluded from remittance**, confirmed in her words:

> "I have you down as 1650. You had 6 free and had 66 players at 25 = 1650."

Verify the remittance view matches: amount owed equals paid entries × $25, free entries excluded. Add a test.

---

## PART D — FULL SEASON SCHEDULE AND SCORES

This is new and substantial. The app has the schedule seeded but shows nothing about what actually happened on the field.

**D1. `/schedule` becomes a week-by-week game board.** Week tabs across the top, current week auto-selected, horizontally scrollable on mobile. Under each week, every game that week — all 13 to 16 of them, not just the Thursday game.

**D2. Each game renders as a card:**

```
┌──────────────────────────────────────────────┐
│  SUN 1:00 PM ET · FOX                        │
│                                              │
│  ● PHILADELPHIA EAGLES          27  ✓ WON    │
│  ● DALLAS COWBOYS               14           │
│                                              │
│  14 entries picked PHI · 2 picked DAL        │
└──────────────────────────────────────────────┘
```

- Team names in their own colors, with a color swatch
- Winner: full opacity, bold score, a check glyph, subtle emerald left border
- Loser: 60% opacity, muted score
- Tie: both amber, marked `TIE` — and a note that a tie counts as a loss in this pool
- Not yet played: both neutral, kickoff time shown, no scores
- In progress: pulsing blue accent, live score if entered

**D3. Pick counts on every game.** Under each matchup, how many of my entries picked each side. Before the deadline this is hidden. After the deadline it is revealed. This turns the schedule into the most-read page of the week.

**D4. Elimination impact per game.** Once a game is final, show how many entries it eliminated: `⚠ 3 entries eliminated`. Clicking expands to name them. This is the carnage view at the game level.

**D5. Score entry at `/admin/scores`.** One screen per week listing every game with two number inputs. Enter a final score, mark the game complete, and results propagate: pick rows update, entry standings recompute, eliminations fire. Echo-confirm before committing a week — restate every result and require an explicit yes.

Scores may be entered manually or, if a reliable free source exists, fetched. Try the ESPN scoreboard API the same way the schedule was verified. If it works, offer a "fetch scores for week N" button that pre-fills the form for my review — never auto-commit. If it does not work reliably, manual entry only, and say so.

**D6. A game's result is the source of truth for pick results.** A pick's win/loss derives from its game, not from a separately entered field. If a score is corrected, every affected pick and every affected entry standing recomputes. Never store a pick result that can drift from its game.

**D7. Season schedule view.** In addition to per-week, a compressed all-18-weeks view: teams down the left, weeks across the top, opponent in each cell with `@` for away, byes dark. Day tags on every game — `We Th Fr Sa Su Mo` — with early-deadline days in amber and late-deadline days muted, since that is how a player knows which deadline applies. This already exists; keep it and link the two views to each other.

---

## PART E — CONDITIONAL COLOR SYSTEM

**E1. Status drives color; color never drives status.** One shared token set used in every table cell, grid cell, chip, and chart series:

| State | Color | Also carries |
|---|---|---|
| No Losses | emerald | clean chip |
| Loss/Bye | amber | `1L` or `BYE` label |
| Out | red | `OUT · WK n` |
| Pending | slate | `—` |
| Winner | gold | trophy glyph |
| Duplicate risk | red, overrides all | `⚠ DUP` |

Red for eliminated is Lynne's own convention from her sheet. Keep it.

**E2. Rules that make color usable rather than decorative:**
- Every colored state also carries a glyph or text label, so it survives colorblindness and grayscale printing
- Eliminated rows drop to 55% opacity
- A row whose deadline is within 6 hours with no pick gets a slow pulse
- Duplicate-team risk overrides everything and shows red regardless of status
- Every color pair clears WCAG 4.5:1 on the dark surface — verify each and fix failures

**E3. Team colors from `teampalettes.com/nfl`.** Ship a static lookup of all 32 primary and secondary hex values in the repo — do not fetch at runtime. Use them on team chips in pick cells, game cards, schedule row labels, pick distribution bars, and the availability grid.

Every team color must clear 4.5:1 on the dark background. Several NFL primaries are too dark — compute a lightened variant per team, store both, and add a test asserting all 32 pass.

**On logos:** use color and typographic treatment, not raster marks. Team logos are trademarked and scraping them creates a licensing problem on a site I share publicly. A well-set three-letter abbreviation in the team's color reads better at grid density anyway.

---

## PART F — ANALYTICS

**F1. Public dashboard**, telling a story to someone with zero context:
- **Hero** — my group's three buckets in Lynne's language as a segmented bar with counts, plus the next deadline counting down with the window named
- **Survival curve** — entries remaining by week, area chart
- **Pick distribution** for the current week, revealed only after the deadline. The single most-wanted view in any survivor pool
- **Carnage report** — which teams have eliminated the most entries this season
- **Chalk vs contrarian** — how often the most-picked team won each week
- **Teams running out** — which are getting scarce across the group

**F2. Per-entry on `/entry/[id]`:** full pick history color-coded with the killing pick marked, teams used vs remaining, next three matchups for each remaining team, weeks survived vs the group median, duplicate-team risk indicator.

**F3. Admin on `/admin`:** missing picks sorted by urgency, any current pick that would trigger duplicate-team elimination, payment gaps, entries with no `lynne_number`, free entries earned but unnamed.

---

## PART G — 2025 HISTORICAL ARCHIVE

Import Lynne's final 2025 spreadsheet, `Football_2025-54.xlsx`, as a read-only archive. Its exact structure, verified:

- One sheet, **1,265 rows** including a header, **20 columns**
- Col 1 `NO.` — Lynne's entry number
- Col 2 `NAMES` — entry name
- Cols 3-20 — `Week 1` through `Week 18`. **Note her inconsistent casing:** `Week 1` through `Week 4`, then `WEEK 5` onward. Parse case-insensitively
- Cell values: a team name, the literal `BYE`, the literal `OUT`, or empty

**Status is encoded in the fill color of the NAMES cell**, not in any column:

| Fill | Meaning | Count in final sheet |
|---|---|---|
| `FFFF0000` red | Out | 30 |
| `FFFFFF00` yellow | One loss or bye used | 28 |
| theme fill | Clean survivors | 13 |
| no fill | The bulk of the field | 1,193 |

Read fills with openpyxl on the **styled** workbook, not `data_only=True`.

**Critical caveat: she deletes eliminated entries as the season progresses.** My Week 13 email to her lists entries 977, 978, 979, 984, and 990 — none appear in the final sheet. Only 980 (Anthony DellaPia 5), 1006 (Alexc 1), and 1037 (Nolan Lawrence 1) survived long enough to still be listed, and all three ended `OUT`. **This file is a shrinking working sheet, not a complete roster.** Do not treat a missing entry as a data error.

**Season outcome:** 27 winners at $1,008.60 each. I had 66 paid entries and 6 free, and owed her $1,650.

Build a read-only `/2025` view: final standings, the winners, my entries and how far each got, and a season summary. Keep the schema structurally separate from the 2026 tables so nothing about the archive can contaminate live data. If this meaningfully complicates the current model, build the schema, leave the UI minimal, and tell me.

---

## PART H — OWNER MERGE, NEVER DELETE

An owner row is never deleted while it holds entries or payments. Merging preserves everything.

- **0 entries and 0 payments** — hard delete plus an audit row. This is the genuine typo case
- **Entries, no payments** — reassign entries to the target, archive the shell
- **Any payments** — reverse and repost each payment, reassign entries, archive the shell
- **Owner is already a merge target** — blocked

Archive means setting `deleted_at`, never a `DELETE`. Add `owners.deleted_at`, `owners.merged_into_owner_id`, `payments.corrects_payment_id`. Every existing query and view filters `deleted_at is null`.

**Moving a payment cannot be an UPDATE under append-only.** It is two new rows — a negative reversal against the wrong owner and a positive repost against the right one, both referencing the original via `corrects_payment_id`. The `venmo_txn_id` UNIQUE constraint will reject the repost, so replace it with a partial index:

```sql
drop index if exists payments_venmo_txn_id_key;
create unique index payments_venmo_txn_id_key
  on payments (venmo_txn_id)
  where corrects_payment_id is null and venmo_txn_id is not null;
```

A genuinely new inbound transaction still lands exactly once. Corrections are exempt because they reference an original.

**Merging flips the pricing tier.** Two owners at 2 entries each pay $30/entry for $120 total; merged into one owner at 4 entries the rate drops to $25 for $100. Due falls $20, silently, since pricing is a computed view. The merge screen must show before and after for entry count, tier rate, due, and paid, and require typing the target owner's exact name to confirm.

A **duplicate-candidates panel** on `/admin/owners` groups owners by normalized name — lowercase, punctuation and whitespace stripped — while displaying names verbatim.

---

## PART I — DATA CORRECTIONS

All verified from Gmail.

**I1. Mary Scalia.** Two duplicate owner rows exist, roughly "mary maria" and "mary & maria". One has an email, one does not. Keep the one **with** the email, merge the other per Part H.

Final state: owner name `Mary Scalia`, 4 entries named exactly `mary & maria 1`, `mary & maria 2`, `mary & maria 3`, `mary & maria 4`.

Her payment, from the Venmo receipt: **$100.00, Venmo, 2026-08-24, transaction ID `4670935325052514255`**, memo "4 spots Mary & Maria".

Show me both rows and what each holds before merging.

**I2. Add Tyrone Hedrick.** `tyrone.l.hedrick22@live.com`, 1 entry, $30, unpaid.
Entry name exactly: **`thedrick's picks`** — lowercase t, apostrophe included.
His words, Aug 24: *"Yes for one entry @ $30. This email is good for the updates. thedrick's picks."*
That apostrophe must round-trip through storage, display, Excel export, and the Lynne submission block. Add a test.

**I3. Add Nicco Esgro.** `esgro6@gmail.com`, 1 entry, $30, unpaid.
Entry name exactly: **`Nicco E`**
His words, Aug 23: *"I am in for 1 entry name it Nicco E"*

**I4. Fix Tommy Nataloni's email.** Currently `tnataloni@comcast.net`. Correct address is **`tnat@me.com`** — he replied from it and wrote "4 entries Tnat@me.com" giving it explicitly for updates.

**I5. Fix James DiCicco's entry names.** Currently `James DiCicco 1` through `4`. My own confirmation email used **`Jim DiCicco 1`** through **`Jim DiCicco 4`**. Rename all four. He pays cash in person.

**I6. Declines.** Set `participation_status` to declined if they exist as owners; do not create them if they do not:
- Jerry Gialloreto, `jpgialloreto@comcast.net` — "Not in…" Aug 21
- Anthony Z, `az7623@verizon.net` — "I am not interested in either of these" Aug 21
- Marc Virga, `mvirga@1creative.com` — "im OUT on survivor" Aug 17

**I7. Audit every email.** List every owner with no email on file. Alec Hess has none. Do not write an address you are not certain of — report the gap instead.

---

## CONSTRAINTS

Names stay verbatim everywhere — `tommybrads2` is lowercase, `thedrick's picks` keeps its apostrophe. The ledger is append-only. Every write is audited in the same transaction. No cascade deletes. Public routes never expose email, phone, or payment amounts. The 2025 archive is strictly read-only and structurally separated from 2026. **Eliminated entries are filtered from default views, never deleted or made unreachable.**

## TESTS

- Alive/Out/All toggle returns correct counts and persists across navigation
- An eliminated entry's full pick history remains readable in `OUT` and `ALL` modes
- Merge preserves total paid and preserves entry names verbatim
- Merge of 2+2 yields 4 entries at $25/entry for $100 due
- Reversal and repost both insert despite a duplicate transaction ID
- A genuinely new payment with an existing transaction ID is still rejected
- Delete of an empty owner succeeds; delete of a non-empty owner is rejected
- An apostrophe survives storage, display, and Excel export
- All 32 team colors clear WCAG 4.5:1 on the dark surface
- The Lynne submission block renders in her exact three-column format
- Duplicate-team detection catches a repeat across non-adjacent weeks
- Remittance excludes free entries
- A corrected game score recomputes every affected pick result and entry standing
- The 2025 import parses mixed-case week headers and reads status from fill colors

## REPORT

Production URL, the new totals, and screenshots of: the dashboard, the grid in `ALIVE` mode, the grid in `ALL` mode showing eliminated entries, the week schedule with scores, and the Lynne submission screen.
