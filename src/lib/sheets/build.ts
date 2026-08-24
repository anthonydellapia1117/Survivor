// Builds every tab of the Sheets backup from app data. Pure and
// deterministic: same data + same timestamp => byte-identical specs,
// which is what makes the export idempotent.
//
// The Sheet is a GENERATED EXPORT — the app owns the data. Nothing here
// reads from a spreadsheet, and the sync layer clears-and-rewrites.

import type {
  EntrySummary,
  GridCell,
  LynneImportRow,
  WeekRow,
} from "@/lib/data/types";
import type { AdminOwner, AdminPayment } from "@/lib/data/admin-types";
import {
  freeEntriesEarned,
  lynneRemittanceCents,
} from "@/lib/pool";
import { STATUS_LABEL, STATUS_ORDER, SKIP_WEEK } from "@/lib/standing";
import { standingsBreakdown } from "@/lib/dashboard";
import { COLORS, type CellSpec, type TabSpec, type RgbColor } from "./types";

export interface PoolConfig {
  tier13Cents: number;
  tier4PlusCents: number;
  lynneRateCents: number;
  freeEntryRatio: number;
  doubleElimThroughWeek: number;
  seasonStatus: string;
  timezone: string;
}

export interface PickLogRow {
  entryName: string;
  week: number;
  team: string;
  submittedAt: string;
  source: string;
  late: boolean;
  result: string | null;
  superseded: boolean;
}

export interface SheetsInput {
  now: Date;
  entries: EntrySummary[];
  weeks: WeekRow[];
  cells: GridCell[];
  owners: AdminOwner[];
  payments: AdminPayment[];
  imports: LynneImportRow[];
  pickLog: PickLogRow[];
  config: PoolConfig;
}

const MONEY = "$#,##0";
const DATE_FMT = "ddd, mmm d";
const DATETIME_FMT = 'ddd, mmm d h:mm am/pm';

const STATUS_COLOR: Record<string, RgbColor> = {
  active: COLORS.win,
  at_risk: COLORS.tie,
  bye_eligible: COLORS.accentBlue,
  eliminated: COLORS.loss,
};

function banner(now: Date, cols: number): CellSpec[] {
  const row: CellSpec[] = [
    {
      v: `GENERATED FROM THE APP - ${now.toISOString()} - DO NOT EDIT. Edits here are overwritten on the next export.`,
      color: COLORS.muted,
      italic: true,
      fontSize: 9,
      overflow: true,
    },
  ];
  for (let i = 1; i < cols; i++) row.push({});
  return row;
}

function header(labels: string[], cols: number): CellSpec[] {
  const row: CellSpec[] = labels.map((v) => ({
    v,
    bold: true,
    color: COLORS.headerText,
    bg: COLORS.headerBg,
  }));
  while (row.length < cols) {
    row.push({ bg: COLORS.headerBg });
  }
  return row;
}

function band(i: number): RgbColor {
  return i % 2 === 0 ? COLORS.bandA : COLORS.bandB;
}

function pad(row: CellSpec[], cols: number, bg: RgbColor): CellSpec[] {
  while (row.length < cols) row.push({ bg });
  return row;
}

function sortedEntries(entries: EntrySummary[]): EntrySummary[] {
  return [...entries].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.ownerName.localeCompare(b.ownerName) ||
      a.entryName.localeCompare(b.entryName),
  );
}

function dotCell(
  name: string,
  status: EntrySummary["status"],
  bg: RgbColor,
): CellSpec {
  return {
    v: `● ${name}`,
    bg,
    runs: [
      { start: 0, color: STATUS_COLOR[status] },
      { start: 1, color: COLORS.text },
    ],
  };
}

// ---------------------------------------------------------------- Summary

export function buildSummary(input: SheetsInput): TabSpec {
  const { now, entries, weeks, owners, config } = input;
  const confirmed = owners.filter((o) => o.participationStatus === "confirmed");
  const due = confirmed.reduce((s, o) => s + o.dueCents, 0);
  const paid = confirmed.reduce((s, o) => s + o.paidCents, 0);
  const b = standingsBreakdown(entries);
  const nowMs = now.getTime();
  const nextWeek = weeks.find((w) => new Date(w.deadlineAt).getTime() > nowMs);
  const playWeek =
    [...weeks].reverse().find((w) => new Date(w.deadlineAt).getTime() <= nowMs)
      ?.week ?? weeks[0]?.week;
  const settledPaidEntries = confirmed
    .filter((o) => o.paidCents >= o.dueCents && o.dueCents > 0)
    .reduce((s, o) => s + o.paidEntryCount, 0);

  const cols = 4;
  const bar = (n: number, color: RgbColor): CellSpec => ({
    v: "█".repeat(Math.max(0, Math.round((n / Math.max(1, entries.length)) * 24))),
    color,
  });

  const rows: CellSpec[][] = [
    banner(now, cols),
    header(["2026 NFL Survivor Pool", "", "", ""], cols),
  ];
  const push = (
    label: string,
    value: CellSpec,
    extra: CellSpec = {},
    extra2: CellSpec = {},
  ) => {
    const bg = band(rows.length);
    rows.push(pad([{ v: label, color: COLORS.muted, bg }, { ...value, bg }, { ...extra, bg }, { ...extra2, bg }], cols, bg));
  };

  push("Pot collected", { v: paid / 100, numberFormat: MONEY, bold: true });
  push("Pot due", { v: due / 100, numberFormat: MONEY });
  push("Outstanding", {
    v: (due - paid) / 100,
    numberFormat: MONEY,
    color: due - paid > 0 ? COLORS.loss : COLORS.paidGreen,
  });
  push("Entries", { v: entries.length });
  push("Owners", { v: confirmed.length });
  push("", {});
  push("Active", { v: b.active }, bar(b.active, COLORS.win));
  push("At risk", { v: b.atRisk }, bar(b.atRisk, COLORS.tie));
  push("Bye eligible", { v: b.byeEligible }, bar(b.byeEligible, COLORS.accentBlue));
  push("Bye used", { v: b.byeUsed }, bar(b.byeUsed, COLORS.bye));
  push("Eliminated", { v: b.eliminated }, bar(b.eliminated, COLORS.loss));
  push("", {});
  push("Current week", { v: playWeek ?? "—" });
  push(
    "Next deadline",
    nextWeek
      ? {
          v: `W${nextWeek.week} — ${etString(nextWeek.deadlineAt)}`,
        }
      : { v: "season complete" },
  );
  push("Lynne remittance owed", {
    v: lynneRemittanceCents(entries.filter((e) => !e.isFreeEntry).length, {
      tier13Cents: config.tier13Cents,
      tier4PlusCents: config.tier4PlusCents,
      lynneRateCents: config.lynneRateCents,
      freeEntryRatio: config.freeEntryRatio,
    }) / 100,
    numberFormat: MONEY,
  });
  push("Free entries earned", {
    v: freeEntriesEarned(settledPaidEntries, {
      tier13Cents: config.tier13Cents,
      tier4PlusCents: config.tier4PlusCents,
      lynneRateCents: config.lynneRateCents,
      freeEntryRatio: config.freeEntryRatio,
    }),
  });
  push("Generated", { v: now.toISOString(), color: COLORS.muted });

  return {
    title: "Summary",
    tabColor: COLORS.accentBlue,
    rows,
    columnCount: cols,
    frozenRows: 2,
    frozenCols: 0,
    columnWidths: [190, 170, 200, 60],
    rowHeights: { banner: 24, header: 32, body: 24 },
    filterHeaderRow: null,
    dataRowCount: rows.length - 2,
  };
}

function etString(iso: string): string {
  return (
    new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " ET"
  );
}

// ------------------------------------------------------------------- Grid

export function buildGrid(input: SheetsInput): TabSpec {
  const { now, entries, weeks, cells } = input;
  const sorted = sortedEntries(entries);
  const cellMap = new Map(cells.map((c) => [`${c.entryId}:${c.week}`, c]));
  const cols = 1 + weeks.length;

  const rows: CellSpec[][] = [
    banner(now, cols),
    header(["Entry", ...weeks.map((w) => `W${w.week}`)], cols),
  ];
  // Center the week headers.
  for (let i = 1; i < cols; i++) rows[1][i].align = "CENTER";

  sorted.forEach((e, i) => {
    const bg = band(i);
    const row: CellSpec[] = [dotCell(e.entryName, e.status, bg)];
    for (const w of weeks) {
      const c = cellMap.get(`${e.id}:${w.week}`);
      row.push(gridCell(c, bg));
    }
    rows.push(row);
  });

  return {
    title: "Grid",
    tabColor: COLORS.accentBlue,
    rows,
    columnCount: cols,
    frozenRows: 2,
    frozenCols: 1,
    columnWidths: [170, ...weeks.map(() => 46)],
    rowHeights: { banner: 24, header: 32, body: 24 },
    filterHeaderRow: null,
    dataRowCount: sorted.length,
  };
}

function gridCell(c: GridCell | undefined, bandBg: RgbColor): CellSpec {
  if (!c) return { bg: bandBg };
  const base: CellSpec = { align: "CENTER", bold: true, fontSize: 9 };
  if (c.team === SKIP_WEEK) {
    return { ...base, v: "BYE", bg: COLORS.bye, color: COLORS.white };
  }
  switch (c.result) {
    case "win":
      return { ...base, v: c.team, bg: COLORS.win, color: COLORS.white };
    case "loss":
      return { ...base, v: c.team, bg: COLORS.loss, color: COLORS.white };
    case "tie_loss":
      return { ...base, v: c.team, bg: COLORS.tie, color: COLORS.white };
    case "bye":
      return { ...base, v: "BYE", bg: COLORS.bye, color: COLORS.white };
    case "missed":
      return {
        ...base,
        v: "MISS",
        bg: COLORS.missedBg,
        color: COLORS.missedText,
        strikethrough: true,
      };
    default:
      return { ...base, v: c.team, bg: COLORS.pendingBg, color: COLORS.muted, bold: false };
  }
}

// ---------------------------------------------------------------- Entries

export function buildEntries(input: SheetsInput): TabSpec {
  const { now, entries, weeks, cells } = input;
  const sorted = sortedEntries(entries);
  const nowMs = now.getTime();
  const currentWeek =
    weeks.find((w) => new Date(w.deadlineAt).getTime() > nowMs)?.week ??
    weeks.at(-1)?.week ??
    1;
  const current = new Map(
    cells.filter((c) => c.week === currentWeek).map((c) => [c.entryId, c.team]),
  );
  const cols = 10;
  const rows: CellSpec[][] = [
    banner(now, cols),
    header(
      [
        "Entry",
        "Owner",
        "Status",
        "Lives",
        "Wins",
        "Losses",
        "Weeks",
        "Current pick",
        "Teams used",
        "Free",
      ],
      cols,
    ),
  ];
  sorted.forEach((e, i) => {
    const bg = band(i);
    rows.push([
      dotCell(e.entryName, e.status, bg),
      { v: e.ownerName, bg, color: COLORS.muted },
      { v: STATUS_LABEL[e.status], bg, color: STATUS_COLOR[e.status], bold: true },
      { v: e.livesRemaining, bg },
      { v: e.wins, bg },
      { v: e.losses, bg },
      { v: e.lastScoredWeek ?? 0, bg },
      { v: current.get(e.id) ?? "", bg, align: "CENTER" },
      { v: e.teamsUsed.length, bg },
      { v: e.isFreeEntry ? "FREE" : "", bg, color: COLORS.accentBlue },
    ]);
  });
  return {
    title: "Entries",
    tabColor: COLORS.neutralTab,
    rows,
    columnCount: cols,
    frozenRows: 2,
    frozenCols: 1,
    columnWidths: [170, 140, 105, 55, 55, 60, 60, 100, 90, 55],
    rowHeights: { banner: 24, header: 32, body: 24 },
    filterHeaderRow: 1,
    dataRowCount: sorted.length,
  };
}

// ----------------------------------------------------------------- Owners

export function buildOwners(input: SheetsInput): TabSpec {
  const { now, owners } = input;
  const confirmed = owners
    .filter((o) => o.participationStatus === "confirmed")
    .sort((a, b) => a.lastName.localeCompare(b.lastName));
  const cols = 6;
  const rows: CellSpec[][] = [
    banner(now, cols),
    header(["Owner", "Entries", "Due", "Paid", "Balance", "Status"], cols),
  ];
  confirmed.forEach((o, i) => {
    const bg = band(i);
    const bal = o.dueCents - o.paidCents;
    const balColor =
      bal <= 0 ? COLORS.paidGreen : o.paidCents > 0 ? COLORS.partial : COLORS.loss;
    rows.push([
      { v: `${o.firstName} ${o.lastName}`, bg },
      { v: o.entryCount, bg },
      { v: o.dueCents / 100, numberFormat: MONEY, bg },
      { v: o.paidCents / 100, numberFormat: MONEY, bg },
      { v: bal / 100, numberFormat: MONEY, bg, color: balColor, bold: true },
      {
        v: bal <= 0 ? "PAID" : o.paidCents > 0 ? "PARTIAL" : "UNPAID",
        bg,
        color: balColor,
        bold: true,
      },
    ]);
  });
  const due = confirmed.reduce((s, o) => s + o.dueCents, 0);
  const paid = confirmed.reduce((s, o) => s + o.paidCents, 0);
  rows.push([
    { v: "TOTAL", bold: true, borderTop: true },
    { v: confirmed.reduce((s, o) => s + o.entryCount, 0), bold: true, borderTop: true },
    { v: due / 100, numberFormat: MONEY, bold: true, borderTop: true },
    { v: paid / 100, numberFormat: MONEY, bold: true, borderTop: true },
    { v: (due - paid) / 100, numberFormat: MONEY, bold: true, borderTop: true },
    { borderTop: true },
  ]);
  return {
    title: "Owners",
    tabColor: COLORS.neutralTab,
    rows,
    columnCount: cols,
    frozenRows: 2,
    frozenCols: 0,
    columnWidths: [180, 70, 90, 90, 95, 90],
    rowHeights: { banner: 24, header: 32, body: 24 },
    filterHeaderRow: 1,
    dataRowCount: confirmed.length,
  };
}

// --------------------------------------------------------------- Payments

export function buildPayments(input: SheetsInput): TabSpec {
  const { now, payments } = input;
  const chrono = [...payments].sort(
    (a, b) =>
      a.paidOn.localeCompare(b.paidOn) || a.createdAt.localeCompare(b.createdAt),
  );
  const cols = 7;
  const rows: CellSpec[][] = [
    banner(now, cols),
    header(
      ["Payment ID", "Owner", "Amount", "Method", "Date", "Venmo txn", "Note / corrects"],
      cols,
    ),
  ];
  chrono.forEach((p, i) => {
    const isCorrection = p.correctsPaymentId !== null || p.method === "correction";
    const bg = isCorrection ? COLORS.correctionBg : band(i);
    const note = [
      p.note ?? "",
      p.correctsPaymentId ? `corrects ${p.correctsPaymentId.slice(0, 8)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    rows.push([
      { v: p.id.slice(0, 8), bg, color: COLORS.muted, fontSize: 9 },
      { v: p.ownerName ?? "UNMATCHED", bg, color: p.ownerName ? COLORS.text : COLORS.tie },
      {
        v: p.amountCents / 100,
        numberFormat: MONEY,
        bg,
        color: p.amountCents < 0 ? COLORS.loss : COLORS.text,
      },
      { v: p.method, bg },
      { v: p.paidOn.slice(0, 10), bg, numberFormat: DATE_FMT },
      { v: p.venmoTxnId ?? "", bg, fontSize: 9, color: COLORS.muted },
      { v: note, bg, fontSize: 9 },
    ]);
  });
  // Net (matched to an owner) must equal the Summary tab's collected figure.
  const net = chrono
    .filter((p) => p.ownerId !== null)
    .reduce((s, p) => s + p.amountCents, 0);
  rows.push([
    { v: "NET (matched)", bold: true, borderTop: true },
    { borderTop: true },
    { v: net / 100, numberFormat: MONEY, bold: true, borderTop: true },
    { borderTop: true },
    { borderTop: true },
    { borderTop: true },
    { v: "must equal Summary · Pot collected", color: COLORS.muted, fontSize: 9, borderTop: true },
  ]);
  return {
    title: "Payments",
    tabColor: COLORS.neutralTab,
    rows,
    columnCount: cols,
    frozenRows: 2,
    frozenCols: 0,
    columnWidths: [90, 150, 85, 85, 100, 170, 220],
    rowHeights: { banner: 24, header: 32, body: 24 },
    filterHeaderRow: 1,
    dataRowCount: chrono.length,
  };
}

/** The figure the Payments net must reconcile to. Exported for tests. */
export function collectedCents(owners: AdminOwner[]): number {
  return owners
    .filter((o) => o.participationStatus === "confirmed")
    .reduce((s, o) => s + o.paidCents, 0);
}

// ------------------------------------------------------------------ Picks

export function buildPicks(input: SheetsInput): TabSpec {
  const { now, pickLog } = input;
  const cols = 8;
  const rows: CellSpec[][] = [
    banner(now, cols),
    header(
      ["Entry", "Week", "Team", "Submitted", "Source", "Late", "Result", "Superseded"],
      cols,
    ),
  ];
  pickLog.forEach((p, i) => {
    const bg = band(i);
    rows.push([
      { v: p.entryName, bg, color: p.superseded ? COLORS.muted : COLORS.text },
      { v: p.week, bg },
      { v: p.team === SKIP_WEEK ? "BYE" : p.team, bg, align: "CENTER" },
      { v: p.submittedAt, bg, numberFormat: DATETIME_FMT, fontSize: 9 },
      { v: p.source, bg, color: COLORS.muted },
      { v: p.late ? "LATE" : "", bg, color: COLORS.tie, bold: p.late },
      { v: p.result ?? "pending", bg },
      { v: p.superseded ? "superseded" : "", bg, color: COLORS.muted, italic: true },
    ]);
  });
  if (pickLog.length === 0) {
    // A tab whose only rows are the frozen banner+header is rejected by the
    // Sheets API ("can't freeze all visible rows").
    rows.push(
      pad([{ v: "No picks recorded yet", color: COLORS.muted }], cols, COLORS.bandA),
    );
  }
  return {
    title: "Picks",
    tabColor: COLORS.neutralTab,
    rows,
    columnCount: cols,
    frozenRows: 2,
    frozenCols: 0,
    columnWidths: [170, 55, 60, 160, 100, 55, 85, 100],
    rowHeights: { banner: 24, header: 32, body: 24 },
    filterHeaderRow: 1,
    dataRowCount: pickLog.length,
  };
}

// ------------------------------------------------------------------ Lynne

export function buildLynne(input: SheetsInput): TabSpec {
  const { now, imports } = input;
  const cols = 6;
  const rows: CellSpec[][] = [
    banner(now, cols),
    header(
      ["MASTER POOL (Lynne) — her data, as received", "", "", "", "", ""],
      cols,
    ),
  ];
  // Most recent import per week.
  const latestByWeek = new Map<number, LynneImportRow>();
  for (const im of imports) {
    const wk = im.week ?? 0;
    const prev = latestByWeek.get(wk);
    if (!prev || im.importedAt > prev.importedAt) latestByWeek.set(wk, im);
  }
  const ordered = [...latestByWeek.values()].sort(
    (a, b) => (a.week ?? 0) - (b.week ?? 0),
  );

  let bandI = 0;
  const sub = (labels: string[]) => {
    rows.push(
      labels.map((v) => ({
        v,
        bold: true,
        fontSize: 9,
        color: COLORS.muted,
        bg: COLORS.bandB,
      })),
    );
  };

  sub(["Week", "Filename", "Imported", "Rows", "Matched", "Unmatched"]);
  for (const im of ordered) {
    const bg = band(bandI++);
    rows.push([
      { v: im.week ?? "", bg },
      { v: im.filename, bg },
      { v: im.importedAt, bg, numberFormat: DATETIME_FMT, fontSize: 9 },
      { v: im.rowCount ?? 0, bg },
      { v: im.matchedCount ?? 0, bg, color: COLORS.paidGreen },
      { v: (im.unmatched ?? []).length, bg, color: (im.unmatched ?? []).length > 0 ? COLORS.loss : COLORS.muted },
    ]);
  }
  if (ordered.length === 0) {
    rows.push(pad([{ v: "No imports yet", color: COLORS.muted }], cols, COLORS.bandA));
  }

  rows.push(pad([{}], cols, COLORS.bandA));
  rows.push(
    pad(
      [{ v: "VARIANCES — local record vs. her file, unresolved", bold: true, color: COLORS.tie }],
      cols,
      COLORS.bandA,
    ),
  );
  sub(["Week", "Entry", "Type", "Local", "Lynne", ""]);

  interface V {
    type?: string;
    entryName?: string;
    lynne?: { team?: string | null; result?: string | null };
    local?: { team?: string | null; result?: string | null };
  }
  let vcount = 0;
  bandI = 0;
  for (const im of ordered) {
    for (const v of (im.variances ?? []) as V[]) {
      const bg = band(bandI++);
      const fmt = (x?: { team?: string | null; result?: string | null }) =>
        x ? [x.team ?? "no pick", x.result ?? ""].filter(Boolean).join(" · ") : "—";
      rows.push([
        { v: im.week ?? "", bg },
        { v: v.entryName ?? "?", bg },
        { v: (v.type ?? "").replaceAll("_", " "), bg, color: COLORS.tie },
        { v: fmt(v.local), bg },
        { v: fmt(v.lynne), bg },
        { bg },
      ]);
      vcount++;
    }
  }
  if (vcount === 0) {
    rows.push(
      pad(
        [{ v: "No open variances", color: COLORS.paidGreen }],
        cols,
        COLORS.bandA,
      ),
    );
  }

  return {
    title: "Lynne",
    tabColor: COLORS.amber,
    rows,
    columnCount: cols,
    frozenRows: 2,
    frozenCols: 0,
    columnWidths: [55, 220, 150, 60, 75, 90],
    rowHeights: { banner: 24, header: 32, body: 24 },
    filterHeaderRow: null,
    dataRowCount: ordered.length + vcount,
  };
}

// ----------------------------------------------------------------- Config

export function buildConfig(input: SheetsInput): TabSpec {
  const { now, weeks, config } = input;
  const cols = 3;
  const rows: CellSpec[][] = [
    banner(now, cols),
    header(["Rule", "Value", ""], cols),
  ];
  const push = (label: string, value: string | number, fmt?: string) => {
    const bg = band(rows.length);
    rows.push(
      pad(
        [
          { v: label, color: COLORS.muted, bg },
          { v: value, bg, numberFormat: fmt },
        ],
        cols,
        bg,
      ),
    );
  };
  push("Entries 1-3, price each", config.tier13Cents / 100, MONEY);
  push("Entries 4+, price each (all entries)", config.tier4PlusCents / 100, MONEY);
  push("Lynne remittance per entry", config.lynneRateCents / 100, MONEY);
  push("Free entry per N paid entries", config.freeEntryRatio);
  push("Double elimination through week", config.doubleElimThroughWeek);
  push("Week 8+", "single elimination — any loss is out");
  push("Tie", "always a loss");
  push("Missed pick", "automatic loss at the deadline");
  push("Season status", config.seasonStatus);
  push("Timezone", config.timezone);
  push("", "");
  const bg2 = COLORS.bandB;
  rows.push(
    pad(
      [{ v: "PICK DEADLINES", bold: true, bg: bg2 }],
      cols,
      bg2,
    ),
  );
  for (const w of weeks) {
    const bg = band(rows.length);
    rows.push(
      pad(
        [
          { v: `Week ${w.week}`, color: COLORS.muted, bg },
          { v: etString(w.deadlineAt), bg },
          { v: w.resultsFinal ? "final" : "", bg, color: COLORS.paidGreen },
        ],
        cols,
        bg,
      ),
    );
  }
  return {
    title: "Config",
    tabColor: COLORS.darkTab,
    rows,
    columnCount: cols,
    frozenRows: 2,
    frozenCols: 0,
    columnWidths: [240, 260, 70],
    rowHeights: { banner: 24, header: 32, body: 24 },
    filterHeaderRow: null,
    dataRowCount: rows.length - 2,
  };
}

// ------------------------------------------------------------------ Split

export interface Workbooks {
  /** Link-viewable sheet: no contact or payment data anywhere. */
  public: TabSpec[];
  /** Private sheet: Owners + Payments, admin eyes only. */
  private: TabSpec[];
}

export function buildAllTabs(input: SheetsInput): Workbooks {
  return {
    public: [
      buildSummary(input),
      buildGrid(input),
      buildEntries(input),
      buildPicks(input),
      buildLynne(input),
      buildConfig(input),
    ],
    private: [buildOwners(input), buildPayments(input)],
  };
}
