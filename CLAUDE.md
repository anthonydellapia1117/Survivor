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
John's; Nick DiVirgilio bought four and two are Lou Direnzo's.

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
else is playing this and I do not have their address yet" — where
`Lou Direnzo #1`–`#2` sit right now. That is the gap worth chasing, and the
pick-emails screen surfaces it as one. A single column could not express it.

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

**As of 2026-09-04:** 101 recruited + 10 free = **111 entries**, 35 owner rows
(32 of them carrying recruited entries). $2,610 due, $1,500 collected, $1,110
outstanding, **$2,525 owed to Lynne** (101 × $25). 19 owners settled, 13 still
owing.

**Lynne is owed twelve additions and four removals — +12 ✎0 −4.** Four owners
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
| Audit rendering                     | `src/lib/audit-format.ts`, `/admin/audit`    |
| Data backup (one-step restore)      | `src/lib/backup.ts`, `/api/admin/backup`     |
| Admin mutations (all audited)       | `src/app/admin/actions.ts`                   |
| Who gets a pick email, and for what | `src/lib/emails/recipients.ts`               |
| Pick email bodies                   | `src/lib/emails/pick-request.ts`             |
