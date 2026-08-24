// Locked business rules (spec section 3) that the UI needs at render time.
// The database views are the authority for anything stored; these functions
// exist for display math and admin previews, and are unit-tested against the
// same numbers the SQL tests assert.

export interface PricingConfig {
  tier13Cents: number; // 1-3 entries, per entry
  tier4PlusCents: number; // 4+ entries, per entry
  lynneRateCents: number; // remitted per entry, every tier
  freeEntryRatio: number; // one free entry per N paid
}

export const DEFAULT_PRICING: PricingConfig = {
  tier13Cents: 3000,
  tier4PlusCents: 2500,
  lynneRateCents: 2500,
  freeEntryRatio: 10,
};

/** Amount an owner owes for `paidEntryCount` paid (non-free) entries. */
export function amountDueCents(
  paidEntryCount: number,
  config: PricingConfig = DEFAULT_PRICING,
): number {
  if (paidEntryCount <= 0) return 0;
  const rate =
    paidEntryCount >= 4 ? config.tier4PlusCents : config.tier13Cents;
  return paidEntryCount * rate;
}

/**
 * $25/entry remitted to the master pool, every tier, always — for PAID
 * entries only. Free entries are excluded (her words: "You had 6 free and
 * had 66 players at 25 = 1650"). Callers pass the paid-entry count.
 */
export function lynneRemittanceCents(
  entryCount: number,
  config: PricingConfig = DEFAULT_PRICING,
): number {
  return Math.max(0, entryCount) * config.lynneRateCents;
}

/** FLOOR(paid entries / 10). Additive entries, named before Week 1. */
export function freeEntriesEarned(
  paidEntryCount: number,
  config: PricingConfig = DEFAULT_PRICING,
): number {
  return Math.floor(Math.max(0, paidEntryCount) / config.freeEntryRatio);
}

/**
 * How many of an owner's paid (non-free) entries are covered by money
 * actually received. Spec section 9's worked example counts entries this
 * way: Maria $100/4 entries + Brian $60/2 + Tim $30/1 + Marc $60/2 = 9 paid.
 * The per-entry rate falls out of due/count, so tier pricing is honored
 * without re-deriving it.
 */
export function coveredPaidEntries(o: {
  paidEntryCount: number;
  dueCents: number;
  paidCents: number;
}): number {
  if (o.paidEntryCount <= 0 || o.dueCents <= 0) return 0;
  return Math.min(
    o.paidEntryCount,
    Math.floor((Math.max(0, o.paidCents) * o.paidEntryCount) / o.dueCents),
  );
}

export interface FreeEntryStatus {
  covered: number; // paid entries covered by received money, pool-wide
  earned: number; // FLOOR(covered / ratio)
  named: number; // live entries already flagged is_free_entry
  unnamed: number; // earned - named, floored at 0
  overNamed: number; // named - earned, floored at 0
}

/** Pool-wide free-entry position: earned from payments vs. named in the app. */
export function freeEntryStatus(
  owners: {
    participationStatus: string;
    paidEntryCount: number;
    dueCents: number;
    paidCents: number;
  }[],
  namedFreeEntries: number,
  config: PricingConfig = DEFAULT_PRICING,
): FreeEntryStatus {
  const covered = owners
    .filter((o) => o.participationStatus === "confirmed")
    .reduce((s, o) => s + coveredPaidEntries(o), 0);
  const earned = freeEntriesEarned(covered, config);
  return {
    covered,
    earned,
    named: namedFreeEntries,
    unnamed: Math.max(0, earned - namedFreeEntries),
    overNamed: Math.max(0, namedFreeEntries - earned),
  };
}

export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Default entry naming when an owner supplies no names: the plain full name
 * for a single entry, "Full Name N" for several. Always marked default.
 */
export function defaultEntryNames(fullName: string, count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return [fullName];
  return Array.from({ length: count }, (_, i) => `${fullName} ${i + 1}`);
}
