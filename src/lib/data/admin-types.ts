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
  isFreeEntry: boolean;
  voidedAt: string | null;
  pickCount: number;
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
    actor: string;
  }): Promise<void>;
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
