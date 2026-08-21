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
  deadlineAt: string; // ISO timestamp
  resultsFinal: boolean;
}

export interface EntrySummary {
  id: string;
  entryName: string;
  nameIsDefault: boolean;
  isFreeEntry: boolean;
  ownerId: string;
  ownerName: string;
  wins: number;
  losses: number;
  livesRemaining: number;
  status: EntryStatus;
  byeUsed: boolean;
  teamsUsed: string[];
  lastScoredWeek: number | null;
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
  dueCents: number;
  paidCents: number;
  entryCount: number;
}

export interface EntryDetail {
  entry: EntrySummary;
  picks: GridCell[];
}

export interface DataBackend {
  getWeeks(): Promise<WeekRow[]>;
  getEntries(): Promise<EntrySummary[]>;
  getEntry(id: string): Promise<EntryDetail | null>;
  getGridCells(): Promise<GridCell[]>;
  getPot(): Promise<PotSummary>;
}
