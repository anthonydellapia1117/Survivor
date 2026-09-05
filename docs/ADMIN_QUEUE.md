# Admin queue (NEEDS ANTHONY as rows)

Shipped as migration `20260905000063_pending_actions_queue.sql`. The migration
is applied by hand, after the SQL suites pass locally; until then
/admin/queue says the table is not available instead of listing rows.

1. What it is
1a. `pending_actions` holds the items the hourly sweep finds and may not act on
    by itself: a Venmo receipt at a tier amount, a pick in a reply, an owner
    asking for more entries, a name it cannot place. One row per item, with
    `kind`, a JSON `payload`, the Gmail `source_message_id`, and who staged it.
1b. Anthony resolves each row at **/admin/queue** (nav: Queue). Approve or
    Dismiss, with an optional note. Both write an `audit_log` row in the same
    transaction as the resolution.

2. Write path
2a. The sweep stages with `admin_stage_pending(kind, payload,
    source_message_id, actor)`. Re-staging an identical open item returns the
    existing id and writes nothing, so an hourly re-read does not stack rows.
2b. `admin_approve_pending(id, note, actor)` applies the row **only by calling
    an existing admin_* RPC chosen by kind**: `payment` to
    `admin_record_payment`, `pick` to `admin_submit_pick`, `entries` to
    `admin_add_entries`. Nothing writes payments, picks, entries or owners
    directly, so the append-only ledger, the txn-per-owner dedupe, the mint
    trigger and the audit rule all hold. If the RPC refuses (duplicate
    transaction, unknown week) the whole approve rolls back and the row stays
    open.
2c. A kind with no RPC (`new_owner`, `identity`, anything new) is recorded as
    approved and **not applied**; Anthony enters it on its own screen.
    `new_owner` is manual on purpose: the duplicate-owner search lives on Quick
    add, not in a payload.
2d. `admin_dismiss_pending(id, note, actor)` resolves the row and applies
    nothing.
2e. The table has RLS with an admin-only select policy and **no write policy or
    grant**, so the three RPCs (security definer, each gated on `is_admin()`)
    are the only write path. Anon has no privilege on it. Nothing public reads
    it.

3. Payload shapes the dispatch reads
| kind | required | optional |
| --- | --- | --- |
| payment | amount_cents, paid_on | owner_id (null = unmatched), method (default venmo), venmo_txn_id, note, corrects, sender |
| pick | entry_id, week, team | source (default admin), entry_name |
| entries | owner_id, entry_names[] | name_is_default, is_free, owner_name |

The screen's copy of the dispatch table is `KIND_DISPATCH` in
`src/lib/queue.ts`; `tests/unit/queue.test.ts` reads the migration and fails if
the two drift.

4. Coverage
4a. `tests/sql/13_pending_queue.sql`: RLS denies anon, RPCs refuse a non-admin,
    the admin cannot write the table directly, stage then approve applies
    through the RPC and audits, a refused RPC leaves the row open, dismiss
    applies nothing. Runs via `scripts/db/test-db.sh`; it has not been run on
    a Mac without Postgres.
4b. `tests/unit/queue.test.ts`: payload summaries, kind labels, dispatch table,
    and the SQL seam.
