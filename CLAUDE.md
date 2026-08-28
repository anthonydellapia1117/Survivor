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

**Lynne is the authority on results, standings, and elimination.** Her sheet
decides who is out. The app never overrules her.

**Anthony is the authority on what was submitted and when** — the roster, the
entry names, the picks he sent, and their timing.

**Conflicts are reported, never auto-resolved.** When her sheet disagrees with
our record, surface the variance and let Anthony decide. Never silently
"correct" either side.

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
name instead of amount is exactly what produced the false positives that had
to be chased down and cleared. Amount first, always.

Resolved exclusions are recorded in `audit_log` under the action
`payment_sweep_exclude`, each naming the transaction IDs it clears. **Check
those rows — via /admin/audit — before re-raising anything.**

### Free entries

- They are **Anthony's only**, under the participant row for
  `anthonydellapia@gmail.com` (distinct from the admin login).
- Count is **FLOOR(recruited / 10)**.
- Named **"AAA 1"** through **"AAA n"**.
- **Nobody else ever gets one.**
- They **never count toward earning more** — the ratio is computed from
  recruited entries only.
- They do get Lynne numbers and do appear on the roster sent to her.

### Remittance to Lynne

**Recruited entries × $25.** Free entries are excluded entirely.

### Margin — admin-only

Anthony's margin (the spread between what he collects and what he remits) is
**admin-only**. It never appears on any public route, and never in any export
a player can reach. If a change would surface it publicly, do not build it —
say so instead.

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
its own database. **Never reference it, link it, or pull its data into this
project.** Its payments legitimately appear in the same Venmo inbox — that is
why the amount-first sweep rule exists.

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

## Where things live

| What                                | Path                                         |
| ----------------------------------- | -------------------------------------------- |
| Pricing, free-entry and margin math | `src/lib/free-entries.ts`, `src/lib/pool.ts` |
| Lynne import / roster / numbers     | `src/lib/lynne/`                             |
| Entry-name collision detection      | `src/lib/names.ts`                           |
| Audit rendering                     | `src/lib/audit-format.ts`, `/admin/audit`    |
| Data backup (one-step restore)      | `src/lib/backup.ts`, `/api/admin/backup`     |
| Admin mutations (all audited)       | `src/app/admin/actions.ts`                   |
