# Session report, 2026-09-08 (Tuesday of Week 1)

Every figure below is from one live read of production at 19:08:39 UTC
(3:08 PM ET) on 2026-09-08, after the day's writes and before PR #19
merged. The two writes this session made are audit rows 483 to 485; the
migration job and the merges write no data.

## 1. Pool state

| Figure | Value |
| --- | --- |
| Entries live | 121 = 110 recruited + 11 free |
| Pool | closed; the season opens Wednesday 2026-09-09 |
| Free entries | final at 11 (FLOOR(110 / 10)) |
| Lynne numbers | 121 of 121, distinct 121, 972 to 1087 (116), 1313 to 1316 (Andrew DiCicco #1 to #4), 1317 (AAA #11) |
| Due / collected / outstanding | $2,840 / $1,830 / $1,010 |
| Owed to Lynne | $2,750 (110 x $25) |
| Owners | 36 confirmed; 23 settled, 12 owing (one owner has no entries due) |
| Week 1 picks | 29 in, 92 outstanding, 1 late (E.A.T. on SEA under grace) |
| Queue open | 1 (c72d3af5, Marc Massimino, how to pick; reply drafted, not sent) |
| Audit | max id 485, 347 rows |
| Migrations recorded in production | 64; queue_stale_pick_guard not yet applied (the migrate job applies it after PR #19 merges) |
| Her buckets (additions / renames / removals) | 0 / 0 / 0 |

## 2. Writes this session, all audited as anthonydellapia@gmail.com

| Audit id | Action | What |
| --- | --- | --- |
| 483 | update_entry | AAA #11: lynne_number 1317, lynne_label "AAA #11", every other field at its current value |
| 484 | approve_pending | 4a5c1693 (Lynne "Final totals") closed: reconciled 121 = 110 + 11, remittance $2,750, sent in the Entry List thread |
| 485 | approve_pending | 5ff4f7bb (Lynne "Football Sheet") closed: numbers loaded from Football 2026-2.xlsx, 120 from the sheet + 1313 to 1316 + 1317 by email; pot $28,485 acknowledged |

The dry run before these consumed sequence ids 480 to 482 and rolled
back; those ids never existed as rows. Expected after was audit max 482;
actual 485. The three rows are the three writes.

Earlier the same day, in the previous session: Ernie DellaPia Sr's four
Week 1 picks (source text), Lynne's numbers for 120 entries, the
2026-09-04 send to Lynne marked at its real timestamp, Frank DiCicco's four
entries and TJ Auletto's $100.

## 3. Gmail drafts created, none sent

| Draft | Thread | To | What |
| --- | --- | --- | --- |
| r-7767335141118175479 (message 1a08226deaff69c7) | 1a069544dd2f095d | mmassimino@msn.com | Marc Massimino: two entries, reply or text 215-384-8335, Friday Sep 11 noon ET, Thursday game Wednesday noon, no login |
| r6591240405102116592 (previous session) | 1a03611fae4e4774 | lynnepiazza10@gmail.com | Tuesday lock list: 1004 E.A.T. - Seattle |

## 4. Code and docs

PR #20 (public site stops naming the master pool's runner; admin nav in
five groups) merged at c168b8e after Codex concluded on its head with no
findings and Copilot's one thread was fixed and resolved.

PR #19 carries the commands (`npm run picks`, `lynne`, `chase`, `results`,
`distribute`, `notify`), the one send path with its gate, the migration
renumber, the merge automation (`ci`, `codex-gate`, `migrate` workflows and
the transactional smoke check), and the docs (CLAUDE.md snapshot and rules,
ROUTINES.md 3e, PICKS_INTAKE.md, MERGE_AUTOMATION.md). Review: Copilot 2
findings, Codex 12 findings over three rounds, a six-lens adversarial pass
in the session; every finding fixed with a guard made to fail first, except
the one concurrency case (two autosends overlapping), narrowed and
documented per CLAUDE.md's one-admin rule.

## 5. Open for Anthony

- Repository settings the session cannot set (the proxy refuses them):
  squash-only with auto-merge, the main ruleset requiring `ci` and
  `codex-gate` with conversation resolution, and the secret
  `SUPABASE_DB_URL` for the migrate job. Clicks in docs/MERGE_AUTOMATION.md
  section 3. Until then a session merges once the same conditions hold.
  **Superseded on 2026-09-09 as to the secret only:** the migrate job and
  `scripts/db/migrate-prod.sh` were removed, so `SUPABASE_DB_URL` has no
  consumer and must not be set. **Do not act on that line.** The other two
  settings still stand. This report is a dated record, so the line above is
  left as it read; see CLAUDE.md and docs/MERGE_AUTOMATION.md for the rule
  as it stands.
- Local setup for the commands: `.env.local` and `npm run gmail:auth`
  (docs/PICKS_INTAKE.md section 1).
- The Marc Massimino draft and the Tuesday lock draft: send from Gmail.
