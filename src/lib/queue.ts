// The NEEDS ANTHONY queue: pure logic shared by /admin/queue.
//
// The hourly sweep finds things it may not act on by itself - a Venmo receipt
// at a tier amount, a pick in a reply, an owner asking for more entries - and
// stages each one as a pending_actions row through admin_stage_pending.
// Anthony resolves them at /admin/queue. Approve hands the row to
// admin_approve_pending, which applies it ONLY by calling an existing admin_*
// RPC chosen by kind; the CASE in the migration is the real dispatch, and
// KIND_DISPATCH below is the screen's copy of it so the Approve button can
// say what it is about to do. tests/unit/queue.test.ts holds the two together.

import { formatCents } from "@/lib/pool";

/** kind -> the existing RPC admin_approve_pending calls for it. A kind that
 *  is not here is recorded as approved and left for Anthony to apply by
 *  hand on the relevant admin screen (new_owner is deliberately absent: the
 *  duplicate-owner search lives on Quick add, not in a JSON payload). */
export const KIND_DISPATCH: Record<string, string> = {
  payment: "admin_record_payment",
  pick: "admin_submit_pick",
  entries: "admin_add_entries",
};

export function dispatchRpcFor(kind: string): string | null {
  return KIND_DISPATCH[kind] ?? null;
}

export function appliesAutomatically(kind: string): boolean {
  return dispatchRpcFor(kind) !== null;
}

const KIND_LABEL: Record<string, string> = {
  payment: "Payment",
  pick: "Pick",
  entries: "Entries",
  new_owner: "New owner",
  identity: "Identity",
};

export function kindLabel(kind: string): string {
  if (KIND_LABEL[kind]) return KIND_LABEL[kind];
  const words = kind.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Unknown";
}

const SUMMARY_MAX = 160;

type Payload = Record<string, unknown>;

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(str).filter((s): s is string => s !== null);
    return parts.length ? parts.join(", ") : null;
  }
  return JSON.stringify(v);
}

/** The first eight characters of a uuid, the way /admin/audit shows one. */
function shortId(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s) ? `${s.slice(0, 8)}…` : s;
}

function cap(s: string): string {
  if (s.length <= SUMMARY_MAX) return s;
  return `${s.slice(0, SUMMARY_MAX - 1)}…`;
}

/** One line describing a staged row, built only from what the payload
 *  carries. Nothing here reads the database: the summary is what Anthony sees
 *  BEFORE deciding, so it must say exactly what was staged, not what the app
 *  thinks it should have been. */
export function summarizePayload(kind: string, payload: Payload): string {
  const p = payload ?? {};
  let out: string;
  switch (kind) {
    case "payment": {
      const cents = typeof p.amount_cents === "number" ? p.amount_cents : null;
      const who =
        str(p.sender) ?? str(p.owner_name) ?? shortId(p.owner_id) ?? "unmatched";
      const parts = [
        `${cents === null ? "$?" : formatCents(cents)} from ${who}`,
        str(p.paid_on) ? `on ${str(p.paid_on)}` : null,
      ].filter((s): s is string => s !== null);
      const via = [str(p.method), str(p.venmo_txn_id)]
        .filter((s): s is string => s !== null)
        .join(" ");
      out = via ? `${parts.join(" ")}, ${via}` : parts.join(" ");
      break;
    }
    case "pick": {
      const entry = str(p.entry_name) ?? shortId(p.entry_id) ?? "unknown entry";
      out = `Week ${str(p.week) ?? "?"}: ${str(p.team) ?? "?"} for ${entry}`;
      break;
    }
    case "entries": {
      const names = Array.isArray(p.entry_names)
        ? p.entry_names.map(str).filter((s): s is string => s !== null)
        : [];
      const who = str(p.owner_name) ?? shortId(p.owner_id) ?? "unknown owner";
      const n = names.length;
      out = `${n} ${n === 1 ? "entry" : "entries"} for ${who}${
        n ? `: ${names.join(", ")}` : ""
      }`;
      break;
    }
    default: {
      out = Object.entries(p)
        .map(([k, v]) => {
          const s = str(v);
          return s === null ? null : `${k}: ${s}`;
        })
        .filter((s): s is string => s !== null)
        .join("; ");
    }
  }
  return cap(out.trim() === "" ? "(no detail)" : out);
}
