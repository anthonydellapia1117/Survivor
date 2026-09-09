# Merge automation

TLDR: two workflows in `.github/workflows` do the checking; a ruleset on
main does the gating; auto-merge does the merging. The workflows are in the
repo. The ruleset and the repository merge settings are repository settings
that only the owner can set; the exact clicks are in section 3. **Nothing
here reads a secret any more, and one that was set has to be deleted by
hand** - sections 2 and 3c.

## 1. Workflows

| File | Name | What it does |
| --- | --- | --- |
| `ci.yml` | `ci` | Lint, typecheck, unit tests, production build, SQL suites on a fresh database built from `supabase/migrations`. On every pull request and every push to main. |
| `codex-gate.yml` | `codex-gate` | Writes one check on the PR head that passes only when Codex has concluded on that exact commit and every review thread is resolved. Re-runs when the PR moves, when Codex edits its summary, and on a review. GitHub has no workflow event for a thread being resolved, so after resolving threads re-run it by hand: Actions > codex-gate > Run workflow > the PR number. Comment and review events run the copy on main, so they reach a PR only once the workflow is merged. |

Codex posts no check of its own, only a summary comment it edits as it
works; `codex-gate` turns that into a check the ruleset can require. The
workflow's job is named `gate`, not `codex-gate`: the job's own check run and
the check the script writes come from the same app, and if both carried the
name the job's success, completed a second later, would be the one the
ruleset read.

## 2. Migrations are attended, and there is no job

**Nothing applies a migration automatically, and nothing in this repo holds a
production database credential.** A migration file that lands on main is not
applied by landing; it is applied by hand in the same sitting as the deploy,
which is the standing rule in CLAUDE.md.

The procedure is one transaction: the migration, `savepoint smoke`,
`scripts/db/smoke.sql`, `rollback to savepoint smoke`, then the tracking row
in `supabase_migrations.schema_migrations`, then one commit. The smoke check
reads the entry count and the money totals back, re-saves one existing entry
with its own values, and submits one pick on a scratch owner and entry; the
rollback to the savepoint drops all of that, and its audit rows with it. It
runs as the admin through the JWT claims for that transaction only. A raise
anywhere leaves the transaction open, so nothing is applied.

Because the output is read by a person and often pasted into a report, the
smoke check prints **no money total** - it compares them and raises only
whether they moved. `tests/unit/smoke-sql.test.ts` holds it to that.

A workflow used to do this on every push to main touching
`supabase/migrations`, reading a repository secret `SUPABASE_DB_URL`.
**Removed 2026-09-09 on Anthony's instruction.** Applying a migration the
moment a PR merges is unattended by definition, which is the opposite of the
rule; and the secret was a standing production credential sitting in
repository settings, the same shape as the service-role key this project
deliberately does not have. `scripts/db/migrate-prod.sh` went with it, being
the only thing that read the secret.

**Deleting the consumer does not delete the credential.** A repository
Actions secret outlives the workflow that read it: if `SUPABASE_DB_URL` was
ever set under the old section 3c, it is still stored, still a live
production connection string, and now readable by any workflow this repo
gains later with nothing needing it. It has to be removed by hand - 3c
below. As of the last run of the job, 2026-09-09 00:01 UTC on fa9af2e, it
was unset and the job failed for exactly that reason, so there may be
nothing to delete; check rather than assume.

## 3. What only the owner can set

None of these can be set from a session (the proxy refuses repository
settings writes), and none is code.

3a. Merge settings. GitHub > Survivor > Settings > General > Pull Requests:
    tick Allow squash merging only (untick merge commits and rebase), tick
    Allow auto-merge, tick Automatically delete head branches.

3b. The ruleset. Settings > Rules > Rulesets > New ruleset > New branch
    ruleset. Name: main. Enforcement: Active. Target branches: add target >
    Include default branch. Rules: Restrict deletions; Block force pushes;
    Require a pull request before merging with Required approvals 0, Require
    conversation resolution before merging ticked, Allowed merge methods
    Squash only; Require status checks to pass with Require branches to be up
    to date before merging ticked and the two checks `ci` and `codex-gate`
    added. Save. You should see the ruleset listed as Active.

3c. Delete the secret, if it was ever set. Settings > Secrets and variables
    > Actions. If `SUPABASE_DB_URL` is listed under Repository secrets,
    click its bin icon and confirm; nothing reads it now, and a stored
    production connection string with no consumer is only a way to lose one.
    If it was ever set, also rotate the database password (Supabase
    dashboard > Project Settings > Database > Reset database password),
    because the value it held remains valid until you do. If it is not
    listed, there is nothing to do.

3d. Auto-merge on a pull request: once 3a is on, open the PR, click Enable
    auto-merge (squash). From a session, the `enable_pr_auto_merge` tool does
    the same. The PR merges itself the moment `ci` and `codex-gate` are green
    and every thread is resolved.

Until 3a and 3b are set, a session merges a PR itself once those same
conditions hold, and says so in its report.
