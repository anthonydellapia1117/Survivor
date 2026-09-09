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
runs as the admin through the JWT claims for that transaction only.

**Assemble the whole batch into a file and run that file. Do not paste the
steps into an interactive psql.** This is not a preference, and the flag
alone is not enough. `rollback to savepoint smoke` is the step for a check
that PASSED: it drops the scratch writes and keeps the migration. Issued
after a check that RAISED, it clears the failed state and keeps the
migration too, and the tracking row and the commit then succeed, applying a
migration whose smoke check failed.

`ON_ERROR_STOP=1` prevents that **only when psql is not interactive.**
PostgreSQL is explicit: in interactive mode psql returns to the prompt after
an error rather than exiting, so the rest of a pasted block still runs. The
deleted wrapper piped an assembled batch into `psql -f -`, which is why it
was safe. Do the same:

```
psql "$CONNECTION_STRING" -X -v ON_ERROR_STOP=1 -f batch.sql
```

where `batch.sql` is the file built below. The connection string is the
operator's own, typed for the run; it is not stored anywhere in this repo.

**If the smoke check raises: `rollback`, the whole transaction, and stop.**
Not `rollback to savepoint`. Read the raise, fix the migration, start over
from the top. Nothing is applied, which is the point.

### The steps, in full

The deleted wrapper held two details that are easy to get wrong and are
written down here so they are not lost with it.

**Which files are pending is decided by NAME, not by the version.** Supabase
records a migration under the timestamp it was APPLIED at, so the recorded
`version` does not match the file's prefix and comparing on it re-applies
everything. Compare the part of the filename after the first underscore:

```sql
select name from supabase_migrations.schema_migrations order by version;
```

A file in `supabase/migrations/` whose name after the prefix is not in that
list is pending. Apply pending files **in filename order**, all of them in
**one** transaction, and commit once at the end.

**`begin;` first, before anything else.** psql autocommits: without it the
migration is live the moment it is pasted, `savepoint smoke` then errors
because there is no transaction to save inside, and ON_ERROR_STOP stops the
run only after the schema change has already committed, unrecorded, with no
smoke check having run and nothing to roll back.

`batch.sql` opens with it:

```sql
begin;
```

Then, for each pending file, in order, with `20260908224500_master_list.sql`
as the example, appended to the same file:

```sql
-- 1. the migration itself, pasted whole
-- 2.
savepoint smoke;
-- 3. scripts/db/smoke.sql, pasted whole
-- 4.
rollback to savepoint smoke;
-- 5. the tracking row: the file's prefix, the name after it, the file body
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260908224500', 'master_list', array[$migration_body$
-- the migration file's contents again, verbatim
$migration_body$]);
```

Then `commit;` once, at the end of the file, after the last migration. A
raise anywhere stops psql before that commit is reached, the connection
closes with the transaction open, and the whole batch is discarded - so
production carries every pending file or none of them, never the first few.

There is nothing to verify by hand about the transaction state: the file
opens with `begin;` and psql runs it as one batch. (An earlier version of
this doc suggested `txid_current_if_assigned()` as a check. It is not one -
no XID is assigned until something writes, so it reads null immediately
after a perfectly good `begin;`.)

The `statements` array is what the Supabase tooling reads back as the
migration's text. Writing a pointer there instead of the body is a
deliberate choice, not an accident, and the 2026-09-08 rows do exactly that;
if you shorten it, say so in the row rather than leaving a body that is not
the file.

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
