// Turning audit rows into something a person can read.
//
// The raw table is honest but unreadable: every update_* row dumps the WHOLE
// database row into both `before` and `after`, so a one-word rename arrives
// as two 11-field JSON blobs that look identical at a glance. The useful
// question is always "what actually changed", so that is what this computes.
// Nothing is hidden — the viewer keeps a raw-JSON toggle — but the default
// reading is the diff.

import { formatCents } from "@/lib/pool";
import { formatEtDateTime } from "@/lib/format";

export type AuditPayload = Record<string, unknown> | null | undefined;

/** Pure row metadata. It changes on every write and tells you nothing. */
export const DIFF_NOISE_KEYS = new Set(["id", "created_at", "updated_at"]);

/** Human names for the actions this app writes. Unknown actions fall back
 *  to humanizeKey, so a new RPC is readable the day it ships. */
export const ACTION_LABEL: Record<string, string> = {
  seed_roster: "Roster seeded",
  create_owner: "Owner created",
  update_owner: "Owner updated",
  delete_owner: "Owner deleted",
  merge_owner: "Owners merged",
  add_entries: "Entries added",
  update_entry: "Entry updated",
  remove_entry: "Entry removed",
  void_entry: "Entry voided",
  name_spacing_override: "Name spacing override",
  record_payment: "Payment recorded",
  payment_sweep_exclude: "Payment sweep resolution",
  submit_pick: "Pick submitted",
  set_result: "Result set",
  deadline_sweep: "Deadline sweep",
  set_game_score: "Game score set",
  set_game_reveal: "Game reveal override",
  update_week: "Week updated",
  apply_lynne_import: "Lynne import applied",
  bulk_set_lynne_numbers: "Lynne numbers imported",
  mark_roster_sent: "Roster marked current",
  mark_new_entries_sent: "New entries marked sent",
  mark_renames_communicated: "Renames marked communicated",
  set_pool_pot: "Pool pot set",
  data_backup: "Data backup",
  sheets_export: "Sheets export",
  admin_password_change: "Admin password changed",
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? humanizeKey(action);
}

/** Field names that read better than their column names. */
const KEY_LABEL: Record<string, string> = {
  amount_cents: "Amount",
  entry_name: "Entry name",
  entry_index: "Entry #",
  name_is_default: "Default name",
  is_free_entry: "Free entry",
  is_free: "Free entry",
  lynne_number: "Lynne number",
  lynne_label: "Lynne label",
  submitted_to_lynne_at: "Sent to Lynne",
  submitted_as_name: "Name Lynne has",
  voided_at: "Voided",
  deleted_at: "Deleted",
  merged_into_owner_id: "Merged into",
  participation_status: "Status",
  owner_id: "Owner",
  entry_id: "Entry",
  venmo_txn_id: "Venmo txn",
  txn_ids: "Transaction IDs",
  paid_on: "Paid on",
  corrects: "Corrects payment",
  source_ref: "Source ref",
  pool_entry_count: "Pool entries",
  pool_pot_cents: "Pool pot",
  result_source: "Result source",
};

/** snake_case -> readable words, with the pool's proper nouns preserved. */
export function humanizeKey(key: string): string {
  if (KEY_LABEL[key]) return KEY_LABEL[key];
  const words = key
    .replace(/_cents$/, "")
    .split("_")
    .filter((w) => w.length > 0);
  if (words.length === 0) return key;
  const out = words.map((w, i) => {
    if (w === "lynne") return "Lynne";
    if (w === "id" || w === "ids") return i === 0 ? "ID" : "ID";
    if (w === "at" && i === words.length - 1) return "";
    return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  });
  return out.join(" ").replace(/\s+/g, " ").trim();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T|\s)\d{2}:\d{2}/;

/** One value, formatted for a person: money as money, timestamps in ET,
 *  nulls as an em dash, uuids shortened (the raw toggle keeps the full one). */
export function formatAuditValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return key.endsWith("_cents") ? formatCents(value) : String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.map((v) => formatAuditValue(key, v)).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  const s = String(value);
  if (UUID_RE.test(s)) return `${s.slice(0, 8)}…`;
  if (ISO_RE.test(s)) {
    try {
      return formatEtDateTime(s);
    } catch {
      return s;
    }
  }
  return s;
}

export interface AuditChange {
  key: string;
  label: string;
  kind: "changed" | "set" | "cleared";
  from: string;
  to: string;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * What actually changed between the two payloads.
 * - both present  -> only the fields whose values differ
 * - after only    -> every field, as "set" (a create/record row)
 * - before only   -> every field, as "cleared" (a delete/remove row)
 * Metadata keys (id, created_at, updated_at) never appear.
 */
export function diffPayloads(
  before: AuditPayload,
  after: AuditPayload,
): AuditChange[] {
  const b = before ?? null;
  const a = after ?? null;
  if (!b && !a) return [];

  const keys = [
    ...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})]),
  ].filter((k) => !DIFF_NOISE_KEYS.has(k));
  keys.sort();

  const out: AuditChange[] = [];
  for (const key of keys) {
    const bv = b ? b[key] : undefined;
    const av = a ? a[key] : undefined;
    if (b && a && sameValue(bv, av)) continue;
    const kind: AuditChange["kind"] = !b ? "set" : !a ? "cleared" : "changed";
    out.push({
      key,
      label: humanizeKey(key),
      kind,
      from: formatAuditValue(key, bv),
      to: formatAuditValue(key, av),
    });
  }
  return out;
}

/** Compact one-line description of a row's payload, for the table cell. */
export function summarizeChanges(changes: AuditChange[]): string {
  if (changes.length === 0) return "";
  return changes
    .map((c) =>
      c.kind === "changed"
        ? `${c.label}: ${c.from} → ${c.to}`
        : c.kind === "set"
          ? `${c.label}: ${c.to}`
          : `${c.label}: ${c.from}`,
    )
    .join(" · ");
}

/** Everything about a row that free-text search should match. */
export function auditSearchText(row: {
  actor: string;
  action: string;
  targetTable: string;
  targetId: string | null;
  note: string | null;
  before?: AuditPayload;
  after?: AuditPayload;
}): string {
  return [
    row.actor,
    row.action,
    actionLabel(row.action),
    row.targetTable,
    row.targetId ?? "",
    row.note ?? "",
    summarizeChanges(diffPayloads(row.before, row.after)),
    JSON.stringify(row.before ?? {}),
    JSON.stringify(row.after ?? {}),
  ]
    .join(" ")
    .toLowerCase();
}
