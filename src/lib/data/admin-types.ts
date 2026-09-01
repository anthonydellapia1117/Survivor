export interface AdminOwner {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  source: string;
  participationStatus: "confirmed" | "declined" | "pending";
  notes: string | null;
  entryCount: number;
  paidEntryCount: number;
  dueCents: number;
  paidCents: number;
}

export interface AdminEntry {
  id: string;
  ownerId: string;
  ownerName: string;
  entryIndex: number;
  entryName: string;
  nameIsDefault: boolean;
  lynneLabel: string | null;
  lynneNumber: number | null;
  isFreeEntry: boolean;
  voidedAt: string | null;
  pickCount: number;
  /** Owned by the pool runner — sorts first by default. */
  isAdminEntry: boolean;
  /** When this entry was last included in a roster sent to Lynne;
   *  null = she has not seen it yet (delta-export candidate). */
  submittedToLynneAt: string | null;
  /** The name Lynne's list carries for this entry. Differs from entryName
   *  exactly when the entry was renamed after it was submitted. */
  submittedAsName: string | null;
  /** When Lynne was told to drop this entry. Only meaningful once the entry
   *  is voided AND had been submitted — she holds it, we do not. Null there
   *  means the removal still owes to be sent. */
  removalCommunicatedAt: string | null;
}

export interface AdminPayment {
  id: string;
  ownerId: string | null;
  ownerName: string | null;
  amountCents: number;
  method: string;
  paidOn: string;
  venmoTxnId: string | null;
  note: string | null;
  correctsPaymentId: string | null;
  createdAt: string;
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  targetTable: string;
  targetId: string | null;
  note: string | null;
  /** The row as it stood before / after the write. Null for actions that
   *  record an event rather than a row change (exports, backups). The audit
   *  viewer diffs these; nothing else reads them. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface AdminBackend {
  listOwners(): Promise<AdminOwner[]>;
  listEntries(): Promise<AdminEntry[]>;
  listPayments(): Promise<AdminPayment[]>;
  auditTail(limit: number): Promise<AuditRow[]>;

  createOwner(args: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    source: string;
    notes: string;
    entryNames: string[];
    nameIsDefault: boolean;
    actor: string;
  }): Promise<string>;
  updateOwner(args: {
    ownerId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    participationStatus: string;
    notes: string;
    actor: string;
  }): Promise<void>;
  addEntries(args: {
    ownerId: string;
    entryNames: string[];
    nameIsDefault: boolean;
    isFree: boolean;
    actor: string;
  }): Promise<void>;
  updateEntry(args: {
    entryId: string;
    entryName: string;
    lynneLabel: string;
    isFree: boolean | null;
    lynneNumber: number | null;
    actor: string;
  }): Promise<void>;
  mergeOwner(args: {
    sourceId: string;
    targetId: string;
    actor: string;
  }): Promise<{
    deleted: boolean;
    entries_moved: number;
    payments_moved: number;
  }>;
  deleteOwner(args: { ownerId: string; actor: string }): Promise<void>;
  setGameScore(args: {
    gameId: string;
    homeScore: number | null;
    awayScore: number | null;
    status: "scheduled" | "in_progress" | "final";
    actor: string;
  }): Promise<number>;
  setGameReveal(args: {
    gameId: string;
    override: boolean | null;
    actor: string;
  }): Promise<void>;
  /** UNMASKED picks — the public v_grid_cells hides pre-kickoff picks;
   *  admin screens and exports need the real thing. */
  listGridCells(): Promise<import("./types").GridCell[]>;
  /** UNMASKED entry summaries (raw teams_used/bye_used). */
  listEntrySummaries(): Promise<import("./types").EntrySummary[]>;
  removeEntry(args: { entryId: string; actor: string }): Promise<void>;
  voidEntry(args: { entryId: string; actor: string }): Promise<void>;
  recordPayment(args: {
    ownerId: string | null;
    amountCents: number;
    method: string;
    paidOn: string;
    venmoTxnId: string;
    note: string;
    corrects: string | null;
    actor: string;
  }): Promise<string>;
  submitPick(args: {
    entryId: string;
    week: number;
    team: string;
    source: string;
    actor: string;
  }): Promise<string>;
  setResult(args: {
    entryId: string;
    week: number;
    result: string;
    resultSource: string;
    actor: string;
  }): Promise<void>;
  deadlineSweep(args: {
    week: number;
    commit: boolean;
    actor: string;
  }): Promise<SweepRow[]>;
  getConfig(): Promise<{
    tier13Cents: number;
    tier4PlusCents: number;
    lynneRateCents: number;
    freeEntryRatio: number;
    doubleElimThroughWeek: number;
    seasonStatus: string;
    timezone: string;
  }>;
  /** Every pick row, superseded included — the human-readable audit trail. */
  listAllPicks(): Promise<
    {
      entryId: string;
      week: number;
      team: string;
      submittedAt: string;
      source: string;
      late: boolean;
      result: string | null;
      isCurrent: boolean;
    }[]
  >;
  logAudit(args: {
    action: string;
    note: string;
    actor: string;
  }): Promise<void>;
  /** Stamp entries Lynne has never seen as submitted. Independent of
   *  renames: sending additions says nothing about corrections. */
  markNewEntriesSent(actor: string): Promise<number>;
  /** Re-record the name Lynne holds for entries whose corrections she has
   *  now been told. Independent of new sends. */
  markRenamesCommunicated(actor: string): Promise<number>;
  /** Stamp voided-but-already-submitted entries as pulled from Lynne's
   *  sheet. Independent of both sends and renames. */
  markRemovalsCommunicated(actor: string): Promise<number>;
  /** Lynne's whole-pool numbers for the public pool-pot card. Either value
   *  may be null (clears back to "pending"). The pot is entered directly —
   *  never derived from an unconfirmed per-entry formula. */
  setPoolPot(args: {
    entryCount: number | null;
    potCents: number | null;
    actor: string;
  }): Promise<void>;
  /** Full raw rows of one whitelisted table, for the data backup. */
  dumpTable(
    table: string,
    orderBy: string | null,
  ): Promise<Record<string, unknown>[]>;
  updateWeek(args: {
    week: number;
    earlyDeadlineAt: string;
    lateDeadlineAt: string;
    confirmed: boolean;
    actor: string;
  }): Promise<void>;
  importExists(sha256: string): Promise<boolean>;
  applyLynneImport(args: {
    week: number;
    filename: string;
    sha256: string;
    rows: unknown[];
    rowCount: number;
    matchedCount: number;
    unmatched: unknown[];
    variances: unknown[];
    applies: { entry_id: string; result: string }[];
    actor: string;
  }): Promise<string>;
}

export interface SweepRow {
  entryId: string;
  entryName: string;
  ownerName: string;
}
