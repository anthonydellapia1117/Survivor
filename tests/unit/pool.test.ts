import { describe, expect, it } from "vitest";
import {
  amountDueCents,
  defaultEntryNames,
  formatCents,
  freeEntriesEarned,
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
