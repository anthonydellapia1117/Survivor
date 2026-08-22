import { describe, expect, it } from "vitest";
import {
  amountDueCents,
  coveredPaidEntries,
  defaultEntryNames,
  formatCents,
  freeEntriesEarned,
  freeEntryStatus,
  lynneRemittanceCents,
} from "@/lib/pool";

describe("tier pricing (locked)", () => {
  it("charges $30 per entry for 1-3 entries", () => {
    expect(amountDueCents(1)).toBe(3000);
    expect(amountDueCents(2)).toBe(6000);
    expect(amountDueCents(3)).toBe(9000);
  });

  it("charges $25 per entry for 4 or more entries — applied to all of them", () => {
    expect(amountDueCents(4)).toBe(10000);
    expect(amountDueCents(5)).toBe(12500);
    expect(amountDueCents(10)).toBe(25000);
  });

  it("charges nothing for zero paid entries", () => {
    expect(amountDueCents(0)).toBe(0);
  });

  it("reproduces the section 9 roster totals: $1,210 due across 14 owners", () => {
    const entryCounts = [4, 2, 1, 2, 4, 4, 4, 4, 4, 4, 2, 4, 4, 4];
    const total = entryCounts.reduce((s, n) => s + amountDueCents(n), 0);
    expect(entryCounts.reduce((a, b) => a + b, 0)).toBe(47);
    // Spec section 9's per-owner Due column sums to $1,210; its "$860 due /
    // $1,110 pool" headline drops one $100 owner. Computed truth wins.
    expect(total).toBe(121000);
  });
});

describe("Lynne remittance (locked)", () => {
  it("is $25 per entry at every tier", () => {
    expect(lynneRemittanceCents(1)).toBe(2500);
    expect(lynneRemittanceCents(3)).toBe(7500);
    expect(lynneRemittanceCents(47)).toBe(117500);
  });
});

describe("free entries (locked)", () => {
  it("is FLOOR(paid / 10)", () => {
    expect(freeEntriesEarned(0)).toBe(0);
    expect(freeEntriesEarned(9)).toBe(0); // current roster: 9 paid entries -> 0
    expect(freeEntriesEarned(10)).toBe(1);
    expect(freeEntriesEarned(19)).toBe(1);
    expect(freeEntriesEarned(20)).toBe(2);
  });
});

describe("default entry naming (locked)", () => {
  it("uses the plain name for a single entry", () => {
    expect(defaultEntryNames("Tim Flaherty", 1)).toEqual(["Tim Flaherty"]);
  });

  it("numbers multiple entries", () => {
    expect(defaultEntryNames("John Vassallo", 4)).toEqual([
      "John Vassallo 1",
      "John Vassallo 2",
      "John Vassallo 3",
      "John Vassallo 4",
    ]);
  });
});

describe("covered paid entries + free-entry status", () => {
  // Spec section 9's live position: Maria $100/4, Brian $60/2, Tim $30/1,
  // Marc $60/2, everyone else unpaid → 9 covered → FLOOR(9/10) = 0 earned.
  const seed = [
    { participationStatus: "confirmed", paidEntryCount: 4, dueCents: 10000, paidCents: 10000 }, // Maria
    { participationStatus: "confirmed", paidEntryCount: 2, dueCents: 6000, paidCents: 6000 }, // Brian
    { participationStatus: "confirmed", paidEntryCount: 1, dueCents: 3000, paidCents: 3000 }, // Tim
    { participationStatus: "confirmed", paidEntryCount: 2, dueCents: 6000, paidCents: 6000 }, // Marc
    { participationStatus: "confirmed", paidEntryCount: 4, dueCents: 10000, paidCents: 0 },
    { participationStatus: "pending", paidEntryCount: 4, dueCents: 10000, paidCents: 10000 },
  ];

  it("matches the spec's worked example: 9 covered, 0 earned", () => {
    const s = freeEntryStatus(seed, 0);
    expect(s.covered).toBe(9);
    expect(s.earned).toBe(0);
    expect(s.unnamed).toBe(0);
  });

  it("partial payments cover whole entries only, at the owner's tier rate", () => {
    // 4-entry owner at $25/entry pays $60 → 2 entries covered, not 2.4.
    expect(
      coveredPaidEntries({ paidEntryCount: 4, dueCents: 10000, paidCents: 6000 }),
    ).toBe(2);
    // Overpayment never covers more entries than the owner has.
    expect(
      coveredPaidEntries({ paidEntryCount: 2, dueCents: 6000, paidCents: 9000 }),
    ).toBe(2);
    expect(
      coveredPaidEntries({ paidEntryCount: 0, dueCents: 0, paidCents: 5000 }),
    ).toBe(0);
  });

  it("crossing 10 covered earns a free entry and flags it unnamed", () => {
    const paidUp = seed.map((o) =>
      o.participationStatus === "confirmed" ? { ...o, paidCents: o.dueCents } : o,
    );
    const s = freeEntryStatus(paidUp, 0); // 13 covered
    expect(s.covered).toBe(13);
    expect(s.earned).toBe(1);
    expect(s.unnamed).toBe(1);
    expect(freeEntryStatus(paidUp, 1).unnamed).toBe(0);
    expect(freeEntryStatus(paidUp, 2).overNamed).toBe(1);
  });
});

describe("money formatting", () => {
  it("renders whole dollars without cents", () => {
    expect(formatCents(25000)).toBe("$250");
    expect(formatCents(121000)).toBe("$1,210");
  });
  it("renders fractional dollars with cents", () => {
    expect(formatCents(2550)).toBe("$25.50");
  });
  it("renders negatives (corrections)", () => {
    expect(formatCents(-3000)).toBe("-$30");
  });
});
