# Merge automation

TLDR: three workflows in `.github/workflows` do the checking; a ruleset on
main does the gating; auto-merge does the merging. The workflows are in the
repo. The ruleset, the repository merge settings and one secret are
repository settings that only the owner can set; the exact clicks are in
section 3.

## 1. Workflows

| File | Name | What it does |
| --- | --- | --- |
| `ci.yml` | `ci` | Lint, typecheck, unit tests, production build, SQL suites on a fresh database built from `supabase/migrations`. On every pull request and every push to main. |
| `codex-gate.yml` | `codex-gate` | Writes one check on the PR head that passes only when Codex has concluded on that exact commit and every review thread is resolved. Re-runs when the PR moves, when Codex edits its summary, and on a review. GitHub has no workflow event for a thread being resolved, so after resolving threads re-run it by hand: Actions > codex-gate > Run workflow > the PR number. Comment and review events run the copy on main, so they reach a PR only once the workflow is merged. |
| `migrate.yml` | `migrate` | On a push to main touching `supabase/migrations`, applies every unapplied file to production as one transaction for the whole batch, with the smoke check after each file; a failure anywhere rolls the whole batch back and opens an issue. Needs `SUPABASE_DB_URL`. |

Codex posts no check of its own, only a summary comment it edits as it
works; `codex-gate` turns that into a check the ruleset can require.

## 2. The migration job

`scripts/db/migrate-prod.sh` decides what is unapplied by name against
`supabase_migrations.schema_migrations` (the versions there are the
timestamps the Supabase tools applied at, not the file prefixes). The whole
pending batch is one transaction. For each file in turn: the migration, a
savepoint, `scripts/db/smoke.sql` (entry count and money totals read back,
one existing entry re-saved with its own values, one pick submitted on a
scratch owner and entry), rollback to the savepoint so the scratch data
never persists, the tracking row. One commit at the end. A raise anywhere,
in the third file as much as the first, leaves the transaction open when
psql stops, so nothing in the batch is applied and production is exactly as
it was. The job then opens an issue with the log tail.

The check runs as the admin through the JWT claims for that transaction
only. Nothing it writes survives: the entry save and the scratch pick are
rolled back with the savepoint, and their audit rows with them.

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

3c. The secret. Settings > Secrets and variables > Actions > New repository
    secret. Name `SUPABASE_DB_URL`, value the Postgres connection string from
    the Supabase dashboard (project > Connect > Session pooler, with the
    database password filled in). Nothing in the repo or in Vercel needs it;
    only the migration job reads it.

3d. Auto-merge on a pull request: once 3a is on, open the PR, click Enable
    auto-merge (squash). From a session, the `enable_pr_auto_merge` tool does
    the same. The PR merges itself the moment `ci` and `codex-gate` are green
    and every thread is resolved.

Until 3a and 3b are set, a session merges a PR itself once those same
conditions hold, and says so in its report.
