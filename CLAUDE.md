# Survivor — working notes

Conventions and standing decisions that outlive a single session. Anything
here was set by Anthony; do not change a rule in this file without being
asked to.

## Payment sweeps

Survivor entry prices are **$30 / $60 / $90 / $100** for one / two / three /
four-plus entries.

When sweeping Venmo receipts against the payments ledger, **only flag incoming
receipts whose amount is one of those four values**. Any other amount is
almost certainly the separate TNF block pool or personal money — do not
surface it unless Anthony asks.

Resolved exclusions are recorded in `audit_log` under the action
`payment_sweep_exclude`, each naming the transaction IDs it clears. Check
those rows (via /admin/audit) before re-raising anything.

## Names

Entry names are stored **verbatim** — never normalized, cased, or trimmed by
the app. When Anthony standardizes a name himself, the override is recorded
in the owner's notes so it is clear the app did not do it silently.

## Money on public surfaces

None of this group's finances appear on any public route: no collected, due,
percentage, or progress bar, and no recruited-vs-free split. That split is a
billing concept and is admin-only. The pool-wide prize pot (Lynne's whole
pool) is the one dollar figure that is public by design.
