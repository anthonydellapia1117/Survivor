import { describe, expect, it } from "vitest";
import {
  buildAllTabs,
  buildOwners,
  buildPayments,
  buildSummary,
  collectedCents,
  type SheetsInput,
} from "@/lib/sheets/build";
import type { EntrySummary, GridCell } from "@/lib/data/types";
import type { AdminOwner, AdminPayment } from "@/lib/data/admin-types";

const NOW = new Date("2026-08-21T21:00:00.000Z");

function entry(
  id: string,
  name: string,
  status: EntrySummary["status"] = "active",
): EntrySummary {
  return {
    id,
    entryName: name,
    nameIsDefault: false,
    isFreeEntry: false,
    ownerId: "o1",
    ownerName: "Some Owner",
    wins: 2,
    losses: 0,
    livesRemaining: 2,
    status,
    byeUsed: false,
    teamsUsed: ["KC", "BUF"],
    lastScoredWeek: 2,
  };
}

function owner(
  last: string,
  entryCount: number,
  dueCents: number,
  paidCents: number,
): AdminOwner {
  return {
    id: `o-${last}`,
    firstName: "F",
    lastName: last,
    email: null,
    phone: null,
    source: "import",
    participationStatus: "confirmed",
    notes: null,
    entryCount,
    paidEntryCount: entryCount,
    dueCents,
    paidCents,
  };
}

function payment(
  id: string,
  ownerId: string | null,
  amountCents: number,
  corrects: string | null = null,
): AdminPayment {
  return {
    id,
    ownerId,
    ownerName: ownerId ? "F Owner" : null,
    amountCents,
    method: corrects ? "correction" : "venmo",
    paidOn: "2026-08-14",
    venmoTxnId: null,
    note: null,
    correctsPaymentId: corrects,
    createdAt: "2026-08-14T12:00:00Z",
  };
}

function cell(entryId: string, week: number, team: string, result: GridCell["result"]): GridCell {
  return {
    entryId,
    week,
    team,
    result,
    late: false,
    submittedAt: "2026-09-01T00:00:00Z",
    source: "admin",
    resultSource: null,
  };
}

function baseInput(): SheetsInput {
  return {
    now: NOW,
    entries: [
      entry("e1", "Tommybrads1"),
      entry("e2", "tommybrads2"),
      entry("e3", "ReRe #1", "eliminated"),
    ],
    weeks: Array.from({ length: 18 }, (_, i) => ({
      week: i + 1,
      windowLabel: "thu_fri" as const,
      deadlineAt: `2026-09-${String(8 + i).padStart(2, "0")}T16:00:00Z`,
      resultsFinal: false,
      confirmed: true,
    })),
    cells: [cell("e1", 1, "KC", "win"), cell("e2", 1, "BUF", "loss"), cell("e3", 2, "SKIP_WEEK", "bye")],
    owners: [owner("Alpha", 4, 10000, 10000), owner("Beta", 2, 6000, 0)],
    payments: [
      payment("p1", "o-Alpha", 10000),
      payment("p2", "o-Alpha", 3000),
      payment("p3", "o-Alpha", -3000, "p2"),
      payment("p4", null, 5000), // unmatched: quarantined, counts nowhere
    ],
    imports: [],
    pickLog: [
      {
        entryName: "tommybrads2",
        week: 1,
        team: "BUF",
        submittedAt: "2026-09-01T00:00:00Z",
        source: "admin",
        late: false,
        result: "loss",
        superseded: false,
      },
    ],
    config: {
      tier13Cents: 3000,
      tier4PlusCents: 2500,
      lynneRateCents: 2500,
      freeEntryRatio: 10,
      doubleElimThroughWeek: 7,
      seasonStatus: "open",
      timezone: "America/New_York",
    },
  };
}

describe("tab structure", () => {
  it("public workbook has exactly the public tabs in order; private holds Owners+Payments", () => {
    const wb = buildAllTabs(baseInput());
    expect(wb.public.map((t) => t.title)).toEqual([
      "Summary",
      "Grid",
      "Entries",
      "Picks",
      "Lynne",
      "Config",
    ]);
    expect(wb.private.map((t) => t.title)).toEqual(["Owners", "Payments"]);
  });

  it("every tab starts with the DO-NOT-EDIT banner carrying the ISO timestamp", () => {
    const wb = buildAllTabs(baseInput());
    for (const t of [...wb.public, ...wb.private]) {
      const a1 = t.rows[0][0];
      expect(String(a1.v)).toContain("GENERATED FROM THE APP");
      expect(String(a1.v)).toContain(NOW.toISOString());
      expect(String(a1.v)).toContain("DO NOT EDIT");
      expect(a1.overflow).toBe(true); // unmerged, spills over empty neighbors
    }
  });

  it("no public tab contains payment amounts, emails, or venmo ids", () => {
    const wb = buildAllTabs(baseInput());
    const text = JSON.stringify(wb.public);
    expect(text).not.toContain("UNMATCHED");
    expect(text).not.toContain("venmo");
    expect(text).not.toContain("@");
    // Summary's aggregates are the only money on the public side.
    const entriesTab = wb.public.find((t) => t.title === "Entries")!;
    expect(JSON.stringify(entriesTab)).not.toContain("$#,##0");
  });
});

describe("names are verbatim", () => {
  it("tommybrads2 stays lowercase in Grid, Entries, and Picks", () => {
    const wb = buildAllTabs(baseInput());
    for (const title of ["Grid", "Entries"]) {
      const t = wb.public.find((x) => x.title === title)!;
      const values = t.rows.flat().map((c) => String(c.v ?? ""));
      expect(values.some((v) => v.includes("tommybrads2"))).toBe(true);
      expect(values.some((v) => v.includes("Tommybrads2"))).toBe(false);
    }
    const picks = wb.public.find((x) => x.title === "Picks")!;
    expect(JSON.stringify(picks)).toContain("tommybrads2");
  });
});

describe("money reconciliation", () => {
  it("Payments net (matched only) equals Summary's collected figure", () => {
    const input = baseInput();
    const payments = buildPayments(input);
    const netRow = payments.rows.at(-1)!;
    const net = netRow[2].v as number;

    const summary = buildSummary(input);
    const collectedRow = summary.rows.find((r) => r[0].v === "Pot collected")!;
    expect(net).toBe(collectedRow[1].v);
    expect(net * 100).toBe(collectedCents(input.owners));
    // The unmatched $50 is quarantined: in the ledger, not in the net.
    expect(net).toBe(100); // 100 + 30 - 30
  });

  it("Owners totals row sums due/paid with a top border", () => {
    const owners = buildOwners(baseInput());
    const total = owners.rows.at(-1)!;
    expect(total[0].v).toBe("TOTAL");
    expect(total[0].borderTop).toBe(true);
    expect(total[2].v).toBe(160); // $100 + $60
    expect(total[3].v).toBe(100);
  });
});

describe("grid cells", () => {
  it("colors by result and renders byes as BYE", () => {
    const wb = buildAllTabs(baseInput());
    const grid = wb.public.find((t) => t.title === "Grid")!;
    const flat = grid.rows.flat();
    const kc = flat.find((c) => c.v === "KC")!;
    const buf = flat.find((c) => c.v === "BUF")!;
    expect(kc.bg).toEqual({ red: 0x10 / 255, green: 0xb9 / 255, blue: 0x81 / 255 });
    expect(buf.bg).toEqual({ red: 0xef / 255, green: 0x44 / 255, blue: 0x44 / 255 });
    expect(flat.some((c) => c.v === "BYE")).toBe(true);
    expect(grid.frozenCols).toBe(1);
    expect(grid.frozenRows).toBe(2);
    expect(grid.columnCount).toBe(19);
  });
});

describe("idempotency", () => {
  it("same data + same timestamp produces identical specs", () => {
    const a = buildAllTabs(baseInput());
    const b = buildAllTabs(baseInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
