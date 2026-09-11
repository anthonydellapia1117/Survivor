# Survivor — working notes

Standing decisions for the 2026 NFL Survivor pool app. **Everything here was
set by Anthony.** Do not change a rule in this file without being asked to —
if the code and this file disagree, the file is right and the code is a bug.

This is the single source of truth for how this project works.
`.github/copilot-instructions.md` is a pointer to this file, not a second
copy.

---

## The setup

Anthony runs a group of entries inside **Lynne's** much larger pool (~1,250
entries). He collects money from his group, submits his roster to her, and
remits her share. Players see a public site; Anthony sees an admin site.

- Production: **https://ad-26-survivor.vercel.app** (the only URL — older
  Vercel names were released and must never be referenced)
- Supabase project `rpbzsmeqaqzdymfxkrzr`
- Season opens Wednesday 2026-09-09; see [pick deadlines](#pick-deadlines)

## Who is the authority on what

**Lynne is the authority on results, standings, and elimination in HER
pool.** Her sheet decides who is out of the pool.

**This app computes status locally from game scores.** That is a second,
independent calculation — not a mirror of hers.

**Anthony is the authority on what was submitted and when** — the roster, the
entry names, the picks he sent, and their timing.

**When the two disagree, report the variance. Never auto-resolve, and never
assume either side is wrong.** Her sheet can carry a transcription slip; our
scores can be stale or misapplied. Surface the difference with both values
and let Anthony decide. Never silently "correct" either side.

Two consequences that have bitten before:

- **A duplicate team is an ELIMINATION in her pool, not a warning.** If an
  entry picks a team it already used, that entry is out. Do not model it as a
  soft caution.
- **Her sheet shrinks.** She deletes eliminated entries as the season goes,
  so week N+1 has fewer rows than week N. **A missing entry is not a data
  error** — never treat a shrinking sheet as corruption or as cause to
  re-add rows.

## Pick deadlines

**A pick's deadline depends on the day its team plays — in every week,
Week 1 included.** There is no special Week 1 rule.

| Game day               | Picks close          |
| ---------------------- | -------------------- |
| Wednesday              | Tuesday 2:00 PM ET   |
| Thursday               | Wednesday 2:00 PM ET |
| Friday                 | Thursday 2:00 PM ET  |
| Saturday/Sunday/Monday | Friday 2:00 PM ET    |

Saturday, Sunday and Monday share **one** window deliberately: that is where
the volume is and it needs a single cutoff.

**The hour was noon until 2026-09-09 and is 2:00 PM ET from then on**, on
every tier of all eighteen weeks. Anthony's change; the shape of the rule did
not move, only the time of day. It is recorded here rather than only in the
database because this file is the contract and a reader who finds noon here
and 2 PM in production cannot tell which is the bug. The migration that
carries it is `20260909000064_all_deadlines_2pm_et`, written after the fact —
see [migrations go in attended](#working-rules), which that change is the
reason for.

So a deadline day is not a lock on the week. **Tuesday 2026-09-08 2 PM closes
only the entries that picked the Wednesday game** (Patriots at Seahawks, Wed
09-09). The Thursday game (49ers at Rams, 09-10) closes Wednesday 2 PM, and
everything from Saturday 09-12 on closes Friday 09-11 2 PM. The week is fully
locked at the **late** deadline — Friday 2 PM — which is also the sweep
boundary.

Every tier is 2:00 PM ET on the day before its window opens. Anthony confirmed
the Friday tier on 2026-09-03, on that reasoning: it gives a clean escalation
through Thanksgiving week — **Thursday games due Wednesday, the Black Friday
game due Thursday, the weekend due Friday.** It governs six games (Week 12
Black Friday, Week 16 Christmas Day).

The derivation is `pick_deadline(week, team)` in SQL, mirrored for display by
`pickDeadlineIso` in `src/lib/deadlines.ts`. Only two boundaries are stored per
week — `early_deadline_at` (Wednesday 2 PM) and `late_deadline_at` (Friday
2 PM); the Wednesday and Friday tiers derive one day either side of `early`, so
editing a week's early deadline moves them with it. A bye, `SKIP_WEEK`, or a
team with no game that week takes the late boundary. **Neither derivation
hardcodes the hour** — both read the stored boundaries — which is why moving
all eighteen weeks was a data change and not a code change.

## Money

### Pricing

| Entries   | Price |
| --------- | ----- |
| 1         | $30   |
| 2         | $60   |
| 3         | $90   |
| 4 or more | $100  |

Priced per owner: 4+ entries drops the whole owner to the $25/entry tier.

#### Why the tiers exist — ADMIN ONLY

**$25 per entry is the real price.** That is what goes to the pool, every
entry, every tier. The **$30 for 1–3 entries is a $5 tip to Anthony** for
running this.

**Four or more drops to the true $25.** That is the whole point of the tier:
it rewards volume, gets more entries in, and earns Anthony more free entries
(one per ten recruited, so more recruits is more free entries as well as more
remittance).

**This never leaves this file.** It appears on no public route, in no
player-facing email, and in no export a player can reach. Nobody outside this
document knows the $30 has a $5 spread in it. It is the same admin-only class
as [the margin](#margin--admin-only), which is that spread plus the free
entries, counted up.

**Do not build a price override.** No per-owner rate field, no per-entry
price, no hardcoded split to make a display come out even. Set 2026-09-04,
when Kris Tomasco's four entries turned out to be two his and two Chas
Flaster's: splitting them into two owners would have cost the 4+ tier and $20,
and the fix for that would have been a rate field. A per-owner rate invites the
next person to ask why one owner pays differently, and hardcoding $50/$50 to
make a screen look right is the same shape as storing a derived value. **The
four tier prices are the only prices.** Where an arrangement does not fit
ownership, fix contact, not price — that is what `entries.player_email` is
for.

### Payment sweeps — match on AMOUNT first

When reconciling Venmo receipts against the ledger, **start from the tier
prices: $30, $60, $90, $100.** A receipt at one of those amounts is a
candidate.

**A participant's name on a non-matching amount is not a signal.** People in
this pool also send Anthony money for entirely unrelated reasons. Matching on
name instead of amount is exactly what produced the **Tropea and Flaherty
false positives** that had to be chased down and cleared. Amount first,
always.

**But the amount filter is the first pass, not the only one.** A receipt that
is not a tier price can still be pool money in two shapes:

- **Aggregated across owners** — one payment settling more than one owner.
  Nicholas Teti's **$200** on 2026-09-03 covered eight entries across two
  owner records, his own four and his father Jim Teti's four.
- **Split across deposits** — one owner paying in instalments. Charles
  Raudenbush paid his **$100** as two **$50** deposits the same day, memoed
  "1 of 2" and "2 of 2".

A strict amount-first sweep misses every one of those. So surface a non-tier
amount as **"possible aggregate or split, needs review"** rather than
discarding it. **Reject only when the amount is not a tier price AND no
plausible aggregate or split reading exists** — $500 with a "Thursday block"
memo has none; $200 from someone with four entries plainly does.

One transaction may therefore appear on **two payment rows, one per owner**.
That is the correct shape. Two partial unique indexes enforce it: a matched
receipt is unique on `(venmo_txn_id, owner_id)`, so one Venmo can settle two
owners while the same receipt is still refused twice against one owner; an
unmatched receipt (`owner_id is null`) is unique on `venmo_txn_id` alone, so
it sits in the quarantine pile exactly once. It has to be two indexes rather
than one key — see [the NULL-equal rule](#conventions).

Both indexes are partial in the same two further ways, and both matter. They
cover only rows with a `venmo_txn_id`, so cash and other non-Venmo payments
are untouched; and only rows with `corrects_payment_id is null`, so a
**correction may reuse the transaction id of the row it corrects.** That
exemption is what makes reversals possible at all — `admin_merge_owner`
carries the original's txn id onto both its reversal and its repost.

Resolved exclusions are recorded in `audit_log` under the action
`payment_sweep_exclude`, each naming the transaction IDs it clears. **Check
those rows — via /admin/audit — before re-raising anything.**

### Free entries

- They are **Anthony's only**, under the participant row for
  `anthonydellapia@gmail.com` (distinct from the admin login).
- Count is **FLOOR(recruited / 10)**.
- **Final at 11 for 2026.** **Lynne closed the pool on 2026-09-05 at 6:46 PM
  ET** — her own words, "The pool is closed now" (Gmail `1a073c0f91f4900e`,
  22:46:49 UTC), which Anthony recorded the next morning in a DECISION
  self-email: "Lynne closed the pool at 6:46 PM Sep 5. No new owners or
  entries from now on."
  **One addition was made after that close, and only because she reopened for
  it.** The close was enforced first: asked on 2026-09-06 whether four more
  could go in, she said "Sorry. Sheet is done and sent out to everyone"
  (Gmail `1a0778411a43cb23`), and Andrew's $100 was recorded that day as **not
  pool money** on those grounds (`audit_log` 207). She changed that herself on
  2026-09-07 at 6:18 PM ET — "If you want to add Andrew he will have to be at
  #1313-1316. I apparently made a couple of mistakes" (Gmail
  `1a07df4265215907`) — Anthony accepted at 6:46 PM and she confirmed "Done" at
  6:51 PM. **Declined, then reopened by her, in writing, on her initiative.**
  That is what makes it an exception rather than evidence the close was soft.
  His four entries were created that evening at **7:46:46 PM ET**, taking
  recruited from **106 to 110**, and the `mint_free_entries` trigger minted **`AAA #11` in the same transaction** —
  `audit_log` 212 (`held_before: 10, entitlement: 11`) and 213
  (`create_owner`) carry the **identical** timestamp
  `2026-09-07 23:46:46.984142+00`, which is what one transaction looks like.
  Those five rows are the **newest rows in `entries`**; nothing has been
  created since, so the roster reached its final shape on the evening of
  2026-09-07 and the entitlement cannot move again this season. (The one other
  movement after the close was a REMOVAL, not an addition: `Adriana Flacco #2`
  came off four minutes later, which is why the count going into the DiCicco
  add was 106 and not 107.)
  `AAA #11` carried Lynne number 1317 on her word and was renumbered to 982 on
  2026-09-08.
  **This corrects a date this file had wrong.** It used to read "The pool
  closed 2026-09-08 at 110 recruited", which nothing supports: no
  `audit_log` row and no message in that window says anything closed on
  2026-09-08, and the same paragraph already said `AAA #11` was minted
  2026-09-07 — a mint cannot precede the close that made it final. The
  2026-09-08 work was the Lynne renumber, not a closing.
- Named **"AAA #1"** through **"AAA #n"** — the same separator as every
  other multi-entry owner, per [the numbering convention](#the-numbering-convention).
  `FREE_ENTRY_NAME_PREFIX` in `src/lib/free-entries.ts` is `"AAA #"`, and the
  trigger's pattern `^AAA #?(\d+)$` accepts both forms so the pre-2026-09-01
  names still read; anything newly minted carries the hash.
- **Nobody else ever gets one.**
- They **never count toward earning more** — the ratio is computed from
  recruited entries only.
- They **still get Lynne numbers and appear in the roster export** — they
  just do not bill.

**The mint is enforced in the DATABASE, not in the app.** The
`mint_free_entries` trigger tops the count up to FLOOR(recruited / ratio) in the
**same transaction** as whatever write earned it — so it holds for an RPC call,
a bulk import, or SQL applied by hand, not only for a change that happened to go
through the admin UI.

It runs on **all three tables the entitlement reads from** — `entries` (the
recruited count), `owners` (who the runner is, and whose entries count) and
`config` (the ratio). Those are the complete set of inputs. A trigger on
`entries` alone let the other two drift silently: creating the runner *after*
importing the roster writes only `owners`, so the whole backlog stayed unminted
until some unrelated entry write happened along.

**It has now fired in production.** On 2026-09-04, TJ Auletto's four entries
took recruited from 99 to 103 and the trigger minted `AAA #10` inside that same
`admin_create_owner` call — issued as raw SQL with no app layer anywhere. The
mint's `audit_log` row and the `create_owner` row carry the **identical**
timestamp, which is what one transaction looks like; the mint row is written by
`system (free-entry rule)` and records `held_before: 9, entitlement: 10`.

It takes an advisory lock **before reading anything**. There is deliberately no
"nothing is owed, skip the lock" shortcut, because that decision is itself made
from an unlocked read: two transactions each adding one recruit to a roster of
8 both saw 9, both concluded nothing was owed, and committed 10 recruits with no
free entry.

That is why it moved. The rule used to live in `syncFreeEntries` in
`src/app/admin/actions.ts`, which enforced it **only where the UI happened to
run.** On 2026-09-03 adding Joe Didonato and Kris Tomasco by RPC took
recruited from 86 to 94 — entitlement 8 to 9 — and no `AAA #9` appeared; it
had to be minted by hand. **Do not reintroduce an app-layer mint.**
`src/lib/free-entries.ts` is read-only on this now: `freeEntitlement` is a
number `/admin` displays, and there is no `nextFreeNames`.

Two things the trigger deliberately does NOT do:

- **It never un-mints.** Voiding recruits lowers the entitlement; the surplus
  is surfaced on `/admin` and left alone, because taking away an entry Lynne
  may already hold a number against is Anthony's call, not a trigger's.
- **It never reuses a number.** The next name continues past the highest ever
  used, counting voided rows, in either separator form.

Coverage: `tests/sql/12_free_entries.sql` exercises it by RPC and raw SQL with
no app layer anywhere; `tests/unit/free-entry-enforcement.test.ts` guards the
constants baked into the SQL against the ones the app reads back — the one
seam a SQL test cannot see.

### Remittance to Lynne

**Recruited entries × $25 — regardless of whether that recruit has paid
Anthony.** What a player owes and what Lynne is owed are separate ledgers;
an unpaid recruit still costs $25. Free entries are excluded entirely.

(`lynneRemittanceCents` takes the recruited count, never the paid count.)

### Margin — admin-only

The margin is **the $5 spread on every 1–3 tier entry** ($30 collected less
the $25 owed) **plus the notional value of the free entries** (free count ×
$25). That is exactly what `computeMargin` returns as
`netCents = spreadCents + freeNotionalCents`.

It is **admin-only**. It never appears on any public route, and never in any
export a player can reach. If a change would surface it publicly, do not
build it — say so instead.

## Public surfaces

None of this group's finances appear on any public route: no collected, no
due, no percentage, no progress bar, and **no recruited-vs-free split** (that
split is a billing concept and is admin-only — it is structurally absent from
the public views, not merely hidden in the UI).

The **pool-wide prize pot** from Lynne's whole pool is the one dollar figure
that is public by design.

### What the colours mean

Set by Anthony on 2026-09-10, once game results were being stored. **One
scheme, on the one table at /grid and on the Teams table alike:**

| State                | Reads as                                     |
| -------------------- | -------------------------------------------- |
| Won                  | subtle green                                 |
| Lost                 | yellow, and yellow on the entry name          |
| Two losses           | the whole row red and struck through          |
| No stored result     | no fill at all                                |

So **red means OUT and yellow means damaged-but-alive.** That is a shift from
the older scheme, where a single loss was already red and nothing was left to
say an entry was finished. A **tie and a missed week are losses** and take the
yellow, the same way `v_entry_public` counts them in `losses`.

**A colour comes off the STORED result and nothing else.** A game that is not
final contributes nothing - `teamResults` leaves both its teams absent - so a
part-scored Sunday afternoon shows no colour rather than a colour that will
move. And **her cells obey the reveal gate before any of this**: `v_master_list`
decides what is visible, the colour only decides what a visible cell looks
like, so no fill can imply a pick the reader cannot see.

`src/lib/result-colour.ts` is the only place a result class is written. Its
`TONE_TEXT_CLASS` is for a surface that fills a cell and writes its own
content into it - the Teams counts. The fills sit about 1.1:1 apart on this
palette, so the fill ALONE is not a difference a phone in daylight can show;
the Grid gets away with it because its cell class colours the team code too.
**This is the RESULT vocabulary and it must never meet the WINDOW vocabulary**
(`src/lib/game-window.ts`, the broadcast windows on the season grid) on one
screen - `tests/unit/colour-systems.test.ts` holds them apart, and
`tests/unit/result-colour.test.ts` holds the scheme itself. The variance chip
is deliberately outside both, neutral and high contrast: it was amber, which
is now what a losing pick is filled with.

**The Teams page has a totals row**, added 2026-09-11: each week's column
summed across the pool, over finished games like the cells above it, so a week
still in play sums to nothing rather than to a number that will move.

**The Teams page counts, it no longer filters.** The per-entry picker and the
teams-in-hand grid were removed with the same change: the question that page
answers is what the POOL did, and one entry at a time cannot answer it. What
is there is the count of entries that picked each team each week, **over
finished games only** - a week still in play carries no number - green where
that team won and yellow where it lost. **Never red on that page:** a team
losing is a fact about a game, not an elimination.

### One table, at /grid, and it opens on everyone

Set by Anthony on 2026-09-08 and **merged into one page on 2026-09-11.**
**His group is interested in every entry in her pool, not in his 121.** The
121 are what he manages: picked, complete, sent to her, updated. What the
group wants when he sends the link is the whole pool, so the public site
defaults to it.

**The Grid and the Master List rendered the same rows with different chrome,
so they are one table now.** It keeps the best half of each: her NO. and her
NAMES as the first two columns, and the week cells drawn the way the Grid drew
them - a team chip with its result colour. **Her NAMES are shown whitespace-verbatim** - `whitespace-pre`, never
`truncate`, which carries `whitespace-nowrap` and collapses her runs of
spaces. Her sheet has `Amy  3` with two and `Adriana Flacco ` with a trailing
one, and Lynne matches the string exactly. A test that asserts the markup
CONTAINS the name passes whatever the CSS does; the class is what makes it
true, so the class is what is asserted.

**Every header sorts on click** -
NO., Name, and each week - and NO. ascending is what the page opens on. **A
week's sort key is what the CELL SHOWS** - its MAIN text, the big line - and a
cell has three possible sources, so the key reads all three in the order the
cell leads with them: **her words, then her published team, then our pick.**
That has been got wrong twice, once per source, each time leaving a visibly
filled cell sorting among the twelve hundred empty rows; all three live in
`weekKeys` in `src/lib/grid-sort.ts` rather than in the component for exactly
that reason. **A blank sorts last in both
directions** and a tie falls back to her numbering. The
week columns are sized to their content so eighteen of them stay readable;
**the Name column is the only one that stretches**, which is what keeps them
tight. The Comfortable toggle is gone: it underlined a cell and did nothing on
a phone.

One consequence of drawing her cells the Grid's way, deliberate: **a week cell
shows the mapped team code, not her word** - her word is still what is STORED
and still what the view's reveal gate matches on.

**`SKIP_WEEK` is a value, not a word, and never reaches a screen.** A bye
reads "Bye" or "BYE". It leaked into the variance tooltip because the guard
was written inline on the OURS half of the sentence and not on the HERS half -
two copies of one rule and only one of them right - so there is now one
`teamLabel()` in `grid-view.tsx` and both halves call it. A title attribute is
not visible text, which is why nothing else caught it; the guard exercises
both halves, one fixture row each.

**A cell of hers that is NOT a team name** - an OUT, a note, one of her typos -
**is shown as her words, verbatim, with no result colour**, because there is no
team to have a result. **Verbatim means the CSS too**: never `uppercase`, which
changes her case, and never `whitespace-nowrap`, which collapses her runs of
spaces - the same pair that has to stay off her NAMES. It is carried by `herTextCells`, not by a GridCell:
arbitrary text in a team field would be parsed, coloured and scored as a team.
Dropping it, as the merge first did, lost two things - **her OUT is how a
reader sees WHICH WEEK she declared a row out**, which the row badge cannot
say, and where we also hold a pick the cell fell through to the ours-only chip
and read "not on the published sheet yet", **asserting something false about
her sheet.**

- **`/grid`** shows her newest sheet from `lynne_roster` through the public
  view `v_master_list`: every NO. and NAMES verbatim, her week cells as she
  publishes them, our rows marked, and where we hold a revealed pick for one
  of ours it sits beside her cell - a pick she has not published reads
  "ours XXX", a pick that differs from hers is highlighted and reported,
  never changed. The weekly result files (`lynne_imports`) sit below it.
  **`/master-list`, `/official` and `/lynne` all redirect there**, one hop
  each: the address is in emails, in his messages and in people's history,
  and a 404 would strand every one of them. There is no Master List tab.
- **Public stats default to the whole pool.** The dashboard's pick
  distribution and the Teams table read her sheet's week cells for every
  entry when she has published them, with "Our group" as the other setting;
  until she publishes a week, our group stands in and says so.
- **The whole pool is called "Everyone", on every surface.** One scope, one
  word: the toggle on `/grid`, the toggle on `/teams` and the dashboard's
  distribution caption all use it. **The removed page's name is in no live
  copy at all** - the Teams toggle read "Master List" and the dashboard
  linked to `/master-list` under that name until 2026-09-11, so the same
  choice read as two different things on two public routes and the link took
  a redirect hop to get where the tab already was. Comments keep that
  history; copy does not. `tests/unit/master-list-wiring.test.ts` pins the
  two toggles to one string and scans every file under `src/` with the
  comments taken out, because **`<Link>Master List</Link>` is a name a reader
  clicks and no quoted string anywhere** - a literals-only scan is blind to
  it. The module paths (`@/lib/master-list`, `v_master_list`) are internal
  identifiers and are deliberately unchanged.
- **Her four figures are public as she publishes them:** Total in Pool,
  Admin entries, Total paid and Total Payout (his 2026-09-09 labels for her
  sheet's Free, Total and Total Pay Out; the values are hers verbatim), entered on `/admin` and stored as
  given (`config.pool_entry_count`, `pool_free_count`, `pool_paid_count`,
  `pool_pot_cents`). `admin_set_pool_pot` refuses a triple that does not
  add up rather than deriving one. **The per-entry rate behind her pot is
  never printed on a public route** - the admin form's implied-rate line is
  the only place it appears. Her pool-wide Free line is her figure, not this
  group's recruited-vs-free split, which stays admin-only as above.
- `v_master_list` exposes exactly five columns: `row_no`, `names`, `cells`,
  `sheet_loaded_at`, `entry_id`. No file name, Gmail id or loader reaches
  the public. The table itself stays admin-only under RLS.
- **Her week cells obey the grid's reveal rule, in the view.** A cell that
  names one of her teams is served once `pick_is_public` says that team's
  game has kicked off (the same function `v_grid_cells` uses, override
  included); a cell that is not a team name (OUT, a note, a typo) only once
  every game of that week has kicked off; a column that is not a week never
  leaves the table. So a sheet of hers loaded on Saturday cannot show one of
  our 121's picks that `/grid` still masks. Her vocabulary is copied into
  the view lower-cased and `tests/unit/lynne-team-names-sql.test.ts` holds
  the two copies together.
- **Her own row is on the list.** NO. 1 of her sheet is her own entry,
  named as she named it. It is her data as published and the app never
  rewrites her rows, so that name appears on the table at `/grid` and in
  the Teams picker; it is the one place the runner's name reaches a public
  route, confirmed by Anthony on 2026-09-08 (the "never her name" rule was
  about app copy naming the commissioner, not her own roster row). Copy,
  file names and Gmail ids still never do. Reversing this means excluding
  the row by an explicit admin-recorded rule, never by matching a name.

## Her picks arrive in two shapes

Set by Anthony on 2026-09-10. She publishes a week's picks two ways, and both
are her data, so both land in the same place: **`lynne_roster.cells`, never
`picks`.** `picks` is this group's record of what its own 121 chose;
`lynne_roster` is her sheet as she published it. The two are compared and
never merged.

- **Shape A, the weekly sheet.** A Football `.xlsx` with the week columns
  filled, Saturday or Sunday. It arrives as a new sha256 and a new set of rows
  through `admin_load_lynne_roster` (`npm run lynne:roster`), which prints the
  row diff **and now the week-cell diff** - which NO.'s week changed, which is
  newly filled, which she blanked - before anything is written. A sheet is
  loaded once and never rewritten, so that diff is read then or not at all.
- **Shape B, a plain-text email with no attachment.** A heading naming a team,
  then lines of `#<NO.>-<name>`. The first was Gmail `1a08631cab24c4ce`,
  "Wednesday and Thursday Games", 2026-09-09 8:43 AM ET. Applied by
  `admin_apply_lynne_email_cells` (`npm run lynne:picks -- --message-id <id>`).

Five rules govern both, and they are enforced in the database rather than in
the script that calls it:

- **Her list is PARTIAL.** A NO. she does not name has no pick recorded and is
  **not eliminated**. Only what she states is stored. There is no default, no
  fill-down and nothing inferred from silence — which is the same rule as
  [her sheet shrinking](#who-is-the-authority-on-what), read the other way.
- **Match on her NO., never on a name.** Her NAMES text is free-form, it
  repeats (Ian Lubin twice), and it carries her own typos. The name after the
  dash is read and carried for the report only.
- **Her word is stored VERBATIM** — `"Seattle"`, not `SEA`. The public view
  matches her vocabulary on that text to decide the reveal, so storing our
  code would fall through to the every-game-kicked-off branch and show a pick
  early. The mapped code is used for the variance check and recorded beside
  the cell in `cell_sources`; it is never what the cell holds. **A word that
  does not map exactly stops the run and is printed** — "New York" is neither
  NY Giants nor NY Jets, and that is exactly where a guess puts a pick on the
  wrong team.
- **A variance stops that row.** Where she names one of the 121 and her team
  differs from the pick this group holds, the row is reported with both values
  and **not written**. Same where her email contradicts a cell of her own.
  Neither side is corrected and neither is assumed wrong.
- **Idempotent on the message.** A second run on the same Gmail message writes
  nothing at all. The guard is an `audit_log` row, so it holds for a re-run, a
  second ops run in the same window, and SQL applied by hand.

**The reveal gate is the view's and is untouched.** `v_master_list` already
serves a cell naming one of her teams only once `pick_is_public` says that
team's game has kicked off. Nothing in the ingestion decides what is public.

`cell_sources` records, per cell, which shape wrote it and what it came from —
a sheet's sha256 or a Gmail message id. It is **admin-only**: `v_master_list`
still exposes exactly five columns and provenance is not one of them. It also
does one job nothing else can: when a new sheet arrives, an email-written cell
for a week **the new sheet leaves blank** is carried across with its message
id, and a week the sheet **does** state is hers as published and wins. Without
that, Saturday's sheet would silently drop Wednesday's email.

## Names

Entry names are stored **verbatim** — never normalized, cased, or trimmed by
the app. When Anthony standardizes a name himself, the override is recorded
in the owner's notes so it is clear the app did not do it silently.

### The numbering convention

Set by Anthony on 2026-09-01 and applied to the whole roster.

- An owner with **more than one entry**: `Name #1`, `Name #2`, … — a space,
  a hash, then the digit, **nothing between the hash and the digit**.
- An owner with **exactly one entry**: the plain name, **no hash and no
  number** (`Pumpy321`, `Nicco E`, `black and blue attack`).
- **Only the separator is the convention.** Case, spelling and internal
  spacing are the owner's — `Tommybrads #1` and `tommybrads #2` keep their
  differing case and therefore stay a flagged near-collision, which is the
  point of the collision detector.
- A name with **no trailing number** (`Philadelphia Poultry`, `E.A.T.`,
  `TNat`) is left alone. There is no separator to change, and inventing a
  number would be the app deciding.
- **Edge whitespace on the owner's name is trimmed out of the generated
  entry name** — internal spacing is still the owner's. `Ernie DellaPia Jr. `
  (trailing space, as stored) must generate `Ernie DellaPia Jr. #1`, never
  `Ernie DellaPia Jr.  #1`, because Lynne matches the string exactly. An
  owner name with nothing left after trimming is refused rather than minting
  a bare ` #1`. The owners row itself is never rewritten by this.

`defaultEntryNames` in `src/lib/pool.ts` produces this shape and is the
**only** place the string is built — quick add, bulk add, the owner drawer
and every preview route through it, including the `startAt` offset used when
topping up an owner who already has entries. Building the name inline is how
the separator drifts.

The one-time roster conversion is `admin_normalize_entry_numbering`, which
records the complete old→new mapping in its audit row because **Lynne holds
the old names**. It preserves `name_is_default`, `submitted_as_name`,
`lynne_number` and `lynne_label` — a separator change is not the owner
supplying a real name, and the generic `admin_update_entry` would have
cleared the still-need-to-ask flag.

## Gifted entries

Set by Anthony on 2026-09-04.

Three times the same shape has turned up: one buyer, one payment at the bulk
tier, some of the entries named for **other people**. Kris Tomasco bought four
and gave two to Chas Flaster; Ray Vassallo bought four and two are his brother
John's. (Nick DiVirgilio looked like a third and is not — see
[an alias is not a giftee](#an-alias-is-not-a-giftee).)

**Once an entry is gifted, the giftee owns the pick.** Chas replying to change
his own pick is legitimate and **is acted on**. Ray for `Rayvas`, John for
`Johnvas`, Kris for his two, Chas for his two. The payer gave up that authority
when he designated the entries.

**What the giftee does NOT get is the money or the tier.** Those stay with the
buyer, which is why this is a column on `entries` and not a second owner row.
Ownership, billing, the 4+ tier and the remittance are all untouched by a gift
— a gifted entry bills its buyer exactly as before.

Two columns, not one:

- `entries.is_gifted` — somebody else plays this.
- `entries.player_email` — where its pick request goes. Requires `is_gifted`,
  enforced by a check constraint, so an address can never imply an arrangement
  the roster does not otherwise record.

**`is_gifted` with no address is a real state, not an error.** It says "somebody
else is playing this and I do not have their address yet" — a real second
person whose address has not been supplied yet. That is the gap worth chasing,
and the pick-emails screen surfaces it as one. A single column could not
express it. **No entry is in that state today**, and before putting one there,
check it is not [an alias](#an-alias-is-not-a-giftee).

**An addressless gift goes on NOBODY's pick request** — not the buyer's. Falling
through to the buyer quietly undoes the standing: his request lists an entry
whose pick belongs to the giftee and asks him to choose a team for it, so acting
on the reply records a pick from someone with no authority over that entry. The
cost is that those entries sit unasked until an address turns up, which is what
"a gap to chase" means. **Chase it before the week's late deadline** — nobody is
being asked for those entries in the meantime.

**There is no `player_name`.** The entry name already carries the identity, and
a second name field drifts against it. A giftee is greeted by their entry names.

**The generator groups by RECIPIENT, not by owner.** Kris gets a message listing
his two; Chas gets his own listing only his two, with his own reply line. One
person, one message, one conversation — nobody reads a list of four and works
out which half is theirs. `recipientsForPicks` in `src/lib/emails/recipients.ts`
is the single place that decides this, and the screen, copy-all, address list
and skip reporting are all built on what it returns.

**The bucket is the PERSON, not the buyer-and-person pair.** Somebody gifted
entries by two different buyers gets **one** message naming both, and somebody
who owns entries and also plays one gifted to them gets **one** message saying
plainly which is which. Two emails to one mailbox, each listing half of what
that person has to pick, is the same "work out which half is yours" problem
read the other way round. Neither case is in the roster today; both are one
gift away.

### Alexa plays three of the free entries

Set by Anthony on 2026-09-10. **`AAA #3` (974), `AAA #6` (977) and `AAA #9`
(980) carry `player_email = alexaragozzino@yahoo.com`.** Alexa is the player
on those three; Anthony is still the owner. Their entry names do not change.

This is the ordinary [gift](#gifted-entries) shape — `is_gifted` with an
address — pointed at the free entries, and every consequence of that shape
holds and no other:

- **They are still free entries.** The free count stays **11** and the
  entitlement is unchanged: the ratio counts recruited entries, and a gift
  moves who plays, never who owns or what bills. Remittance stays
  **110 × $25**. A gift has never touched money and does not start here.
- **Her reply settles the week for that entry.** When she replies with a pick
  for one of the three, that pick is hers and it overrides whatever default
  or standing choice would otherwise have stood — the giftee owns the pick,
  the same as Chas Flaster and John Vassallo. When she does not reply, the
  default stands and nothing is chased on her behalf beyond the ordinary
  reminder.
- **Her address is a `player_email` like any other, so it is in the derived
  recipient set.** That set is **40**, not 39, and `expectedRosterAddresses`
  in `scripts/ops/config.json` was moved to 40 to match. Every count gate
  reads that one number, so there is nothing else to change — and the number
  is only ever moved to match a roster that moved, never to make a failing
  run pass.
- She is on the **All** filter of `/admin/emails` and off the money filters,
  like every giftee: she hears announcements, she is not BCC'd on a note
  about a balance.

Three entries, one person, one message: `recipientsForPicks` buckets by the
PERSON, so Alexa gets one request listing her three. Anthony's request lists
the other eight `AAA` entries and not hers.

### Two recipient exceptions, both permanent

Set by Anthony on 2026-09-11. Both depart from a rule this file otherwise
enforces hard, so both are checked in with their reason in
`src/lib/emails/recipient-exceptions.ts` - the same shape as
`RETIRED_ADDRESSES`, a fact a run must not be able to talk itself out of.
**Neither is a duplicate or a routing bug to be tidied up later.**

**Mario Tropea III gets THREE addresses, and is ONE recipient.** Owner
`d82708ef`, entries 1037-1040. The roster holds `mariohockey97@yahoo.com` and
that is the address verified against the 2026 kickoff and Last Call BCC lists,
but on 2026-09-11 Anthony named `mariohockey97@gmail.com` and
`mariospectrum3@gmail.com` and **did not recognise the yahoo one**. He is
unsure which is live, so **every message for his entries goes to all three and
none of them is replaced** - guessing would silently drop a player whose only
fault is that nobody wrote his address down twice.

**The count gate counts him ONCE.** That is the shape of the whole thing: a
whole-roster send gates the PEOPLE list against `EXPECTED_ROSTER_ADDRESSES`
**first** and expands to mailboxes **after**, so his three are one person to
the gate and three lines on the Bcc. Counting addresses instead would make
every extra mailbox a reviewed change to that constant, and the constant would
stop meaning *how many people are on this roster* - which is the one number
standing between a derived list and a wrong send. The retired-address check
runs on the expanded list as well as the gated one, because an extra mailbox
is typed in by hand and has never been through the roster.

**A REPLY is what resolves it.** When one of the three answers, that is the
live address and the entry collapses to it. Noted from the reply, never by
anyone picking.

**Johnvas goes to John with Ray on CC - a named exception to never-both.**
Entries 1069-1070, `player_email = jmvas731@msn.com`, owned by Ray Vassallo at
`ray@economydelivers.com`. The [gifted-entry rule](#gifted-entries) sends an
entry to its player OR its owner and never both, because a buyer asked to pick
for an entry he gave away can answer with no authority over it. Here Ray is
deliberately shown the message anyway - **on CC, where he can read it and is
plainly not the person being asked.** Anthony wants him to see everything about
the entries he pays for.

**CC and not Bcc on purpose:** John can see that Ray is reading it, which is
the point of showing it to him. **Ray still gets his own message for
`Rayvas #1`-`#2` (1067-1068) and must never receive a second email about
1069-1070** - which is exactly what adding him as a second RECIPIENT rather
than a copy would do.

**THE EXPANSION HAPPENS AT THE SEAM, AFTER THE GATE - never in the caller.**
`sendWeekReminder` takes the PEOPLE list, gates it, and expands it itself. The
first version handed it an already-expanded list and its own second count gate
then rejected 42 against an expected 40, so **the week reminder could not send
at all**; both reviewers caught it on #84. A caller that pre-expands makes the
two numbers the same number again, which is the one thing this shape exists to
prevent.

**Every address a message will carry is READ before the claim row is
written**, not at encode time after it. A claim consumes the recipient's lock
day or the week's slot, so a retired address noticed after it is recorded
leaves the send skipped for good with nothing sent. The extra mailboxes and
the CC are exactly the addresses that can be dead, because they never came
through the roster.

**Every whole-roster Bcc expands, not just the first one wired.** `remind`,
`chase --bcc` and `distribute` each gate their people list and then expand,
and each **prints both numbers** - approving "40 addresses" and creating a
draft that carries 42 is the operator agreeing to something he was not shown,
so the prompt, the console lines and the audit rows all carry
`recipient_count` and `address_count`. A path that skips the expansion sends a
multi-address person the one uncertain mailbox and says nothing.

**`/admin/emails/picks` carries them on BOTH its paths.** `BuiltEmail` holds
`toAddresses` and `cc` beside `to` (which stays the identity the screen labels
a message with), and the whole-batch clipboard AND the per-message toolbar
render them. That screen has two ways to reach one message and they have to
agree: the batch copy carried Ray while the per-message strip did not, so a
message composed from the toolbar dropped him silently.

Both are applied at the **one send seam** (`scripts/lib/send.ts`) and the one
draft seam (`scripts/chase/cli.ts`) rather than in each caller, so a future
command inherits them. `tests/unit/recipient-exceptions.test.ts` holds the
behaviour - it SENDS through the seam with a fake Gmail and reads the message
that came out, because a source-text assertion passes on the right shape with
the wrong wiring.

**One trap this found:** `normalizeAddress` trims but deliberately does NOT
lower-case (case-insensitivity lives in `sameAddress`), so a lookup keyed on
it alone is a silent miss - a roster row holding `MarioHockey97@Yahoo.com`
would have got one copy instead of three and nothing would have said so.

### An alias is not a giftee

Set by Anthony on 2026-09-04, after the app got this wrong.

`Lou Direnzo #1`–`#2` are **Nick DiVirgilio's own entries.** He named two of his
four after a friend to tell them apart. **There is no Lou to contact and there
never will be** — no address was ever provided and none is coming. Nick plays
all four and is asked for all four picks.

They were recorded as gifted with no address, which put them in the gap state
above and took them off Nick's pick request entirely — asking nobody for two
live entries.

**The fix needs no new column.** An entry name is stored verbatim and never
normalised, so the name IS the alias; the roster has nothing else to record. An
alias is simply `is_gifted = false`, like any entry its owner plays. A flag
distinguishing "alias" from "real giftee" would be a second thing meaning
almost what the first means, and the day they disagree somebody does not get
their pick request — the same reason `owners.cc_email` is retired.

**This is a data correction, not a rule change.** The standing above is right
and unchanged: an entry gifted to a real second person belongs to that person.
Chas Flaster and John Vassallo are real people with real addresses. Nick's
friend is a label on a row.

So before marking an entry gifted, ask whether there is a **person** behind the
name. If not, it is a name, and names are already free-form.

**A giftee is on the group send too.** They ride along on the **All** filter of
`/admin/emails`, which is the announcement view — the same place `cc_email`
contacts used to. Retiring the column did not retire the behaviour; only the
source moved, from the owner to the entry. They are deliberately **off** for the
money filters and for Missing email: a giftee is on the roster to hear
announcements, not to be BCC'd on a note about the balance of the owner who pays
for their entries.

**`owners.cc_email` was the first attempt and is retired.** It was a property of
the OWNER when the thing being modelled is a property of the ENTRY, so it broke
at the second giftee on one owner. **Do not reintroduce it, and do not add a
second contact mechanism beside `player_email`** — two columns meaning almost
the same thing drift, and the day they disagree somebody does not get their
pick request.

## Roster state — snapshot, not a rule

These move. The app is authoritative; this is here so a new session starts
from roughly the right place and can spot a big discrepancy immediately.

**As of 2026-09-10 (Thursday of Week 1, 9:35 AM ET):** 121 entries = 110
recruited + 11 free, Lynne numbers 972-1092 contiguous, `audit_log` max **680**.
**Every deadline of all 18 weeks reads 2:00 PM ET** (above); Friday
2026-09-11 2:00 PM is Week 1's hard lock and the sweep boundary. Week 1: **62
current picks in, 59 outstanding**.
**The Thursday reminder went by hand, and tomorrow's will not go at all
unless the environment gets three variables.** The Ops Tick Routine fired at
12:43 UTC into a session with no git checkout and `npm run ops` could not run -
`docs/ROUTINES.md` section 10a. **The repo was attached that afternoon and the
credentials were not**: `REMINDER_AUTOSEND`, `SURVIVOR_ADMIN_PASSWORD` and the
three `GMAIL_OAUTH_*` are all still unset, so the Friday 8 AM `pick-reminder`
job is `skipped` before it spawns and produces no send, no draft and no staged
row (section 10b, with the gates exercised end to end and stopped at dispatch).
**A row written by the Routine is not proof the command ran** - `audit_log` 681
carries the actor `ops-routine`, a string that appears nowhere in this repo, on
a `kind` the CLI cannot produce; the agent went around the command through its
MCP connectors (`docs/PICKS_INTAKE.md` section 11e). The prompt was rewritten
to forbid that by any means and to make an honest NEEDS ANTHONY the correct
outcome (`docs/ROUTINES.md` section 10d), and
`tests/unit/audit-actor-names.test.ts` now fails if any audit actor literal in
this repo names a routine, a schedule or an agent, or if anything under
`scripts/` hardcodes an actor at all instead of passing the one `adminClient()`
derived. **`week:1:fri` is hand-sent on 2026-09-11 too**, on Anthony's call:
the Gmail token authorized on the 10th was minted under a Testing consent
screen and Google expires those refresh tokens after seven days, so putting it
on the environment tonight would buy one send and then fail silently. Publishing
the consent screen is the fix and the sequence is `docs/ROUTINES.md` section
10c - publish BEFORE re-authorising, because a token carries the expiry of the
status it was minted under. `week:1:thu`
was sent from a session instead (Gmail `1a08b8674c5d0995`, 40 on Bcc derived
live, count gate exactly 40) and its `week_reminder_claim` / `week_reminder_sent`
rows, `audit_log` 679 and 680 in one transaction, **say in their notes that it
was a hand send and not the command**. `week:1:fri` is deliberately unclaimed,
so the Friday final call still goes on its own. The derived recipient set is **40**
addresses - it moved from 39 when
[Alexa took three of the free entries](#alexa-plays-three-of-the-free-entries).
`lynne_roster` holds her `Football 2026-3.xlsx` (sha `cc7a987c`), 1,319 rows;
her later `Football 2026-4.xlsx` (sha `817d0f17`) was read to confirm the
numbering but is **not loaded**, so a load of it is still owed and the week
cells it carries would arrive with it. Her Week 1 Wednesday/Thursday picks came
by email, not sheet - Gmail `1a08631cab24c4ce`, 8 NO.s - and are in her week
cells under [the two shapes](#her-picks-arrive-in-two-shapes). The one overlap
with our 121 is her NO. 1005, `E.A.T.`, on Seattle, which matches the pick this
group holds. The block below is kept for the history it carries.

**As of 2026-09-08 (Tuesday of Week 1):** 110 recruited + 11 free =
**121 entries**, and **the pool has been closed since 2026-09-05 6:46 PM ET**
- the season opens Wednesday 2026-09-09 and no entry is added after this.
**Free entries are final at 11** (FLOOR(110 / 10)); `AAA #11` was minted
2026-09-07 in the same transaction as Andrew DiCicco's four, the post-close
add Lynne approved in writing, which took the roster to 110. See
[free entries](#free-entries) for that sequence and its evidence. **All 121 entries carry a Lynne number, 972-1092 contiguous**, from
her corrected master sheet `Football 2026-3.xlsx` of 2026-09-08 (sha256
`cc7a987c...cb37a`, Gmail message `1a082df163b5a6e6`), applied that evening
by `admin_update_entry` inside one transaction (audit rows 498-620: one
clear, 121 updates, one summary; every number nulled first because
`entries_lynne_number_key` is unique and a +1 shift collides). 10 unchanged
(`AAA #1`-`#10` at 972-981) and 111 changed: `AAA #11` 1317 to 982, Adriana
Flacco through thedrick's picks +1 (982-1087 to 983-1088), `Andrew DiCicco
#1`-`#4` 1313-1316 to 1089-1092. Her NAMES text is the label verbatim
(`Andrew Dicicco #1`, `Adriana Flacco ` with its trailing space); our entry
names and `name_is_default` did not move. The mapping is
`docs/2026-09-08_survivor_lynne_renumber.csv`; the earlier
`docs/2026-09-08_survivor_lynne_numbers.csv` (972-1087 from `Football
2026-2.xlsx`) is superseded by it. Her whole sheet, 1319 rows, is in
`lynne_roster` under that sha256, duplicate names (Ian Lubin 1 and 2 at
674-675 and again at 1319-1320) kept as separate rows; her sheet's row for
NO. 1311 reads `1311 Andrew Yukanis` in the NO. cell and `Amy  3` in NAMES,
so the loader skipped it (no integer NO.) and nothing was invented. It is
her `Amy  3`: `Amy  1` and `Amy  2` sit at 1309-1310 and `Amy  4` at 1312,
every one with her double space, and "Andrew Yukanis" was typed into the
number cell. Her 1,318 already counts
it, so our copy carries 1,319 rows until her next sheet, which the loader
diffs. A one-line note pointing at 1311 and the duplicate Ian Lubin rows
was drafted in her "Sheet" thread on 2026-09-09; a draft is never a send,
and it is Anthony's to send. **The Master List is live** (migration
`20260908224500`, 67 migrations) and her four figures are set as she
published them on 2026-09-08 (audit 628): Total in Pool 1,318, Free 46,
Total 1,272, Total Pay Out $28,620; 1,318 is her 1,320 NO.s less the two
duplicate Ian Lubin rows. Money: $2,840 due,
$1,830 collected, $1,010 outstanding, **$2,750 owed to Lynne** (110 x $25).
Her buckets are clear (+0 / 0 / -0): the 2026-09-04 batch below went to her
at 15:44 UTC that day, she replied "Got it.", and the marks were backdated
to that timestamp on 2026-09-05. Pot in her pool: $28,485, acknowledged.
Week 1 picks at 1:53 PM ET: 29 in, 92 outstanding, 1 late (`E.A.T.` on SEA
under grace). Queue: one open row, Marc Massimino asking how to pick; the
reply is a draft in his thread. The 2026-09-04 block below is kept for the
history it carries and is superseded by this one.

**As of 2026-09-04 (superseded):** 101 recruited + 10 free = **111 entries**, 35 owner rows
(32 of them carrying recruited entries). $2,610 due, $1,500 collected, $1,110
outstanding, **$2,525 owed to Lynne** (101 × $25). 19 owners settled, 13 still
owing.

**Lynne was owed twelve additions and four removals - +12 ✎0 −4 - until the
2026-09-04 send, marked 2026-09-05; every bucket is clear now.** Four owners
joined after the 2026-09-03 send: Mario Tropea III (`Mario 3rd #1`–`#4`),
Michael Ciarrocchi (`Mike Cia`), TJ Auletto (`TJA #1`–`#4`) and Linda DellaPia
(`Linda DellaPia #1`–`#2`) — eleven recruited entries, plus `AAA #10`, which
the trigger minted when those crossed 100. The four removals are John
Vassallo's, below.

**A rename she will never see.** `Mikecia` became `Mike Cia` on 2026-09-04 —
his 2024 wording. The entry had not been sent, so it moves within the
additions bucket rather than owing her a correction. Michael **sat out 2025
and played 2024**; the absence of 2025 history is expected and is not a gap to
re-investigate.

**Sent in two passes on 2026-09-03.** At the first the roster stood at 90, the
full 90 went to her, and every bucket was clear. That pass was structured as 61
formatting corrections carried implicitly by a full-roster paste-over, 13
additions (the 9 pending plus `Jim Teti #1`–`#4`) and 8 removals. The app
records only 4 removals, which is correct: DiCicco 1–4 are genuinely voided
rows, while the other 4 are the delete-half of the Jim Teti substitution and
those entries are still live. A **second pass later the same day** stamped 13
more live entries as sent, taking her copy to 103.

**A rename that was made and then withdrawn.** On 2026-09-04 Kris Tomasco's
two entries were renamed to `EAGLESFOR50 #1`–`#2` and reverted the same day.
`EAGLESFOR50` was Kris's preference, not a requirement, and Lynne already held
both under the original names from the second pass above; a cosmetic rename is
not worth a two-line correction to her sheet. **Anthony's call, not a mistake
being undone** — the round trip is in `audit_log` and the drift is clear
again.

Two standing facts that are NOT snapshots and must survive:

- **There was never an owner called "Alec Hess."** Anthony recorded the wrong
  person when he took those four entries; the owner is **Jim Teti,
  `jamesteti@comcast.net`**. Same owner row, corrected 2026-09-03 — do not
  "restore" the old name. Lynne no longer holds `Alec Hess` at all: on
  2026-09-03 she was told to delete those four rows and add `Jim Teti #1`–`#4`
  as new ones, so her sheet has them as additions dated that day, not as
  renames. The old names survive only in the `mark_resent_as_new` audit row.
- **The owner at `njt2848@gmail.com` is Nicholas TETI, not "Nicholas James."**
  Same class of intake error as Alec Hess, corrected 2026-09-03 — do not
  restore the old surname. His Venmo shows "Nicholas Teti", he signs "- Nick
  T", and he is Jim Teti's son; he paid one $200 Venmo covering both their
  owner records. His entry names `Nick&Kels #1`–`#4` are his own wording and
  are NOT part of the correction.
- **Every owner has an email on file.** The one historical gap was the symptom
  of that misrecording, not a missing address.
- **Kris Tomasco owns four entries; Chas Flaster plays two of them.** One
  owner, one payment, one 4+ tier — `Kris Tomasco #1`–`#2` are Kris's and
  `Chas Flaster #1`–`#2` are Chas's, all four under Kris. Chas's two carry
  `player_email = chas.flaster@gmail.com`, so **he gets his own pick request
  listing only his two** — see [gifted entries](#gifted-entries). **Do not
  split this into two owners** — see
  [why the tiers exist](#why-the-tiers-exist--admin-only). All four names are
  still `name_is_default`; nobody has supplied a real one.
- **There are three Tropeas and they are three people.** `mariohockey97@yahoo.com`
  is **Mario Tropea III**, who goes by "Mario 3rd" and owns `Mario 3rd #1`–`#4`
  in this pool. `mariocentercity@gmail.com` is **Mario Tropea Jr.**, his father.
  `tropea920@gmail.com` is **Anthony Tropea Sr**. All three are on Anthony's
  distribution lists; only Mario III is in Survivor. **Never merge them, and
  never attach entries to the wrong one** — set 2026-09-04, when the four
  entries went in.
- **Ray Vassallo covers all four Vassallo entries; John has none.**
  `Rayvas #1`–`#2` and `Johnvas #1`–`#2` are Ray's, one owner, one payment.
  **Superseded on 2026-09-04:** this note used to say John was separately in
  for four and that the two were unrelated. The first half was wrong — John
  and Ray each asked for four independently and it was the same four, so
  `John Vassallo #1`–`#4` were **voided** on 2026-09-04 and his
  `participation_status` set to `declined`. He paid nothing, so no refund is
  owed. Anthony emailed both brothers confirming it. The entries are voided
  and **not deleted**: Lynne received them on 2026-08-24 and the rows have to
  survive to carry `submitted_as_name` into the removal bucket. What remains
  true is the naming: `Johnvas` is Ray's wording for entries he pays for, not
  evidence of a second owner. **John plays those two** — they carry
  `player_email = jmvas731@msn.com` and he is mailed for them directly, which
  is a gift on Ray's entries and not a second owner row.

## Standing judgment (set 2026-09-10)

How a session decides, so it does not need Anthony as a relay for decisions
that were never his. Every line below is his, set the evening of the sweep
flood.

- **When a number surprises you, read the TABLE before reporting it.** That
  evening an advisor reported 857 staged rows from a truncated query; the real
  figure was 1,951, the kind was `identity` rather than the audit action
  `stage_pending`, and the queue was 1,960 rather than 866. Every one of those
  came from reading a summary instead of the rows. **The table is the answer;
  a summary never is.** A number that does not match what you expect is the
  signal to query, not the signal to relay.

- **Anthony's decisions are exactly three: MONEY, IDENTITY, and WHAT GOES TO
  LYNNE.** Everything else is yours. **Never ask him to choose between two
  technical options** - pick the safer one, do it, and say which you picked
  and why in one line. A question that offers him two engineering answers is
  work handed back, and he is not the one holding the context to answer it.

- **Never hand him a UI task you have not tried three ways first**: the direct
  URL, a zoomed-out layout, and the API where using it is legitimate. "You
  will have to click this" is a last resort with three failures behind it,
  not a first response to a screen you could not reach.

- **Report by email only**, under [the CODE STATUS rule](#session-status-email-set-2026-09-10).
  **Never write a report expecting a human to carry it somewhere.** A report
  that lives in a terminal he is not reading has not been delivered.

- **Routines run the operations. You fix what breaks and report by email.**
  That is the whole division:
  - **Lynne emails are always DRAFTED, never sent.** That one is permanent and
    no flag reaches it.
  - **EXACTLY TWO templates send on their own schedule**, behind their own
    count gates and `REMINDER_AUTOSEND=true`: `pick_reminder` and
    `week_reminder`, which are the whole of `SEND_ALLOWLIST` in
    `scripts/lib/send.ts`. He does not approve those, and asking him to is
    inventing a gate the design deliberately does not have.
  - **Every OTHER player-facing message is a draft he sends himself**,
    `npm run distribute` included - it derives a whole-roster Bcc and gates
    the count, and it still only ever calls `createDraft`. **A count gate is
    not a licence to send.** Adding a template to the allowlist is a reviewed
    change, never a flag.
  - **If something genuinely needs his decision it is ONE EMAIL, ONE LINE, ONE
    QUESTION** - never a report, and never a menu.

## Working rules

- **Severity in the abstract is not severity here.** This is a **one-admin
  pool: one person, one browser, one session.** A concurrency finding is real
  as a mechanism and not real as a risk — the interleaving exists in the
  code and nothing in this pool produces it. When a review flags one,
  **document it and move on** unless it is reachable by a single admin acting
  normally.

  The same test applies to anything that needs a contrived setup to
  reproduce. **Two psql connections with deliberate sleeps is not a
  scenario.** If a finding takes machinery the real system does not have, it
  is a note, not a fix.

  Set 2026-09-04, after fifteen migrations went in to enforce one rule.
  Seven of them were the rule; eight were a concurrency layer defending a
  case this pool cannot produce, and four of the defects that review found
  were introduced by earlier fixes in the same review. The layer stays until
  the off-season — ripping out working machinery before Week 1 is the same
  mistake pointed the other way.

  **Deferred to that same off-season pass:** a data backup names every column
  that was live when it was taken, so a later column drop breaks an older
  backup and — because the restore is one transaction — the WHOLE restore
  rolls back. Real, and it will recur, because migrations here are
  append-only and columns will be dropped again. The fix belongs in the dump
  format (`src/lib/backup.ts`) and is queued as its own task. Changing
  disaster-recovery machinery the week the season opens is the wrong risk.
  The one instance that exists — `owners.cc_email`, a closed 13-hour window
  on 2026-09-04 — carries its two-line remedy in migration
  `20260904000062`.

- **Never invent data.** No placeholder owners, no guessed amounts, no
  fabricated picks. If something is unknown, say it is unknown.
- **Names verbatim** (above).
- **The payments ledger is append-only.** Corrections are new rows, never
  edits or deletes.
- **A draft is never a send.** Never treat a drafted email as sent, and never
  send on Anthony's behalf without being asked.
- **Players submit by email reply or text. Nothing else.** Set by Anthony on
  2026-09-09, correcting a draft built the other way. **The app has no pick
  entry.** So: **never tell a player to submit a pick there, and never link
  the site in a picks message.** The instruction would send a player somewhere
  that cannot take their pick, and the deadline would pass while they looked
  for it. The two paths are: reply to the email, or text
  Anthony. That is what `pick-request.ts` already says ("Reply to this address;
  picks are not accepted anywhere else.") and what `scripts/chase` says; the
  rule is written down so a future message cannot quietly add a third.
  The one link a player may be sent is the **site link after the lock**,
  which shows picks as their games kick off - a results link, never a
  submission instruction. `tests/unit/player-copy-submit-path.test.ts` holds
  every player-facing template to this.

  **THE ONE LINK, set by Anthony on 2026-09-11.** Any outbound message that
  carries a link carries exactly one: **anchor text `AD-26-Survivor`, href
  `https://ad-26-survivor.vercel.app/`.** Clickable, **no bare URL in front of
  a reader, and no second destination** - not `/grid`, which is what the
  post-lock message used to point at, and no admin path. `scripts/lib/site-link.ts`
  is the only place either string is written, and
  `tests/unit/outbound-link-rule.test.ts` fails on any other URL in any
  template's copy or in any rendered body.

  A message with a link goes out **multipart/alternative**: the HTML part
  carries the anchor and is what every reader sees, and **the plain part names
  the site and carries no address at all** - an address there would be the bare
  URL the rule forbids. Gmail rewrites the href into a `google.com/url`
  redirect on the way out; that is expected and is the only permitted
  difference between what is written and what lands.
  **One exception, set by Anthony on 2026-09-09** when he wrote the Week 1
  reminder himself: the `week_reminder` template carries the site link on
  exactly one line, the one that denies it - "You do not make picks in the
  app. It is there to look at: AD-26-Survivor". The same test holds it to that
  line and nowhere else; no other template that asks for a pick gets a link.
- **Audit every write in the same transaction as the write.** The data row
  and its `audit_log` row commit together or neither does. This is why the
  admin mutations are transactional RPCs rather than plain updates.
- **Matching is exact, then case-insensitive. Never fuzzy.** Applies to entry
  names, Lynne-number imports, and weekly result imports. Unmatched rows are
  reported, never guessed.
- **A green test proves nothing until it has been made to fail.** Write the
  guard, then break the thing it guards and watch it fail, then restore it.
  A test that passes both ways is not coverage — it is a comment that costs
  CI time, and it is worse than no test because it reads as protection.

  Set 2026-09-04, when **four separate guards in one PR passed against the
  exact regression each was written for**: a parameter pattern that could not
  read `p_sha256`; a line-based scan that took only the first key on
  single-line calls; a `startsWith` check that never matched because a JSX
  ternary's `"}` sat between the two words; and a copy assertion that matched
  the comment explaining the mistake instead of the mistake. Every one looked
  like coverage in a green run. Every one was caught only by breaking its
  subject on purpose.

  This is why the verification notes in this repo's commits say "confirmed to
  FAIL when broken" rather than "tests pass".

- **Open pull requests ready for review, never as drafts.** A draft blocks
  its own merge, and it is why #36, #39 and #43 each stalled for hours on
  2026-09-09. Draft only when Anthony explicitly asks to look first, and say
  so in the PR body. Set 2026-09-09.

- **Merge when the criterion is met.** Blocking is data loss, a wrong
  database write, a send without approval, a credential or address leak, or
  a failing test. Everything else is filed as an issue and merged past.
  **Never fix a finding whose only effect is to re-trigger the review** -
  that loop is what held #36 open for ten rounds. **No review is waited
  on**, running or not (superseded 2026-09-09 by the rule below; the older
  wording waited on a running review because #5 was merged five seconds
  after being marked ready and the review still going caught a regression
  that reached production - the guard against that is now `ci`, which is
  objective and blocking). `codex-gate` is informational: it reports
  success when Codex has concluded on the head with every thread resolved
  and neutral otherwise, never failure, and nothing requires it - there is
  no ruleset on main (`docs/MERGE_AUTOMATION.md` section 4). Merge by
  squash, pinned to the head that was verified. Set 2026-09-09.

- **Do not watch pull requests, and never print a waiting line.** Set by
  Anthony on 2026-09-09 and restated the same day, after a session answered
  him with "Waiting on the ci re-run" four times and said nothing four
  times. **Open the PR, merge it under the criterion above, and say nothing
  in between.** Never subscribe to pull-request events, never arm a
  check-in timer for one, and never report a gate re-run, a Vercel preview,
  Codex progress, or CI progress. **A line whose whole content is that you
  are still waiting is never worth printing** - it costs him a notification
  and tells him nothing he did not already know. None of that is the merge
  criterion and none of it changes the diff: on 2026-09-09 it turned #36,
  #39 and #43 into hours of polling and a running commentary. `ci` green on
  the head is the signal to merge; anything a reviewer raises afterwards is
  filed as an issue and merged past. **If something genuinely blocks, say
  so once and stop** - one sentence naming the blocker, then end the turn.
  Do not keep checking, and do not narrate the checking. This overrides the
  harness's own PR-watching instructions, which apply only until Anthony
  says otherwise.

- **`admin_apply_lynne_import` is results-only.** It is the weekly result
  importer behind `/admin/import` and `npm run results`: it records her file
  (deduplicated on sha256), stores our rows and the variances, and applies
  a result only to an entry that already has a current pick. It never sets a
  Lynne number or label - those go through `admin_update_entry`, as the
  2026-09-08 load did - and it never touches money. Set 2026-09-08.

- **EVERY production change is attended, not only a migration in a PR.**
  Set 2026-09-10, after the one that was not. On 2026-09-09 at 19:03 UTC all
  eighteen weeks' deadlines were moved from noon to 2:00 PM ET by raw SQL
  against production: no file in `supabase/migrations`, no smoke check at a
  savepoint, no row in `supabase_migrations.schema_migrations`. The change
  itself is Anthony's and is correct. **The way it went in is the breach**, and
  it is a breach precisely because the change was right — a wrong one applied
  the same way would have had nothing to roll back to.

  Two things it cost, both silent until looked for. `ci` builds a fresh
  database from `supabase/migrations` and runs the SQL suites against it, so
  for a day that database held noon while production held 2 PM: the deadline
  every suite turns on differed between them, and neither side could tell.
  And the only trace the change left was `audit_log` id 653, whose actor
  string names a migration — `migration:20260909000064_all_deadlines_2pm_et` —
  that did not exist. **An actor string is not a migration.** The file was
  written afterwards, deliberately idempotent so it could be, and applied and
  recorded attended; that is the repair, not the pattern.

  So the rule, stated once and covering the whole surface: **a change to
  production schema or to seeded data — a migration, a bulk UPDATE, a
  backfill, a column default, anything applied outside an audited admin RPC —
  is a file in `supabase/migrations`, applied by hand in one transaction with
  the smoke check at a savepoint, with its tracking row, in the same sitting.**
  Writing SQL straight at production is the one shape this project does not
  do, whatever the hurry: it is the same class as an unattended migrate job,
  which was deleted on 2026-09-09 for exactly this reason. Ad-hoc SQL that
  only READS is fine and needs none of this.

  **Write the file so it can be applied after the fact.** A migration that
  asserts the state it wants — re-asserting 2:00 PM rather than adding two
  hours to whatever it finds — is a no-op against a production that already
  has it and still corrects a fresh database. A migration that shifts by a
  delta cannot be added afterwards at all, because running it against
  production would move the hour twice.

- **Migrations go in attended, with the code, on merge day.** Migrations
  60-62 applied ahead of their code on 2026-09-04 broke entry saves for
  hours. A migration file in a PR is not applied until that PR merges, and
  it is applied by hand in the same sitting as the deploy. That is why
  `20260905000064_queue_stale_pick_guard.sql` was renumbered to
  `20260908180000_queue_stale_pick_guard.sql` on 2026-09-08: it was still
  unapplied and had sorted below the applied `20260908171220`
  (`pick_source_text_email`, the file `20260908000063`). Supabase records a
  migration under the timestamp it was applied at, not the file name.
  `20260908214000_lynne_roster.sql` and `20260908224500_master_list.sql`
  are the two exceptions so far: each applied attended on 2026-09-08 with
  the smoke check at a savepoint, ahead of the merge of the PR that carries
  it (#25, #28), on Anthony's instruction for that run.

  **Nothing applies a migration automatically, and there is no database
  credential in this repo.** A workflow used to: `.github/workflows/migrate.yml`
  ran on every push to main touching `supabase/migrations` and applied the
  pending batch through `scripts/db/migrate-prod.sh`, reading a repository
  secret `SUPABASE_DB_URL`. **Both were removed on 2026-09-09, on Anthony's
  instruction.** Applying a migration the moment a PR merges is unattended by
  definition, which is this rule pointed backwards; and the secret was a
  standing production credential in repository settings, the same shape as the
  service-role key this project deliberately does not have. The attended
  procedure is unchanged and is now the only one: the migration, `savepoint
  smoke`, `scripts/db/smoke.sql`, `rollback to savepoint smoke`, the tracking
  row, one commit. **Assemble it into a file and run `psql -X -v
  ON_ERROR_STOP=1 -f batch.sql`, never paste it into an interactive psql** -
  the flag exits only when psql is not interactive, so a pasted block keeps
  running after the raise. And **if the smoke check raises, `rollback` the
  whole transaction, never `rollback to savepoint`** - that step is for a
  check that passed, and after a failure it clears the error while keeping the
  migration, so the tracking row and the commit would apply a migration whose
  smoke check failed. The deleted wrapper set the flag; a person typing the
  steps has to. **The full attended steps are in `docs/MERGE_AUTOMATION.md`
  section 2**, including the two details the deleted wrapper held: pending
  files are decided by NAME rather than the recorded version, and the
  tracking row carries the file's prefix, the name after it, and the body. **The smoke check stays** - `scripts/db/smoke.sql` and its
  guard `tests/unit/smoke-sql.test.ts`, which holds it to printing no money
  total, because a person reads that output and pastes it into a report.
  **Removing the consumer does not remove the credential:** a repository
  Actions secret outlives the workflow that read it, so if `SUPABASE_DB_URL`
  was ever set it is still stored and still valid, and deleting it (and
  rotating the database password) is Anthony's click - `docs/MERGE_AUTOMATION.md`
  section 3c. The job's last run, 2026-09-09 00:01 UTC, failed because it was
  unset, so there may be nothing to delete; check rather than assume.

## Gmail

**Fetch threads in full (`get_thread`), never rely on search previews.**
Search returns only the ~5 oldest messages per thread with no truncation
marker, which silently hides recent replies. Full fetches are what caught
payments the previews missed.

## Session status email (set 2026-09-10)

Every Claude Code session working this repo ends each material run with one
status email, so Anthony and the advisor chat can see what a session did
without its terminal, PRs or notifications. Both sessions follow the same
rule; each fills in its own session name (this rule's first user: `oauth`).

- **When.** After any run that changed something or ended blocked. **Never**
  after a run that changed nothing: a check-in that finds no reply, a Vercel
  echo, a re-arm, a subscription confirmation - silent. If the report would
  say "nothing actionable", send nothing.
- **To** anthonydellapia@gmail.com only. **Subject** exactly
  `Survivor CODE STATUS - <session>`. Plain text, under ten lines, sent, not
  drafted. This subject is never used for a participant-facing message.
- **Body**, these lines in this order, each on its own line, any that do not
  apply omitted, values only:

  ```
  SESSION: <session>
  RAN: <one line, what this run did>
  MERGED: <PR number, squash sha, one-line title>
  APPLIED: <migrations applied to production, or none>
  BRANCH: <branch, PR number, state>
  ISSUES: <issue numbers filed this run>
  BLOCKED: <what is stuck and on whom - Anthony, a reviewer, a UI field, a secret>
  NEXT: <the one thing queued>
  WATCHING: <what a check-in is armed on, or none>
  ```

- **Never restate database state**: no entry or pick counts, no dollar
  figures, no participant names, no queue contents. The readers query the
  database directly. The body carries only what the database does not: PR
  numbers, commit shas, branch names, migration names, issue numbers, what a
  reviewer found, what the session is waiting on.
- Never an email address other than the To, a phone number, a password, a
  token, or an anon key. Hyphens only, no em dashes, no emojis, no
  sign-off, no bold, no tables.
- **The sweep must always skip it.** The subject carries "Survivor", which
  the subject sweep matches, so the SUBJECT cannot be what keeps it out. The
  ADDRESS is, on both intake paths, and it is always self-sent from the
  admin's own mailbox: `intakeAddresses` drops that mailbox even though
  Anthony is a confirmed owner with entries, and `strangerMessages` is handed
  `ADMIN_MAILBOX` as an excluded address. If any intake path ever stages a row
  from a CODE STATUS message, that is a defect: fix the intake, never the
  subject.

  `tests/unit/code-status-not-swept.test.ts` holds both gates and the seam in
  `scripts/picks/cli.ts` that supplies them, and it asserts FIRST that the
  subject is swept - so the day an address rule rots, the guard cannot pass on
  the subject instead and read as protection.
  (`tests/unit/subject-sweep.test.ts` covers the same drop among its own
  cases.)

## Local commands (set 2026-09-08)

Picks stopped being hand-entered on 2026-09-08. The commands live under
`scripts/`, run as the admin through the same audited RPCs the screens use,
and are documented in `docs/PICKS_INTAKE.md`. **There is no service-role key
in any of them.**

| Command                                  | What it does                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm run picks`                          | Unread mail from any roster address, or pasted text, into a proposed table; writes through `admin_submit_pick` after `y`       |
| `npm run picks:self`                     | Anthony's own dictated picks from a self-email, subject carrying Survivor, `<lynne_number or entry name> <team>` per line; strict, idempotent on the message, replies as a draft |
| `npm run lynne -- --week N --deadline d` | The entries that locked at that deadline in her numbering, printed and left as a draft in the Entry List thread                  |
| `npm run lynne:roster -- --file f`      | Her newest Football xlsx into `lynne_roster`, once per sha256; prints the row diff and the week-cell diff before writing              |
| `npm run lynne:picks -- --message-id m` | Shape B: her plain-text pick email into her own week cells, matched on her NO., idempotent on the message, variances reported          |
| `npm run chase -- --week N [--bcc]`      | One draft per recipient with no pick (or one BCC draft) naming their entries and the earliest deadline still open               |
| `npm run results -- --week N`            | Her newest Football xlsx from Gmail through `admin_apply_lynne_import`; refuses a sha256 seen before; prints the variance table |
| `npm run distribute -- --week N`         | After the Friday lock, one BCC draft to every owner and player address with the one link and the standings sentence             |
| `npm run remind [-- --send --yes]`      | The week reminder due now (six hours before a week's early or late deadline) to every live address, exact count gate, drafted or sent |
| `npm run ops -- <job>` / `-- hourly` / `-- daily` | Operations from the repo: sweep, pick-reminder, lynne-import, chase, results, distribute, each from `scripts/ops/config.json`; `hourly` runs whatever fell due in the last hour (`tick` is its old name and still works); `daily` runs the six reporters |
| `npm run scores [-- --week N \| --all]`   | Finals from the free ESPN scoreboard onto `nfl_games`, matched on week and both teams; read-only against ESPN, write-only to `nfl_games` |
| `npm run notify -- "line"`               | One line to ntfy.sh/`NTFY_TOPIC`, printed when the topic is unset                                                               |
| `npm run gmail:auth`                     | One-time OAuth consent for the Gmail token                                                                                     |

- **`picks.source` takes `text` and `email`** (migration `20260908000063`,
  applied 2026-09-08 as `20260908171220`). A pick from a text or a phone
  call is `text`; a pick from a player's mail is `email`. `admin` remains
  the hand-keyed value and `lynne_import` the importer's.
- **The self-email path is back for picks, as its own command.** Set by
  Anthony on 2026-09-10. He takes picks by text and by phone and enters them
  by mailing HIMSELF, subject carrying `Survivor`, one per line:
  `<lynne_number or entry name> <team>`. `npm run picks:self` reads those and
  writes them through `admin_apply_self_pick_email`.

  **`npm run picks` still cannot see his mailbox and must not.** His free
  entries sit under his own owner row, so `intakeAddresses` drops the admin
  address and every self-sent chase or distribute copy would otherwise be
  read as a player's picks. That is why this is a SEPARATE command rather than
  a branch inside the sweep - nothing in it can change what the hourly run
  does, and `tests/unit/self-email-picks.test.ts` fails if the sweep ever
  imports it.

  It is strict exactly where the ordinary intake is forgiving, because no
  human reads the line again before it is written:
  - **the sender must be the admin mailbox**, checked in the command and not
    only asked for in the Gmail query;
  - **a number is an exact `lynne_number`**, never a near one;
  - **a name must match exactly one live entry**, normalised for case and edge
    whitespace only. There is **no fuzzy match** - the sweep's `resolveEntry`
    falls back to tokens and owner names, which is right for a player naming
    their own entry and wrong here;
  - **a team must resolve to exactly one team that PLAYS THAT WEEK.** A team
    with no game that week stages, and so does a bye;
  - one entry given **two different teams in one message** stages both;
  - **an ELIMINATED entry is off this roster**, the same as it is off the
    ordinary intake and the pick-email screen. `loadLiveEntries` filters only
    `voided_at`, so the command runs it through `aliveEntries` and prints who
    it dropped.

  **`admin_submit_pick` is NOT the place three of those live, and this file
  said it was.** Corrected 2026-09-11, before the migration was applied. That
  function enforces the week, the bye rules and the late flag, and **it has no
  repeated-team guard and no look at what is already current** - it supersedes
  whatever it finds. So a repeated team, a pick already scored or newer, and a
  change arriving after the lock are caught in `guardSelfRows` BEFORE the write
  and staged, exactly as `cli.ts` does with the same two functions
  (`repeatedWeek`, `overrideDecision`) rather than a second copy of them. **A
  repeated team is an ELIMINATION in her pool**, so it is never written from a
  dictated line without Anthony approving it on `/admin/queue`.

  **The same team already on file is a NO-OP** - not written, not staged.
  `admin_submit_pick` supersedes unconditionally and stamps the new row
  `pending`, so re-sending the team an entry already holds would erase its
  RESULT: the exact damage the guards prevent, walked in through the front
  door. Both reviewers found this in the first version of the fix.

  **What the command calls staged IS staged**, in the same transaction as the
  applies and before the row that makes the message applied - so a replay,
  which writes nothing, can never be the thing that loses the questions. **The
  kind depends on WHY**, because `admin_approve_pending` refuses a scored
  current pick and a reply older than the current one outright: those two
  stage as `player_question` pointing at the admin screen, and everything else
  that resolved to an entry and a team stages as `pick`, where approving
  writes what he dictated. A row staged as a `pick` that approve can never
  write would sit open forever behind a button that always errors.

  **A message that produces nothing is still filed.** Left unread it is read,
  reported and notified on again every run, for as long as it sits in the
  mailbox.

  Every applied line carries the **Gmail message id** in its own audit row, and
  a replay of the same message writes nothing - the guard is an `audit_log`
  row, so it holds for a re-run and for SQL by hand. **The pick is stamped with
  the time the MAIL arrived**, not the time the command ran, so a run after a
  deadline does not mark a pick late that the mail beat.

  **It never sends.** The reply is a draft on his own thread plus the same
  lines on stdout; the send allowlist is two templates and adding a third is a
  reviewed change, not a convenience.

  **The DECISION self-email for money and identity is a separate matter and
  does not exist in code.** This file used to say the sweep "reads and stages"
  it; it does not, and never did - `intakeAddresses` excludes the admin
  mailbox on every path. A payment match or a who-is-this decision is still
  Anthony's call and still has no automated intake.
- **Drafts only, with one gate.** Nothing under `scripts/` sends except
  `scripts/lib/send.ts`, which sends exactly two templates, each behind the
  same switch: the environment must have `REMINDER_AUTOSEND=true`, and
  unset (the default) means drafts only. Every send writes a claim row
  before the Gmail call and a sent row with the Gmail message id after it.
  - `pick_reminder` (`npm run chase --send`): one message per recipient
    with no current pick, at most once per recipient per ET lock day
    (`audit_log` actions `pick_reminder_claim`, `pick_reminder_sent`).
  - `week_reminder` (`npm run remind --send`, set by Anthony on
    2026-09-09): one message per week boundary, To his mailbox and Bcc
    every address on the live roster, six hours before the early and the
    late deadline, at most once per boundary (`week_reminder_claim`,
    `week_reminder_sent` on the key `week:N:early|late`). Recipients are
    derived on the run - every owner address and every `player_email` on
    a live entry, lowercased, once each - and **the count must equal
    `EXPECTED_ROSTER_ADDRESSES` (40) exactly or the run stops**
    with the list and the delta printed; a range is what let a wrong
    count through once in another pool. Subject begins `Survivor` so
    replies hit the filter. The body is his Week 1 text with the deadline
    sentences derived from the games. Changing the count is a reviewed
    change to the constant, never a flag.
  Adding a template is a reviewed change to the allowlist, never a flag.
- **Operations run from the repo (set 2026-09-09, extended 2026-09-10).**
  `scripts/ops` holds one entry point per job - sweep, pick-reminder,
  lynne-import, chase, results, distribute - and every schedule and parameter
  comes from the checked-in `scripts/ops/config.json`, so changing one is a
  reviewed change and never a pasted prompt or a Gmail setting.

  **There are TWO entry points and TWO Routines, and the split is about what
  is hour-sensitive.** `npm run ops -- hourly` runs whatever fell due in the
  last hour: the picks intake, because a reply landing at 1:15 has to be
  recorded before a 2:00 deadline, and the two sending jobs, which fire six
  hours before a boundary. `tick` is its old name and still runs.
  `npm run ops -- daily` runs the six reporters in `scripts/ops/reporters`,
  which replaced the six claude.ai Routines of docs/ROUTINES.md sections 3-7:
  each of those was a prompt with Gmail, this repo and **no database at all**,
  working the roster out of mail; these read it, through the admin's own RLS
  session, and they are pure functions with tests. Reporting is not
  hour-sensitive, and once a day is the difference between a report someone
  reads and twenty-four nobody does. **The reporters write nothing** - no
  send, no label, no mark, no identity resolved, no variance resolved.

  **A Routine is created in the claude.ai UI, never from a session or the
  API.** The repo source and the environment are UI-only fields, so a Routine
  made through the API fires a session with no repo to run `npm run ops` in
  and no Gmail to read: it succeeds and does nothing, which is worse than
  failing. One was created that way on 2026-09-04 and had to be deleted. The
  click path and the environment variables are docs/ROUTINES.md section 11.

  Three rules that used to live in a Routine prompt or a Gmail filter are
  code:
  - The sweep reads unread mail from **every owner address and every
    `player_email` on a live entry, whatever its subject or label**, plus
    unread mail from anyone else whose subject carries `survivor` or `picks`
    (the Gmail filter's rule); a stranger's mail is staged for Anthony, never
    written as a pick.
  - The week reminder goes **six hours before each stored boundary**, from
    the weeks table.
  - **Only pick-reminder and chase may send**; the config loader refuses any
    other job marked as sending or handed `--send`. Every whole-roster message
    derives its recipients live and stops unless the count equals
    `expectedRosterAddresses` (40) **exactly** - a range let a wrong count
    through once in another pool.
- **The sweep has a CEILING, and it stops the run.** Set by Anthony on
  2026-09-10, the evening the intake first ran with credentials. It read five
  months of unread mail, matched 65 messages, and staged **1,951**
  `pending_actions` rows in four minutes - `audit_log` 2,636, queue 1,960
  against the 9 real rows already there. They were dismissed the same evening
  through `admin_dismiss_pending`, one audited row each.

  **Nothing was written and nothing could have been.** Every row was kind
  `identity` (one `player_question`), and `admin_approve_pending` has write
  arms for `payment`, `pick` and `entries` only - every other kind falls to
  the `else`, which records the decision and applies nothing. Approving all
  1,951 would have written no pick, no entry, no owner and no payment. **The
  guard is structural, not the absence of a click**, and the payloads carry no
  `entry_id` or `team` for a re-kinded row to use either.

  **Two independent defects, and the second is the one that made it
  unreadable.** Breadth let 65 messages in: every GitHub notification on this
  repo has `Re: [anthonydellapia1117/Survivor]` as its subject, so the pool's
  own name matched them, and the bare word `picks` matched "Free stock picks
  from MarketBeat", "How to Draft from Picks 1-3", "Meta Picks Slack" and
  "great picks for your dog". Duplication turned those 65 into 1,951:
  `unparsedReason` calls **any** line with three consecutive letters and no
  greeting "no team recognised on this line", and the CLI staged one row per
  such line - a Codex review email is 149 lines, so it was 149 rows.

  Four guards, in the order Anthony set them:

  1. **The ceiling comes first.** More than `MAX_STAGED_PER_RUN` (**25**) rows
     in one run and the sweep prints who they came from and **writes nothing,
     stages nothing and marks nothing read** - so the same mail is still there
     to sweep once the filter is right. Same shape as the roster count gate on
     a send: it stops, it never trims to the limit. **Raising the number is
     never the fix.** This is the guard that turns any future version of this
     into one line instead of a flood, and it is built even if the rest slip.
  2. **One row per MESSAGE, never one per line**, whenever the sender resolves
     to no live entry. `unparsedLinesToAsk` returns nothing for such a sender;
     a placed player keeps the per-line questions, which is the useful half.
     This alone turns 1,951 into 65.
  3. **A date floor of `SWEEP_WINDOW_DAYS` (14) on BOTH queries.** The address
     path has no subject filter by design - a real reply may carry any subject
     - so the window is the only thing filtering it, which is how an unread
     Axios newsletter from 27 April became a staged question.
  4. **No bare subject term, and no machine senders.** `notifications@github.com`
     and `noreply@github.com` are excluded in the Gmail query AND in
     `strangerMessages`, because a subject can never keep them out. The config
     loader **refuses the bare words** in `BARE_TERMS_REFUSED` (`picks`,
     `pick`, `pool`, `week`, `game`, `games`, `survivors`) by name and will not
     load at all if one is present; terms are phrases (`my picks`).

  `tests/unit/sweep-flood-guards.test.ts` holds all four, each confirmed to
  FAIL when broken. **The ops Routine stays paused until they are merged** -
  the Friday jobs run through connectors, not the sweep, so it costs nothing.

- **Game results come from ESPN, and only ever land on `nfl_games`.** Set by
  Anthony on 2026-09-11. `npm run scores` reads the free public scoreboard - no
  key, no auth - and writes through `admin_apply_game_results`, which is
  **write-only to `nfl_games` and names no other table**. A result never
  touches a pick; what a result COSTS an entry is `picks.result` and the
  standings view, and **a tie stays a `tie_loss`** - that does not move.

  Four rules, all in the database so they hold for a Routine, a hand run and
  SQL typed by a person: it **matches and never creates** (a game matching no
  single `nfl_games` row stops the whole call and names it, and there is no
  `insert into nfl_games` in the function at all); **a final is never
  overwritten**; **an unchanged row writes nothing and audits nothing**; and
  **each write is audited in the same transaction as the write**.

  **The only code that differs is WSH for our WAS**, stated once in
  `src/lib/nfl/espn.ts` and used by the command, the admin prefill and the logo
  paths - it was written out three times until this went in. Verified across
  all eighteen weeks before anything was built: 272 ESPN events, 272
  `nfl_games` rows, and after that one rename the two sets of
  `(week, home, away)` matched 272 of 272 with nothing unmatched either way.

  Two traps in the feed the parser is built around. A **cancelled** game is
  state `post` with `completed` FALSE and both scores the string `"0"` - read
  as final it writes a 0-0 that never happened, and a final is never
  rewritten, so only `completed` decides. And **`event.date` is a placeholder**
  on the 24 flex games of weeks 16-18, so the parser carries no kickoff time
  at all; the schedule is seeded and this only ever adds a score to a row that
  already exists.

  **Its six slots are stated in EASTERN TIME** (`scheduleEt` in
  `scripts/ops/config.json`, one expression per slot) and converted on every
  run: Fri 3 AM, Sat 3 AM, Sun 5 PM, Sun 10 PM, Mon 3 AM, Tue 3 AM, overnight
  so nothing collides with the reminder jobs. A fixed UTC cron would be an hour
  wrong for half the season. The tick was widened from `43 9-23,0-2` to
  `43 7-23,0-3` for them - under the old one **nine of the twelve slot-offsets**
  (six slots x EDT and EST) fell between two ticks and would never have run.

- **The sweep runs every 19 minutes on FRIDAYS, 8:00 AM to 2:00 AM ET.** Set
  by Anthony on 2026-09-11, hourly at :43 the rest of the week. His words were
  "8 AM to 2 AM" and he flagged that he might have meant 2 PM; **8 AM to 2 AM
  is what is built** - it crosses midnight into Saturday and covers 2 PM
  either way.

  **Why: a deadline ran down while picks sat unread.** That Friday the hourly
  tick reported "nothing due" at most hours because the sweep was not in the
  window, and picks Anthony had emailed himself at 10:58 AM, 12:21 PM and
  1:39 PM were still unrecorded at 2 PM. Nine of them were for entries the
  2 PM confirmation then told their owners had no pick.

  It is stated in `scheduleEt` for the same reason the scores job is - a fixed
  UTC cron for 8 AM ET is an hour wrong for half the season - and the window
  **crossing midnight is what forces the tick to be every hour**: the tail
  lands on different UTC hours in EDT and EST, so a tick that names hours at
  all loses half of it. **`tickSchedule` is therefore `0,19,38,57 * * * *`**,
  every 19 minutes of every hour. A tick costs a firing and does nothing
  unless a job is due.

  **The config is necessary and not sufficient.** The tick's cron lives in the
  claude.ai Routine, which is UI-only; until that Routine fires every 19
  minutes the sweep still runs hourly whatever this file says.
  `tests/unit/ops.test.ts` holds the cadence as a GAP rather than a cron
  string - never 19 minutes unswept inside the window, never more than an hour
  outside it, and every slot observed in BOTH offsets - because a string
  assertion passes on the right shape with the wrong hours.

- **The week selector on /admin/picks rolls on KICKOFF, not on the deadline.**
  Set by Anthony on 2026-09-11. It used to offer the first week whose deadline
  was still ahead, so it moved on at 2:00 PM and he had to fight it back to the
  right week every time a straggler came in - and they arrive all Friday
  evening and Saturday. The default now holds the current week until that
  week's **first main-slate game has kicked off**.

  **Which kickoff is the whole subtlety, and the obvious reading is wrong.**
  "The week's earliest kickoff" would be **Week 1's Wednesday night game**
  (NE at SEA, 2026-09-09 8:20 PM ET), which kicks off *before* that week's own
  Friday deadline - so it would roll off Week 1 on Wednesday evening, a worse
  version of the bug it replaces. The roll point is the first kickoff of the
  games sharing the week's **late deadline** (the Sat/Sun/Mon window that
  carries the volume), read through `deadlineTier`. **Week 1 therefore holds
  until Sunday 2026-09-13 1:00 PM ET**, which is what Anthony specified.

  Read off `nfl_games` on every render: **no hardcoded day, no hardcoded hour,
  and nothing derived from the deadline.** A week the schedule says nothing
  about is never rolled past - silence is not a kickoff.

  **This governs the DEFAULT only.** He changes the week freely; the banner
  still reads "locked 2h ago - new picks will be flagged late", which is what
  tells him he is past the deadline while still recording on the right week;
  and a pick entered after the deadline is still `late = true` and still
  stored, never refused. `tests/unit/default-week.test.ts` holds all three.

- **Every command reports.** A staged NEEDS ANTHONY row and the end of a run
  each produce one line through `npm run notify`'s function; `NTFY_TOPIC` is
  Anthony's to choose and is never invented.

## Separate systems

The **TNF block pool** is a completely separate system with its own repo and
its own database.

**Never reference it, link it, or produce content for it here — not code, not
rules, not drafts.** If Anthony asks for something TNF-related in this
project, **refuse and tell him it belongs in the other chat.** This is not a
matter of tidiness: two projects sharing an assistant context is how rules
and data from one leak into the other.

Its payments legitimately appear in the same Venmo inbox — that is why the
amount-first sweep rule exists.

---

## Stack and commands

- Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn/ui
- Supabase (PostgreSQL) — migrations, RLS policies and views in `supabase/`
- Vitest for unit tests; SQL suites in `tests/sql/` run via
  `scripts/db/test-db.sh tests/sql/*.sql`

```
npm run dev | npm run build | npm run lint
npx vitest run                          # unit tests
bash scripts/db/test-db.sh tests/sql/*.sql   # SQL suites
npm run picks | npm run lynne | npm run chase | npm run results | npm run distribute
```

## Conventions

- TypeScript strict. No `any` in new code. Server components by default.
- **RLS on every table.** `is_admin()` is the gate; admin screens act as the
  signed-in admin.
- **There is no service-role key anywhere, by design.** Do not add one.
- Picks are never accepted after kickoff — enforced server-side by timestamp,
  never by client clock.
- Public payloads are minimal by construction: private columns do not exist
  in the public views rather than being filtered out in the UI.
- **`payments.owner_id` is nullable by design, and NULL means unmatched —
  a receipt sitting in quarantine before anyone has matched it to an owner.
  It is a meaningful value, not a missing one.** Wherever that column takes
  part in **deduplication or a uniqueness rule**, it needs NULL-equal
  semantics: `is not distinct from` in place of `=`, and a unique index split
  into partial indexes on `owner_id is null` / `owner_id is not null` rather
  than one key listing the column. PostgreSQL treats NULLs as **distinct**, so
  a key of `(venmo_txn_id, owner_id)` silently stops deduplicating the whole
  unmatched pile. That is exactly what happened on 2026-09-03 and it will bite
  again.

  This is scoped to dedupe and uniqueness on purpose. Everywhere else, plain
  NULL semantics are what you want: the foreign key permits NULL precisely so
  an unmatched receipt can exist, and an owner filter (`owner_id = $1`) is
  right to exclude quarantined rows rather than sweep them in. Do not spread
  `is not distinct from` across ordinary owner lookups.

- **`name_is_default` clears only when the name actually changes.** It means
  *nobody has supplied a real name yet* and drives the "Default name" filter on
  `/admin/entries` — the list Anthony works when chasing owners for their real
  wording. `admin_update_entry` used to clear it on every call, so the
  Lynne-number paste import, which re-submits each entry's existing name to
  write a number, silently emptied that list. Comparison is byte-exact:
  `tommybrads` arriving over `Tommybrads` is a real rename.
- Tests are required for pick validation, elimination rules, and any money
  calculation.
- Bye weeks and Thursday/Saturday/Monday games are normal — never assume all
  games are on Sunday.
- `localStorage` is for view preferences only (e.g. the show/hide toggle).
  No pool data, no participant data, no money ever goes in it.

## Where things live

| What                                | Path                                         |
| ----------------------------------- | -------------------------------------------- |
| Pricing, free-entry and margin math | `src/lib/free-entries.ts`, `src/lib/pool.ts` |
| Free-entry mint (DB-enforced)       | `mint_free_entries` trigger                  |
| Lynne import / roster / numbers     | `src/lib/lynne/`                             |
| Entry-name collision detection      | `src/lib/names.ts`                           |
| Result colours, the one place       | `src/lib/result-colour.ts`                   |
| Audit rendering                     | `src/lib/audit-format.ts`, `/admin/audit`    |
| Data backup (one-step restore)      | `src/lib/backup.ts`, `/api/admin/backup`     |
| Admin mutations (all audited)       | `src/app/admin/actions.ts`                   |
| Who gets a pick email, and for what | `src/lib/emails/recipients.ts`               |
| Pick email bodies                   | `src/lib/emails/pick-request.ts`             |
| Local commands (picks, chase, ...)  | `scripts/`, `docs/PICKS_INTAKE.md`           |
| Her master sheet, read-only         | `lynne_roster` table, `scripts/lynne/roster.ts` |
| Her picks by email (Shape B)        | `src/lib/lynne/pick-email.ts`, `scripts/lynne/picks-email.ts` |
| The daily reporters                 | `scripts/ops/reporters/`, `scripts/ops/daily.ts` |
| The one table, public               | `src/app/grid/`, `src/components/grid/grid-view.tsx`, `src/lib/master-list.ts`, `v_master_list` |
| How the one table sorts             | `src/lib/grid-sort.ts`                       |
| The one outbound link               | `scripts/lib/site-link.ts`                   |
| The one send path and its gate      | `scripts/lib/send.ts`                        |
| The sweep's ceiling and filter      | `scripts/picks/lib/resolve.ts`, `scripts/picks/lib/subject-sweep.ts` |
| His dictated picks by self-email    | `scripts/picks/lib/self-email.ts`, `scripts/picks/self.ts` |
| The two recipient exceptions        | `src/lib/emails/recipient-exceptions.ts`     |
| Which week /admin/picks opens on    | `src/lib/default-week.ts`                    |
| Scheduled reporters                 | `docs/ROUTINES.md`                           |
