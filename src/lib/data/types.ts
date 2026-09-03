// Shared shapes returned by every data backend. Mirrors the public read views.

export type EntryStatus = "active" | "at_risk" | "bye_eligible" | "eliminated";

export type PickResult =
  | "win"
  | "loss"
  | "tie_loss"
  | "bye"
  | "pending"
  | "missed";

export interface WeekRow {
  week: number;
  windowLabel: "thu_fri" | "sat_mon";
  /** The LATE boundary — when the whole week locks (reveal + sweep). */
  deadlineAt: string; // ISO timestamp
  /**
   * Thursday-game picks lock here (Wednesday noon ET), and the Wednesday and
   * Friday tiers derive from it — one day either side. See `pickDeadlineIso`.
   */
  earlyDeadlineAt: string;
  /** Sat-Mon-game picks lock here (Friday noon ET). Equals deadlineAt. */
  lateDeadlineAt: string;
  resultsFinal: boolean;
  /** Deadlines verified — schedule-derived or admin-confirmed. */
  confirmed: boolean;
}

export type GameDay =
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday"
  | "Monday";

export interface GameRow {
  id: string;
  week: number;
  kickoffAt: string; // ISO timestamp
  dayOfWeek: GameDay;
  awayTeam: string;
  homeTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: "scheduled" | "in_progress" | "final";
  /** Manual pick-visibility override: null = automatic (kickoff). */
  revealOverride: boolean | null;
  /** Broadcast network (CBS, FOX, NBC, ESPN, Prime, Netflix, Peacock…). */
  network: string | null;
}

/** Whether a game's picks are publicly visible right now (mirror of the
 *  SQL rule in pick_is_public — override wins, else kickoff passed). */
export function gameIsRevealed(
  g: Pick<GameRow, "revealOverride" | "kickoffAt">,
  now: Date = new Date(),
): boolean {
  return g.revealOverride ?? new Date(g.kickoffAt).getTime() <= now.getTime();
}

/** Sentinel team value the public views return for a not-yet-revealed pick. */
export const LOCKED_TEAM = "LOCKED";

export interface EntrySummary {
  id: string;
  entryName: string;
  nameIsDefault: boolean;
  /** ADMIN payloads only — the public view does not carry this flag,
   *  so nothing public can reconstruct the recruited-vs-free split. */
  isFreeEntry?: boolean;
  ownerId: string;
  ownerName: string;
  wins: number;
  losses: number;
  livesRemaining: number;
  status: EntryStatus;
  byeUsed: boolean;
  teamsUsed: string[];
  lastScoredWeek: number | null;
  /** The pool runner's own entry (free or paid) — sorts first by default. */
  isAdminEntry: boolean;
}

export interface GridCell {
  entryId: string;
  week: number;
  team: string;
  result: PickResult | null;
  late: boolean;
  submittedAt: string;
  source: string;
  resultSource: string | null;
}

export interface PotSummary {
  /** Every entry competing — the count the whole public surface agrees on.
   *  The recruited-vs-free split is a billing concept and is admin-only. */
  entryCount: number;
  /** Lynne's whole-pool numbers. Null until the runner enters what she sends;
   *  the pool pot is pool information and is public by design. THIS group's
   *  collected/due figures are deliberately absent from the public payload. */
  poolEntryCount: number | null;
  poolPotCents: number | null;
}

export interface EntryDetail {
  entry: EntrySummary;
  picks: GridCell[];
}

export interface LynneImportRow {
  id: string;
  week: number | null;
  filename: string;
  fileSha256: string;
  importedAt: string;
  rowCount: number | null;
  matchedCount: number | null;
  unmatched: unknown[] | null;
  variances: unknown[] | null;
  rows: unknown[] | null;
}

export interface DataBackend {
  getWeeks(): Promise<WeekRow[]>;
  /** The full 2026 regular-season schedule, ordered by week then kickoff. */
  getSchedule(): Promise<GameRow[]>;
  /** Lynne's final 2025 sheet — read-only archive, partial by her design. */
  getArchive2025(): Promise<{
    entries: Archive2025Entry[];
    weekly: Archive2025Weekly[];
  }>;
  getEntries(): Promise<EntrySummary[]>;
  getEntry(id: string): Promise<EntryDetail | null>;
  getGridCells(): Promise<GridCell[]>;
  getPot(): Promise<PotSummary>;
  getLynneImports(): Promise<LynneImportRow[]>;
}

export interface Archive2025Entry {
  lynneNumber: number;
  entryName: string;
  outcome: "winner" | "out";
  picks: (string | null)[];
}

export interface Archive2025Weekly {
  week: number;
  noLosses: number | null;
  lossBye: number | null;
  out: number | null;
}
