import { describe, expect, it } from "vitest";
import {
  amountDueCents,
  defaultEntryNames,
  ownerFullName,
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
  it("is FLOOR(recruited / 10) — payment status irrelevant", () => {
    expect(freeEntriesEarned(0)).toBe(0);
    expect(freeEntriesEarned(9)).toBe(0); // current roster: 9 paid entries -> 0
    expect(freeEntriesEarned(10)).toBe(1);
    expect(freeEntriesEarned(19)).toBe(1);
    expect(freeEntriesEarned(20)).toBe(2);
  });
});

describe("default entry naming (locked)", () => {
  it("uses the plain name for a single entry — no hash, no number", () => {
    expect(defaultEntryNames("Tim Flaherty", 1)).toEqual(["Tim Flaherty"]);
  });

  it("numbers multiple entries as 'Name #N' — space, hash, digit", () => {
    expect(defaultEntryNames("John Vassallo", 4)).toEqual([
      "John Vassallo #1",
      "John Vassallo #2",
      "John Vassallo #3",
      "John Vassallo #4",
    ]);
  });

  it("never puts a space between the hash and the digit", () => {
    for (const n of defaultEntryNames("Waggs", 4)) {
      expect(n).toMatch(/ #\d+$/);
      expect(n).not.toMatch(/# /);
    }
  });

  it("continues the numbering when an owner already has entries", () => {
    expect(defaultEntryNames("Brian Yost", 2, 3)).toEqual([
      "Brian Yost #3",
      "Brian Yost #4",
    ]);
  });

  it("a single entry added to an existing owner still gets its number", () => {
    expect(defaultEntryNames("Nicco Esgro", 1, 2)).toEqual(["Nicco Esgro #2"]);
  });

  it("returns nothing for a non-positive count", () => {
    expect(defaultEntryNames("Nobody", 0)).toEqual([]);
    expect(defaultEntryNames("Nobody", -3)).toEqual([]);
  });

  // Lynne matches entry names exactly, so a stray space in the owner's stored
  // name must not become a stray space in what she is asked to match.
  it("trims edge whitespace off the owner name before numbering", () => {
    expect(defaultEntryNames("Ernie DellaPia Jr. ", 2)).toEqual([
      "Ernie DellaPia Jr. #1",
      "Ernie DellaPia Jr. #2",
    ]);
    expect(defaultEntryNames("  Mike Penna  ", 1)).toEqual(["Mike Penna"]);
  });

  it("never emits a doubled space before the hash", () => {
    for (const n of defaultEntryNames("Ernie DellaPia Jr. ", 4)) {
      expect(n).not.toMatch(/ {2}/);
      expect(n).toMatch(/ #\d+$/);
    }
  });

  it("keeps internal spacing exactly as the owner has it", () => {
    expect(defaultEntryNames(" Rob  &  Alanna ", 2)).toEqual([
      "Rob  &  Alanna #1",
      "Rob  &  Alanna #2",
    ]);
  });

  // The RPC builds the name as btrim(btrim(first) || ' ' || btrim(last)).
  // Trimming only the joined string leaves a doubled space when the whitespace
  // sits at the join, so the app and a later resync would disagree for the same
  // owner. ownerFullName has to match the SQL exactly.
  it("trims each component, matching how the RPC joins them", () => {
    expect(ownerFullName("Ernie ", "DellaPia")).toBe("Ernie DellaPia");
    expect(ownerFullName("Ernie", " DellaPia")).toBe("Ernie DellaPia");
    expect(ownerFullName("Ernie", "DellaPia Jr. ")).toBe("Ernie DellaPia Jr.");
    expect(ownerFullName("  Mike  ", "  Penna  ")).toBe("Mike Penna");
  });

  it("drops a blank component instead of leaving a gap", () => {
    expect(ownerFullName("", "Teti")).toBe("Teti");
    expect(ownerFullName("Pumpy321", "")).toBe("Pumpy321");
    expect(ownerFullName("  ", "  ")).toBe("");
  });

  it("keeps spacing inside a component", () => {
    expect(ownerFullName(" Rob ", " &  Alanna ")).toBe("Rob &  Alanna");
  });

  it("never produces a doubled space at the join", () => {
    for (const [f, l] of [
      ["Ernie ", "DellaPia"],
      ["Ernie", " DellaPia"],
      ["Ernie ", " DellaPia"],
    ]) {
      for (const n of defaultEntryNames(ownerFullName(f, l), 2)) {
        expect(n).not.toMatch(/ {2}/);
      }
    }
  });

  it("returns nothing for a name that is blank or only whitespace", () => {
    expect(defaultEntryNames("", 4)).toEqual([]);
    expect(defaultEntryNames("   ", 4)).toEqual([]);
    expect(defaultEntryNames(" ", 1)).toEqual([]);
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

describe("free-entry rule (the runner's words)", () => {
  it("69 recruited earns 6 free, total 75; one more recruit makes it 7 and 77", async () => {
    const { freeEntitlement } = await import("@/lib/free-entries");
    expect(freeEntitlement(69)).toBe(6);
    expect(freeEntitlement(70)).toBe(7);
    expect(freeEntitlement(9)).toBe(0);
  });

  it("AAA names continue past the highest existing, never reusing", async () => {
    const { nextFreeNames } = await import("@/lib/free-entries");
    expect(nextFreeNames([], 2)).toEqual(["AAA #1", "AAA #2"]);
    expect(nextFreeNames(["AAA #1", "AAA #2"], 3)).toEqual(["AAA #3"]);
    // AAA #2 was voided out of the list; numbering still moves past AAA #3.
    expect(nextFreeNames(["AAA #1", "AAA #3"], 3)).toEqual(["AAA #4"]);
    expect(nextFreeNames(["AAA #1"], 1)).toEqual([]);
  });

  it("reads the pre-convention 'AAA n' form so it never restarts at 1", () => {
    // The seven live free entries went to Lynne as "AAA 1".."AAA 7" and were
    // converted to "AAA #1".."#7" in place. Crossing 80 recruited must mint
    // "AAA #8" — a reader blind to either form would mint a duplicate.
    return import("@/lib/free-entries").then(({ nextFreeNames }) => {
      const converted = Array.from({ length: 7 }, (_, i) => `AAA #${i + 1}`);
      expect(nextFreeNames(converted, 8)).toEqual(["AAA #8"]);
      const legacy = Array.from({ length: 7 }, (_, i) => `AAA ${i + 1}`);
      expect(nextFreeNames(legacy, 8)).toEqual(["AAA #8"]);
      // Mixed, mid-conversion: still continues past the highest.
      expect(nextFreeNames(["AAA 1", "AAA #2", "AAA 3"], 4)).toEqual([
        "AAA #4",
      ]);
    });
  });

  it("margin: worked example — 69 recruited, 13 at $30 tier, 6 free", async () => {
    const { computeMargin } = await import("@/lib/free-entries");
    // 3 owners x 2 entries + 1 owner x 3 + 1 x 4 = 13 spread-tier of 69.
    const live: { ownerId: string; isFreeEntry: boolean }[] = [];
    const add = (owner: string, n: number, free = false) => {
      for (let i = 0; i < n; i++)
        live.push({ ownerId: owner, isFreeEntry: free });
    };
    add("a", 2);
    add("b", 2);
    add("c", 2);
    add("d", 3);
    add("e", 4);
    add("big", 56); // 4+ tier
    add("me", 6, true);
    const m = computeMargin(live, 65000);
    expect(m.recruited).toBe(69);
    expect(m.freeCount).toBe(6);
    expect(m.totalEntries).toBe(75);
    expect(m.owedLynneCents).toBe(69 * 2500); // $1,725
    expect(m.spreadEntryCount).toBe(9);
    expect(m.spreadCents).toBe(9 * 500);
    expect(m.freeNotionalCents).toBe(6 * 2500); // $150
    expect(m.netCents).toBe(9 * 500 + 6 * 2500);
  });
});
