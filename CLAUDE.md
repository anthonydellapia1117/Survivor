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

| Game day               | Picks close           |
| ---------------------- | --------------------- |
| Wednesday              | Tuesday 12:00 PM ET   |
| Thursday               | Wednesday 12:00 PM ET |
| Friday                 | Thursday 12:00 PM ET  |
| Saturday/Sunday/Monday | Friday 12:00 PM ET    |

Saturday, Sunday and Monday share **one** window deliberately: that is where
the volume is and it needs a single cutoff.

So a deadline day is not a lock on the week. **Tuesday 2026-09-08 noon closes
only the entries that picked the Wednesday game** (Patriots at Seahawks, Wed
09-09). The Thursday game (49ers at Rams, 09-10) closes Wednesday noon, and
everything from Saturday 09-12 on closes Friday 09-11 noon. The week is fully
locked at the **late** deadline — Friday noon — which is also the sweep
boundary.

Every tier is noon ET on the day before its window opens. Anthony confirmed
the Friday tier on 2026-09-03, on that reasoning: it gives a clean escalation
through Thanksgiving week — **Thursday games due Wednesday noon, the Black
Friday game due Thursday noon, the weekend due Friday noon.** It governs six
games (Week 12 Black Friday, Week 16 Christmas Day).

The derivation is `pick_deadline(week, team)` in SQL, mirrored for display by
`pickDeadlineIso` in `src/lib/deadlines.ts`. Only two boundaries are stored per
week — `early_deadline_at` (Wednesday noon) and `late_deadline_at` (Friday
noon); the Wednesday and Friday tiers derive one day either side of `early`, so
editing a week's early deadline moves them with it. A bye, `SKIP_WEEK`, or a
team with no game that week takes the late boundary.

## Money

### Pricing

| Entries   | Price |
| --------- | ----- |
| 1         | $30   |
| 2         | $60   |
| 3         | $90   |
| 4 or more | $100  |

Priced per owner: 4+ entries drops the whole owner to the $25/entry tier.

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

**The mint is enforced in the DATABASE, not in the app.** A statement trigger
on `entries` (`mint_free_entries`, migration
`20260904000043_free_entries_enforced_in_db.sql`) tops the count up to
FLOOR(recruited / ratio) in the **same transaction** as whatever write earned
it — so it holds for an RPC call, a bulk import, or SQL applied by hand, not
only for a change that happened to go through the admin UI.

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

## Roster state — snapshot, not a rule

These move. The app is authoritative; this is here so a new session starts
from roughly the right place and can spot a big discrepancy immediately.

**As of 2026-09-03:** 82 recruited + 8 free = **90 entries**, 28 owners.
$2,120 due, $1,270 collected, $850 outstanding, **$2,050 owed to Lynne**
(82 × $25). 17 owners settled, 10 still owing. Lynne is current: the full 90 went to her on **2026-09-03** and
every drift bucket is clear — **+0 ✎0 −0**. That send was structured as 61
formatting corrections carried implicitly by a full-roster paste-over, 13
additions (the 9 pending plus `Jim Teti #1`–`#4`) and 8 removals. The app
records only 4 removals, which is correct: DiCicco 1–4 are genuinely voided
rows, while the other 4 are the delete-half of the Jim Teti substitution and
those entries are still live.

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

## Working rules

- **Never invent data.** No placeholder owners, no guessed amounts, no
  fabricated picks. If something is unknown, say it is unknown.
- **Names verbatim** (above).
- **The payments ledger is append-only.** Corrections are new rows, never
  edits or deletes.
- **A draft is never a send.** Never treat a drafted email as sent, and never
  send on Anthony's behalf without being asked.
- **Audit every write in the same transaction as the write.** The data row
  and its `audit_log` row commit together or neither does. This is why the
  admin mutations are transactional RPCs rather than plain updates.
- **Matching is exact, then case-insensitive. Never fuzzy.** Applies to entry
  names, Lynne-number imports, and weekly result imports. Unmatched rows are
  reported, never guessed.
- **Wait for the review to finish before merging.** Every review pass on this
  repo has found something real. Marking a PR ready and merging inside the
  review window costs nothing to wait for and has already cost one live P1 —
  #5 was merged five seconds after being marked ready, and the review that was
  still running caught a regression that reached production. Wait for the
  review to complete **on the current head**, then merge on the drift
  argument: a migration live in production but absent from `main` is the worse
  state, so a clean review is a reason to merge promptly, not to keep
  iterating.

## Gmail

**Fetch threads in full (`get_thread`), never rely on search previews.**
Search returns only the ~5 oldest messages per thread with no truncation
marker, which silently hides recent replies. Full fetches are what caught
payments the previews missed.

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
| Free-entry mint (DB-enforced)       | `mint_free_entries` trigger on `entries`     |
| Lynne import / roster / numbers     | `src/lib/lynne/`                             |
| Entry-name collision detection      | `src/lib/names.ts`                           |
| Audit rendering                     | `src/lib/audit-format.ts`, `/admin/audit`    |
| Data backup (one-step restore)      | `src/lib/backup.ts`, `/api/admin/backup`     |
| Admin mutations (all audited)       | `src/app/admin/actions.ts`                   |
