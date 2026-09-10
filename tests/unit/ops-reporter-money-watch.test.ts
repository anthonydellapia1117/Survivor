import { describe, expect, it } from "vitest";
import { renderReport } from "../../scripts/ops/lib/report";
import { reportMoneyWatch } from "../../scripts/ops/reporters/money-watch";
import type {
  OpsSnapshot,
  OwnerSnapshot,
  PaymentSnapshot,
  WeekSnapshot,
} from "../../scripts/ops/reporters/types";

// A calendar is here only so the snapshot is a real one; no line this reporter
// prints is tied to a deadline (docs/ROUTINES.md section 7: no deadline depends
// on this job, and its prompt omits the deadline clause because payments have
// no tier). The "same report at any hour" test below holds it to that.
const WEEKS: WeekSnapshot[] = [
  { week: 1, earlyDeadlineAt: "2026-09-09T16:00:00Z", lateDeadlineAt: "2026-09-11T16:00:00Z" },
];

const NOW = new Date("2026-09-14T15:00:00Z");

function snap(over: Partial<OpsSnapshot> = {}): OpsSnapshot {
  return {
    now: NOW,
    weeks: WEEKS,
    games: [],
    entries: [],
    picks: [],
    herRows: [],
    herSheet: null,
    herMail: [],
    owners: [],
    payments: [],
    recipientAddresses: [],
    expectedRosterAddresses: 39,
    freeEntryCount: 0,
    recruitedCount: 0,
    lynneRateCents: 2500,
    ...over,
  };
}

/** An unmatched $100 receipt: owner_id NULL is quarantine, not a missing value. */
function payment(over: Partial<PaymentSnapshot> = {}): PaymentSnapshot {
  return {
    ownerId: null,
    amountCents: 10000,
    venmoTxnId: "3721095847362",
    paidOn: "2026-09-03",
    note: "Survivor",
    ...over,
  };
}

function owner(over: Partial<OwnerSnapshot> = {}): OwnerSnapshot {
  return {
    id: "o1",
    name: "Ray Vassallo",
    email: "ray@example.com",
    entryCount: 4,
    dueCents: 10000,
    paidCents: 0,
    ...over,
  };
}

function texts(s: OpsSnapshot): string[] {
  return reportMoneyWatch(s).items.map((i) => i.text);
}

/** The one line carrying an unmatched receipt, for a snapshot that has one. */
function receiptText(s: OpsSnapshot): string {
  const found = texts(s).filter((t) => t.includes("unmatched in the ledger"));
  expect(found).toHaveLength(1);
  return found[0];
}

describe("money-watch: the job it reports as", () => {
  it("names itself money-watch, which is what daily.ts prints and notify posts", () => {
    expect(reportMoneyWatch(snap()).job).toBe("money-watch");
  });
});

describe("money-watch: nothing to report", () => {
  it("gives NO ACTION and no preamble on an empty ledger", () => {
    const r = reportMoneyWatch(snap());
    expect(r.items).toEqual([]);
    expect(r.preamble).toBeUndefined();
    expect(renderReport(r)).toEqual(["NO ACTION"]);
  });

  it("says the same report whatever hour it runs - nothing here is tied to a clock", () => {
    const s = snap({
      payments: [payment({ amountCents: 20000, venmoTxnId: "t-200" })],
      owners: [owner()],
      recruitedCount: 110,
      freeEntryCount: 11,
    });
    const early = texts({ ...s, now: new Date("2026-09-14T04:00:00Z") });
    const late = texts({ ...s, now: new Date("2027-02-01T23:30:00Z") });
    expect(late).toEqual(early);
  });
});

describe("money-watch: the preamble", () => {
  it("names the payment_sweep_exclude row to check before acting, once, above the items", () => {
    const r = reportMoneyWatch(snap({ payments: [payment()] }));
    expect(r.preamble).toBe(
      "check /admin/audit for a payment_sweep_exclude row naming the transaction before acting.",
    );
    expect(renderReport(r)[0]).toBe("NEEDS ANTHONY");
    expect(renderReport(r)[1]).toBe(r.preamble);
  });
});

describe("money-watch: unmatched receipts, amount first", () => {
  it("reads a tier price as a candidate and carries the amount and the stored txn id", () => {
    const t = receiptText(snap({ payments: [payment()] }));
    expect(t).toContain("$100");
    expect(t).toContain("txn 3721095847362");
    expect(t).toContain("a tier price, so a candidate");
    expect(t).toContain("match it on /admin/payments");
  });

  it("reports all four tier prices and nothing between them", () => {
    const s = snap({
      payments: [3000, 6000, 9000, 10000, 4000].map((amountCents, i) =>
        payment({ amountCents, venmoTxnId: `t${i}`, note: "thanks" }),
      ),
    });
    const found = texts(s).filter((t) => t.includes("a tier price, so a candidate"));
    expect(found).toHaveLength(4);
    expect(texts(s).join(" ")).not.toContain("$40");
  });

  it("copies the txn id byte for byte, spacing included", () => {
    const t = receiptText(snap({ payments: [payment({ venmoTxnId: "  4213-9987_x " })] }));
    expect(t).toContain("txn   4213-9987_x ");
  });

  it("says the txn id is not shown rather than constructing one", () => {
    const t = receiptText(snap({ payments: [payment({ venmoTxnId: null })] }));
    expect(t).toContain("(txn id not shown)");
    expect(t).not.toContain("txn 2026");
    expect(t).not.toContain("txn 10000");
  });

  it("says paid_on is not recorded rather than dating the receipt itself", () => {
    const t = receiptText(snap({ payments: [payment({ paidOn: null })] }));
    expect(t).toContain("paid_on not recorded");
    expect(t).not.toContain("2026-09-14");
  });

  it("quotes the memo verbatim, spacing and all", () => {
    const t = receiptText(snap({ payments: [payment({ amountCents: 5000, note: "1 of 2  " })] }));
    expect(t).toContain('memo "1 of 2  "');
  });

  it("leaves a receipt Anthony matched alone - his decision is not re-asked", () => {
    const r = reportMoneyWatch(snap({ payments: [payment({ ownerId: "o1" })] }));
    expect(r.items).toEqual([]);
  });
});

describe("money-watch: the sender stands alone (Tropea and Flaherty)", () => {
  it("never pairs an unmatched receipt with an owner, however well the amount fits", () => {
    // $100 unmatched, and an owner owing exactly $100. Matching on a name
    // instead of an amount is what produced the false positives that had to be
    // chased down and cleared, and a fitting amount is not a name either.
    const s = snap({
      payments: [payment()],
      recruitedCount: 4,
      owners: [owner({ name: "Mario Tropea III", dueCents: 10000, paidCents: 0 })],
    });
    const t = receiptText(s);
    expect(t).not.toContain("Mario");
    expect(t).not.toContain("Tropea");
    expect(t).not.toContain("o1");
  });
});

describe("money-watch: aggregates and splits, the second pass", () => {
  it("reads $200 as a possible aggregate and shows the sum it reads as", () => {
    const t = receiptText(snap({ payments: [payment({ amountCents: 20000, note: "pool" })] }));
    expect(t).toContain("possible aggregate or split, needs review");
    expect(t).toContain("it sums as $100 + $100");
  });

  it("reads $130 as $100 plus $30", () => {
    const t = receiptText(snap({ payments: [payment({ amountCents: 13000, note: "pool" })] }));
    expect(t).toContain("it sums as $100 + $30");
  });

  it("reads $50 as exactly half a tier price - Raudenbush paid $100 as two of them", () => {
    const t = receiptText(snap({ payments: [payment({ amountCents: 5000, note: "" })] }));
    expect(t).toContain("possible aggregate or split, needs review");
    expect(t).toContain("exactly half the $100 tier price");
  });

  it("reads an instalment memo as a split at an amount no arithmetic would reach", () => {
    const t = receiptText(snap({ payments: [payment({ amountCents: 7500, note: "1 of 2" })] }));
    expect(t).toContain("possible aggregate or split, needs review");
    expect(t).toContain("the memo reads as an instalment");
  });

  it("drops an instalment memo above the top tier price - section 3b caps a split under $100", () => {
    // $105 is no sum of tier prices and no half of one, and above the top tier
    // there is no split reading left to have. A real two-part $105 shows up as
    // its $210 whole, which the aggregate test above catches.
    const r = reportMoneyWatch(snap({ payments: [payment({ amountCents: 10500, note: "1 of 2" })] }));
    expect(r.items).toEqual([]);
  });

  it("drops a non-tier amount with no aggregate and no split reading", () => {
    const r = reportMoneyWatch(snap({ payments: [payment({ amountCents: 11000, note: "thanks" })] }));
    expect(r.items).toEqual([]);
  });

  it("carries the memo of a receipt whose amount reads as an aggregate, so it can be dropped by eye", () => {
    // CLAUDE.md rejects a $500 on the strength of its memo, not its amount -
    // $500 is five $100s arithmetically. The memo names a system this repo may
    // not reference at all, so it goes on the line verbatim and the judgment
    // stays with Anthony rather than becoming a keyword list in the reporter.
    const t = receiptText(snap({ payments: [payment({ amountCents: 50000, note: "Thursday block" })] }));
    expect(t).toContain('memo "Thursday block"');
    expect(t).toContain("needs review");
  });
});

describe("money-watch: owners still owing", () => {
  it("leads with the count and names every owner with the shortfall", () => {
    const s = snap({
      recruitedCount: 10,
      owners: [
        owner({ id: "o1", name: "Ray Vassallo", dueCents: 10000, paidCents: 0 }),
        owner({ id: "o2", name: "Mario Tropea III", dueCents: 10000, paidCents: 7000 }),
        owner({ id: "o3", name: "Chas Flaster", dueCents: 6000, paidCents: 6000 }),
      ],
    });
    const line = texts(s).find((t) => t.includes("still owing"));
    expect(line).toBeDefined();
    expect(line).toContain("2 owners still owing $130:");
    expect(line).toContain("Ray Vassallo $100");
    expect(line).toContain("Mario Tropea III $30");
    expect(line).not.toContain("Chas Flaster");
  });

  it("says only Anthony marks Paid, and never says an owner has paid", () => {
    const s = snap({ recruitedCount: 4, owners: [owner()], payments: [payment()] });
    const line = texts(s).find((t) => t.includes("still owing"));
    expect(line).toContain("only you mark Paid");
    for (const t of texts(s)) expect(t).not.toMatch(/has paid|is paid|paid in full|settled/i);
  });

  it("says nothing when every owner is square", () => {
    const s = snap({ recruitedCount: 4, owners: [owner({ dueCents: 10000, paidCents: 10000 })] });
    expect(texts(s).filter((t) => t.includes("still owing"))).toEqual([]);
  });
});

describe("money-watch: remittance to Lynne", () => {
  it("is recruited times the rate, with the free entries excluded entirely", () => {
    const line = texts(snap({ recruitedCount: 110, freeEntryCount: 11 })).find((t) =>
      t.includes("to Lynne"),
    );
    expect(line).toContain("$2,750 to Lynne (110 recruited x $25)");
    expect(line).toContain("the 11 free entries are excluded entirely");
    // 121 x $25 would be $3,025: the free eleven still get her numbers and are
    // on the roster export, they just do not bill.
    expect(line).not.toContain("$3,025");
  });

  it("is the same figure whether or not anybody has paid Anthony", () => {
    const owed = (paidCents: number) =>
      texts(
        snap({
          recruitedCount: 4,
          freeEntryCount: 1,
          owners: [owner({ dueCents: 10000, paidCents })],
        }),
      ).find((t) => t.includes("to Lynne"));
    expect(owed(0)).toBe(owed(10000));
    expect(owed(0)).toContain("$100 to Lynne (4 recruited x $25)");
  });

  it("uses the rate on the snapshot rather than the constant", () => {
    const line = texts(snap({ recruitedCount: 110, lynneRateCents: 3000 })).find((t) =>
      t.includes("to Lynne"),
    );
    expect(line).toContain("$3,300 to Lynne (110 recruited x $30)");
  });

  it("says nothing about her when nobody has been recruited", () => {
    const s = snap({ recruitedCount: 0, freeEntryCount: 11 });
    expect(texts(s).filter((t) => t.includes("to Lynne"))).toEqual([]);
  });
});

describe("money-watch: the due total against the recruited count", () => {
  it("carries both figures when the ledger cannot be billed by any tier assignment", () => {
    const s = snap({
      recruitedCount: 2,
      owners: [owner({ dueCents: 12000, paidCents: 12000 })],
    });
    const line = texts(s)[0];
    expect(line).toContain("The owners' due total is $120");
    expect(line).toContain("2 recruited at the four tier prices bills $50 to $60");
    expect(line).toContain("neither corrected here");
  });

  it("stays quiet on a lawful mix of tiers", () => {
    // Five recruited: one owner of four at $100 and one of one at $30. Legal,
    // and inside the $125-$150 band the count can bill.
    const s = snap({
      recruitedCount: 5,
      owners: [
        owner({ id: "o1", dueCents: 10000, paidCents: 10000 }),
        owner({ id: "o2", name: "Nicco E", entryCount: 1, dueCents: 3000, paidCents: 3000 }),
      ],
    });
    expect(texts(s).filter((t) => t.includes("due total"))).toEqual([]);
  });
});

describe("money-watch: the twelve-line cap", () => {
  it("keeps the aggregate line whole and folds tier receipts, dropping no txn id", () => {
    const tiers = Array.from({ length: 11 }, (_, i) =>
      payment({ venmoTxnId: `tier-${i}`, paidOn: `2026-09-${String(20 - i).padStart(2, "0")}` }),
    );
    const r = reportMoneyWatch(
      snap({ payments: [...tiers, payment({ amountCents: 20000, venmoTxnId: "agg-1" })] }),
    );
    const lines = renderReport(r);
    expect(lines).toHaveLength(12);
    // The aggregate leads and survives whole; section 6 of the prompt folds the
    // plain tier receipts and keeps every aggregate and split line.
    expect(lines.some((l) => l.includes("possible aggregate or split, needs review"))).toBe(true);
    const last = lines[lines.length - 1];
    expect(last.startsWith("3 more: ")).toBe(true);
    for (const id of ["tier-8", "tier-9", "tier-10"]) expect(last).toContain(`$100 txn ${id}`);
  });
});
