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

/**
 * FLOOR(recruited / ratio). Recruited = live non-free entries — everything
 * anyone pays for. Free entries never earn more free entries, and payment
 * status is irrelevant to earning (the old payments-covered rule was
 * wrong; see src/lib/free-entries.ts for the full rule).
 */
export function freeEntriesEarned(
  recruitedCount: number,
  config: PricingConfig = DEFAULT_PRICING,
): number {
  return Math.floor(Math.max(0, recruitedCount) / config.freeEntryRatio);
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
