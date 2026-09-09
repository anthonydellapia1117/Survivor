// Who the week reminder goes to, and the gate on how many. Derived from the
// live roster every run, never from a saved list: every confirmed owner's
// address on a live entry and every player_email on a live entry, lowercased,
// once each, the admin's own included when it is one of them. Pure.

import { confirmedOwners } from "../../lib/roster";
import type { EntryRow, OwnerRow } from "../../lib/db";

export function reminderAddresses(owners: OwnerRow[], entries: EntryRow[]): string[] {
  const confirmed = confirmedOwners(owners);
  const confirmedIds = new Set(confirmed.map((o) => o.id));
  const live = entries.filter((e) => e.voided_at === null && confirmedIds.has(e.owner_id));
  const ownersWithLive = new Set(live.map((e) => e.owner_id));
  const seen = new Set<string>();
  const add = (a: string | null) => {
    const key = (a ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
  };
  for (const o of confirmed) if (ownersWithLive.has(o.id)) add(o.email);
  for (const e of live) add(e.player_email);
  return [...seen].sort();
}

export interface CountGate {
  ok: boolean;
  expected: number;
  actual: number;
  /** actual - expected. */
  delta: number;
  /** The arithmetic and the full list, for printing when it does not add up. */
  lines: string[];
}

/**
 * Exactly the expected number, or stop. Not a range: a range is how a wrong
 * count got through once. On a mismatch the whole list is printed so the
 * extra or missing address can be found by eye, and nothing is drafted or
 * sent until it is.
 */
export function countGate(expected: number, addresses: string[]): CountGate {
  const actual = addresses.length;
  const delta = actual - expected;
  const ok = delta === 0;
  const lines = [
    `expected recipients: ${expected}`,
    `derived from the live roster: ${actual}`,
    `delta: ${delta > 0 ? "+" : ""}${delta}`,
  ];
  if (!ok) lines.push("", ...addresses.map((a, i) => `${String(i + 1).padStart(3)}  ${a}`));
  return { ok, expected, actual, delta, lines };
}
