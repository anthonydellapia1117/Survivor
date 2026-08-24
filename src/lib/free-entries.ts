// The free-entry rule, in the pool runner's words:
//
//   Recruited entries — what other people buy. Every one is paid for.
//   My free entries — mine only, earned FLOOR(recruited / 10). They cost
//   nobody anything and they never count toward earning more.
//   Total = recruited + free. Lynne numbers the total; remittance covers
//   ONLY recruited (recruited x $25).
//
// If the runner ever buys an entry and pays for it, it counts as
// recruited for both the earning math and the remittance — only entries
// flagged is_free_entry are excluded. Free entries are named "AAA n" and
// belong to the runner's participant owner row.
//
// MARGIN MATH LIVES HERE AND ON /admin ONLY — never in a public view,
// public component, or player-reachable export.

import { DEFAULT_PRICING, type PricingConfig } from "@/lib/pool";

export const FREE_ENTRY_OWNER_EMAIL = "anthonydellapia@gmail.com";
export const FREE_ENTRY_NAME_PREFIX = "AAA ";

const AAA = /^AAA (\d+)$/;

/** FLOOR(recruited / ratio). Free entries never earn more free entries. */
export function freeEntitlement(
  recruited: number,
  ratio: number = DEFAULT_PRICING.freeEntryRatio,
): number {
  return Math.floor(Math.max(0, recruited) / Math.max(1, ratio));
}

/**
 * Names for the free entries still owed: continues past the highest
 * existing "AAA n" (never reuses a number, even after a void).
 */
export function nextFreeNames(
  existingFreeNames: string[],
  entitlement: number,
): string[] {
  const count = existingFreeNames.length;
  if (count >= entitlement) return [];
  let maxN = 0;
  for (const name of existingFreeNames) {
    const m = AAA.exec(name);
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  return Array.from(
    { length: entitlement - count },
    (_, i) => `${FREE_ENTRY_NAME_PREFIX}${maxN + i + 1}`,
  );
}

export interface MarginReport {
  recruited: number;
  freeCount: number;
  totalEntries: number;
  collectedCents: number;
  owedLynneCents: number;
  /** Entries billed at the 1-3 tier — each carries the spread. */
  spreadEntryCount: number;
  spreadCents: number;
  freeNotionalCents: number;
  netCents: number;
}

/**
 * ADMIN-ONLY margin: collected from recruits, owed to Lynne
 * (recruited x her rate), the tier spread (1-3-tier entries x the $5
 * difference), and the notional value of earned free entries.
 */
export function computeMargin(
  liveEntries: { ownerId: string; isFreeEntry: boolean }[],
  collectedCents: number,
  config: PricingConfig = DEFAULT_PRICING,
): MarginReport {
  const recruitedByOwner = new Map<string, number>();
  let freeCount = 0;
  for (const e of liveEntries) {
    if (e.isFreeEntry) {
      freeCount++;
      continue;
    }
    recruitedByOwner.set(e.ownerId, (recruitedByOwner.get(e.ownerId) ?? 0) + 1);
  }
  const recruited = [...recruitedByOwner.values()].reduce((s, n) => s + n, 0);
  const spreadEntryCount = [...recruitedByOwner.values()]
    .filter((n) => n >= 1 && n <= 3)
    .reduce((s, n) => s + n, 0);
  const perEntrySpread = config.tier13Cents - config.lynneRateCents;
  const spreadCents = spreadEntryCount * perEntrySpread;
  const freeNotionalCents = freeCount * config.lynneRateCents;
  return {
    recruited,
    freeCount,
    totalEntries: recruited + freeCount,
    collectedCents,
    owedLynneCents: recruited * config.lynneRateCents,
    spreadEntryCount,
    spreadCents,
    freeNotionalCents,
    netCents: spreadCents + freeNotionalCents,
  };
}

/** Default-order leading key: the runner's entries first, stable otherwise. */
export function adminFirst(
  a: { isAdminEntry: boolean },
  b: { isAdminEntry: boolean },
): number {
  return Number(b.isAdminEntry) - Number(a.isAdminEntry);
}
