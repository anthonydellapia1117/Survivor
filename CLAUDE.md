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
- Week 1 locks Tuesday 2026-09-08 12:00 PM ET

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

When reconciling Venmo receipts against the ledger, **only flag incoming
receipts whose amount is $30, $60, $90, or $100.** Anything else is almost
certainly the separate block pool or personal money — do not surface it
unless Anthony asks.

**A participant's name on a non-matching amount is not a signal.** People in
this pool also send Anthony money for entirely unrelated reasons. Matching on
name instead of amount is exactly what produced the **Tropea and Flaherty
false positives** that had to be chased down and cleared. Amount first,
always.

Resolved exclusions are recorded in `audit_log` under the action
`payment_sweep_exclude`, each naming the transaction IDs it clears. **Check
those rows — via /admin/audit — before re-raising anything.**

### Free entries

- They are **Anthony's only**, under the participant row for
  `anthonydellapia@gmail.com` (distinct from the admin login).
- Count is **FLOOR(recruited / 10)**.
- Named **"AAA #1"** through **"AAA #n"** — the same separator as every
  other multi-entry owner, per [the numbering convention](#the-numbering-convention).
  `FREE_ENTRY_NAME_PREFIX` in `src/lib/free-entries.ts` is `"AAA #"`; the
  parser accepts both forms so the pre-2026-09-01 names still read, but
  anything newly minted carries the hash.
- **Nobody else ever gets one.**
- They **never count toward earning more** — the ratio is computed from
  recruited entries only.
- They **still get Lynne numbers and appear in the roster export** — they
  just do not bill.

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
$2,120 due, $970 collected, $1,150 outstanding, **$2,050 owed to Lynne**
(82 × $25). Lynne is current: the full 90 went to her on **2026-09-03** and
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
| Lynne import / roster / numbers     | `src/lib/lynne/`                             |
| Entry-name collision detection      | `src/lib/names.ts`                           |
| Audit rendering                     | `src/lib/audit-format.ts`, `/admin/audit`    |
| Data backup (one-step restore)      | `src/lib/backup.ts`, `/api/admin/backup`     |
| Admin mutations (all audited)       | `src/app/admin/actions.ts`                   |
