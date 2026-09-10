// The Venmo Wide Sweep, as a pure reporter (docs/ROUTINES.md section 7), moved
// off the mailbox and onto the ledger.
//
// The Routine it replaces had Gmail, the repo and the clock and no database at
// all (section 1b), so it classified receipts by reading them. The hourly sweep
// stages what it can into `payments` now, and a row whose `owner_id` is null is
// a receipt sitting in quarantine - CLAUDE.md: NULL there is a MEANINGFUL
// VALUE, an unmatched receipt, not a missing one. So this reads the ledger and
// asks the three questions the prompt asked:
//
//   - is this receipt pool money?
//   - who has not paid?
//   - what does Lynne get?
//
// What survives from the prompt is the reasoning, and all of it is the Money
// section of CLAUDE.md:
//
//   - AMOUNT FIRST, ALWAYS. The four tier prices are the first pass.
//   - A NAME IS NEVER A SIGNAL, and a receipt is NEVER paired with an owner.
//     Matching on a name instead of an amount is what produced the TROPEA AND
//     FLAHERTY FALSE POSITIVES that had to be chased down and cleared; people
//     in this pool also send Anthony money for entirely unrelated reasons.
//   - THE AMOUNT FILTER IS THE FIRST PASS, NOT THE ONLY ONE. Nicholas Teti's
//     $200 settled eight entries across two owner records and Charles
//     Raudenbush's $100 arrived as two $50 deposits, so a non-tier amount with
//     a plausible aggregate or split reading is surfaced for review rather
//     than discarded. It is rejected only when it is not a tier price AND no
//     such reading exists.
//   - REMITTANCE IS RECRUITED, NEVER PAID. An unpaid recruit still costs $25;
//     free entries are excluded entirely.
//
// It reports and does nothing else: no write, no send, no label, no mark Paid,
// no identity resolved and no variance resolved. Anthony matches a receipt to
// an owner on /admin/payments, and only his hand marks a payment.
//
// NO LINE HERE NAMES A DEADLINE, and that is deliberate rather than forgotten:
// section 7 says no deadline depends on this job and section 6 of its prompt
// says payments have no tier deadline and the clause is omitted. Tying a
// receipt to Friday noon would invent a boundary the schedule does not have.

import {
  DEFAULT_PRICING,
  amountDueCents,
  formatCents,
  lynneRemittanceCents,
} from "@/lib/pool";
import type { Report, ReportItem } from "../lib/report";
import type { OpsSnapshot, PaymentSnapshot } from "./types";

const JOB = "money-watch";

// Said once above the items rather than on every receipt line - section 1d
// wants the question, not the same sentence eight times. Resolved exclusions
// are recorded in audit_log under `payment_sweep_exclude`, each naming the
// transaction IDs it clears, and CLAUDE.md says to check those rows before
// re-raising anything: a receipt already cleared is not a question again.
const PREAMBLE =
  "check /admin/audit for a payment_sweep_exclude row naming the transaction before acting.";

/**
 * The four tier prices - $30, $60, $90, $100 - derived from the one function
 * that prices an owner rather than typed out a second time.
 *
 * CLAUDE.md: the four tier prices are the only prices. There is no per-owner
 * rate field, no per-entry price and no hardcoded split, so pricing 1, 2, 3 and
 * 4 entries IS the list. A hardcoded copy here is exactly how the two drift.
 */
const TIER_PRICES: readonly number[] = [1, 2, 3, 4].map((n) => amountDueCents(n));

/** The largest of them, which is the ceiling section 3b puts on a split. */
const MAX_TIER = Math.max(...TIER_PRICES);

/**
 * Exactly half a tier price: $15, $45 and $50. Test two of section 3b, and the
 * one that reads Charles Raudenbush's $100 paid as two $50 deposits without
 * knowing anything about him. $30 is half of $60 and is a tier price in its own
 * right, so it is answered by the tier branch and never reaches here.
 */
const HALF_TIER_PRICES: readonly number[] = TIER_PRICES.filter((p) => p % 2 === 0).map((p) => p / 2);

/**
 * A memo that reads as an instalment - test one of section 3b, which is what
 * made Raudenbush's two deposits legible ("1 of 2", "2 of 2"). Her memo is
 * stored verbatim, so this reads it and never rewrites it.
 */
const INSTALMENT_MEMO = /\b(\d+\s*of\s*\d+|half|partial|part|deposit|balance|instal?lment)\b/i;

/** Every tier price is a multiple of $10, so every sum of them is too. */
const AGGREGATE_UNIT = 1000;

/**
 * A loop bound, not a judgment about money: the search below walks $10 steps up
 * to the amount, and a garbage value has to terminate. Nothing in this pool is
 * six figures - her whole pool's pot is $28,620 - so no reading is lost.
 */
const MAX_AGGREGATE_UNITS = 10_000;

/**
 * The tier prices that sum to `amountCents`, fewest first, or null when none
 * do. Two or more parts, because one part is a tier price and is answered
 * before this is asked.
 *
 * This is section 3b's aggregate: $200 as $100 plus $100 (Nicholas Teti's, for
 * his own four entries and his father Jim's four), $130 as $100 plus $30. It is
 * arithmetic on the amount and nothing else - it names no owner, counts nobody's
 * entries and suggests nobody. Ties go to the largest tier first so one
 * snapshot always prints one reading.
 */
function aggregateParts(amountCents: number): number[] | null {
  if (amountCents <= 0 || amountCents % AGGREGATE_UNIT !== 0) return null;
  const target = amountCents / AGGREGATE_UNIT;
  if (target > MAX_AGGREGATE_UNITS) return null;

  const units = TIER_PRICES.map((p) => p / AGGREGATE_UNIT).sort((a, b) => b - a);
  const best: (number[] | null)[] = new Array<number[] | null>(target + 1).fill(null);
  best[0] = [];
  for (let k = 1; k <= target; k++) {
    for (const u of units) {
      if (u > k) continue;
      const prev = best[k - u];
      if (prev === null) continue;
      const current = best[k];
      if (current === null || prev.length + 1 < current.length) best[k] = [u, ...prev];
    }
  }
  const parts = best[target];
  if (parts === null || parts.length < 2) return null;
  return parts.map((u) => u * AGGREGATE_UNIT).sort((a, b) => b - a);
}

/**
 * What the amount reads as, or null when the receipt is not reported at all.
 *
 * CLAUDE.md: reject only when the amount is not a tier price AND no plausible
 * aggregate or split reading exists. So the order is the rule's order - tier
 * price, then aggregate, then split - and anything that survives all three is
 * dropped silently rather than half-reported.
 *
 * The third split test of section 3b cannot run here and is deliberately not
 * approximated. It pairs a receipt with another carrying the IDENTICAL VENMO
 * SENDER STRING, byte for byte, and the ledger carries no sender string at all;
 * pairing two receipts on a date or an amount instead would be matching on
 * something other than the amount, which is the Tropea and Flaherty mistake
 * wearing a different hat. A lone instalment still surfaces on tests one and
 * two, which is where both known splits landed anyway.
 */
function readingFor(p: PaymentSnapshot): string | null {
  if (TIER_PRICES.includes(p.amountCents)) {
    return "a tier price, so a candidate";
  }

  const parts = aggregateParts(p.amountCents);
  if (parts !== null) {
    return `not a tier price - possible aggregate or split, needs review - it sums as ${parts.map(formatCents).join(" + ")}`;
  }

  // Section 3b caps a split below the top tier price: above it, an amount that
  // is not a sum of tier prices has no split reading left to have.
  if (p.amountCents > 0 && p.amountCents < MAX_TIER) {
    if (p.note !== null && INSTALMENT_MEMO.test(p.note)) {
      return "not a tier price - possible aggregate or split, needs review - the memo reads as an instalment";
    }
    const whole = HALF_TIER_PRICES.includes(p.amountCents) ? p.amountCents * 2 : null;
    if (whole !== null) {
      return `not a tier price - possible aggregate or split, needs review - exactly half the ${formatCents(whole)} tier price`;
    }
  }

  return null;
}

/**
 * One unmatched receipt as a line.
 *
 * THE AMOUNT AND THE TRANSACTION ID STAND ALONE. No owner name appears on it,
 * no owner is suggested, and s.owners is not consulted to build it - the
 * question is whether this is pool money, never who sent it. The transaction id
 * is copied exactly as stored and a missing one says so; constructing one, or
 * substituting some other id, would put a value in front of Anthony that
 * matches nothing in Venmo.
 *
 * The memo is quoted verbatim, as it is stored. It is the field that settles
 * the cases arithmetic cannot: CLAUDE.md rejects a $500 on the strength of its
 * "Thursday block" memo, and that memo names a system this repo may not
 * reference at all, so the memo goes on the line and the judgment stays with
 * Anthony rather than becoming a keyword list here.
 */
function receiptItem(p: PaymentSnapshot, reading: string): ReportItem {
  const when = p.paidOn === null ? ", paid_on not recorded" : ` on ${p.paidOn}`;
  const txn = p.venmoTxnId === null ? "txn id not shown" : `txn ${p.venmoTxnId}`;
  const memo = p.note === null || p.note.trim() === "" ? "no memo" : `memo "${p.note}"`;
  return {
    text:
      `${formatCents(p.amountCents)}${when} (${txn}), ${memo} - unmatched in the ledger` +
      ` - ${reading} - is this pool money? match it on /admin/payments`,
    // Amount and transaction id are what identifies the receipt in Venmo, and
    // they are the pair that has to survive a collapse. A name would be the one
    // thing that must never be here.
    names: [`${formatCents(p.amountCents)} ${txn}`],
  };
}

/** Newest first, unknown date last, then largest first, then by id: one snapshot, one order. */
function byRecency(a: PaymentSnapshot, b: PaymentSnapshot): number {
  return (
    (b.paidOn ?? "").localeCompare(a.paidOn ?? "") ||
    b.amountCents - a.amountCents ||
    (a.venmoTxnId ?? "").localeCompare(b.venmoTxnId ?? "")
  );
}

/**
 * The quarantine pile: every payment with no owner on it.
 *
 * Aggregates and splits lead. Section 6 of the prompt keeps every one of those
 * lines and folds the plain tier receipts when the cap bites, and renderReport
 * collapses from the end - so putting them first is what implements it.
 */
function unmatchedItems(s: OpsSnapshot): ReportItem[] {
  const read = s.payments
    // CLAUDE.md: owner_id NULL is unmatched, which is a value and not a gap. A
    // matched receipt is Anthony's decision already made and is never re-asked.
    .filter((p) => p.ownerId === null)
    .sort(byRecency)
    .map((p) => ({ p, reading: readingFor(p) }))
    .filter((r): r is { p: PaymentSnapshot; reading: string } => r.reading !== null);

  const review = read.filter((r) => !TIER_PRICES.includes(r.p.amountCents));
  const tier = read.filter((r) => TIER_PRICES.includes(r.p.amountCents));
  return [...review, ...tier].map((r) => receiptItem(r.p, r.reading));
}

/**
 * Who still owes, led by the count and naming every one of them.
 *
 * NOT ONE LINE HERE SAYS AN OWNER HAS PAID. An unmatched receipt above is a
 * candidate, not a payment: only Anthony marks one, on /admin/payments, and the
 * ledger is append-only so a correction is a new row and never an edit. Reading
 * a receipt as a settlement is how a name-matched false positive becomes a
 * balance that was never collected.
 */
function owingItems(s: OpsSnapshot): ReportItem[] {
  const owing = s.owners
    .filter((o) => o.paidCents < o.dueCents)
    .map((o) => ({ o, short: o.dueCents - o.paidCents }))
    .sort((a, b) => b.short - a.short || a.o.name.localeCompare(b.o.name));
  if (owing.length === 0) return [];

  const names = owing.map((x) => `${x.o.name} ${formatCents(x.short)}`);
  const total = owing.reduce((n, x) => n + x.short, 0);
  return [
    {
      text:
        `${owing.length} owner${owing.length === 1 ? "" : "s"} still owing ${formatCents(total)}: ${names.join(", ")}` +
        ` - an unmatched receipt is not a payment until you match it on /admin/payments; only you mark Paid`,
      names,
    },
  ];
}

/**
 * What Lynne is owed: RECRUITED times the rate, never the paid count.
 *
 * CLAUDE.md: recruited entries x $25 regardless of whether that recruit has
 * paid Anthony - what a player owes and what she is owed are separate ledgers,
 * and an unpaid recruit still costs $25. Free entries are excluded entirely;
 * they still get her numbers and appear in the roster export, they just do not
 * bill. The rate comes off the snapshot's config rather than the constant, so a
 * changed rate reports the changed figure.
 */
function remittanceItems(s: OpsSnapshot): ReportItem[] {
  if (s.recruitedCount <= 0) return [];
  const owed = lynneRemittanceCents(s.recruitedCount, {
    ...DEFAULT_PRICING,
    lynneRateCents: s.lynneRateCents,
  });
  const free =
    s.freeEntryCount > 0
      ? `the ${s.freeEntryCount} free ${s.freeEntryCount === 1 ? "entry is" : "entries are"} excluded entirely`
      : "free entries are excluded entirely";
  const label = `${formatCents(owed)} to Lynne (${s.recruitedCount} recruited x ${formatCents(s.lynneRateCents)})`;
  return [
    {
      text: `${label} - recruited, paid or not: what a player owes and what she is owed are separate ledgers - ${free}`,
      names: [label],
    },
  ];
}

/**
 * The owners' due total against what the recruited count can bill.
 *
 * Every recruited entry bills at one of the four tier prices and there is no
 * override - no per-owner rate field, no per-entry price, no hardcoded split -
 * so a roster of N recruited entries bills at least N x $25 (every owner at the
 * 4+ tier) and at most N x $30 (every owner at the 1-3 tier). A due total
 * outside that band cannot be produced by any legal tier assignment, whatever
 * the mix of owners is, so this fires on a real disagreement and never on a
 * lawful one.
 *
 * It carries BOTH figures and resolves neither. It can mean the ledger drifted;
 * it can equally mean the config's tier prices no longer match the constants
 * this reads. Which one is wrong is Anthony's call, exactly as a variance
 * between his record and hers is.
 */
function dueTotalItems(s: OpsSnapshot): ReportItem[] {
  const ledger = s.owners.reduce((n, o) => n + o.dueCents, 0);
  const low = s.recruitedCount * DEFAULT_PRICING.tier4PlusCents;
  const high = s.recruitedCount * DEFAULT_PRICING.tier13Cents;
  if (ledger >= low && ledger <= high) return [];

  const label =
    `owner due total ${formatCents(ledger)} vs ${formatCents(low)}-${formatCents(high)}` +
    ` for ${s.recruitedCount} recruited`;
  return [
    {
      text:
        `The owners' due total is ${formatCents(ledger)}, and ${s.recruitedCount} recruited at the four tier prices bills` +
        ` ${formatCents(low)} to ${formatCents(high)} - both figures as recorded, neither corrected here - check /admin`,
      names: [label],
    },
  ];
}

export function reportMoneyWatch(s: OpsSnapshot): Report {
  // A broken total first, because every figure under it is read against the
  // same ledger; then the standing obligation; then who owes; then the
  // quarantine pile, which is the longest and the only one with no figure of
  // its own to be wrong.
  const items: ReportItem[] = [
    ...dueTotalItems(s),
    ...remittanceItems(s),
    ...owingItems(s),
    ...unmatchedItems(s),
  ];
  return items.length > 0 ? { job: JOB, items, preamble: PREAMBLE } : { job: JOB, items };
}
