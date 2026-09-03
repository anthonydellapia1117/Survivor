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
  const rate = paidEntryCount >= 4 ? config.tier4PlusCents : config.tier13Cents;
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
 * An owner's display name, built from the stored parts the way the database
 * builds it. `admin_resync_default_entry_names` trims each component before
 * joining — btrim(btrim(first) || ' ' || btrim(last)) — so trimming only the
 * concatenated string would disagree whenever the whitespace sits at the join:
 * "Ernie " + "DellaPia" yields "Ernie  DellaPia" and the doubled space survives
 * an outer trim. The two layers have to produce the same string for the same
 * owner, so build it here and nowhere else.
 *
 * Internal spacing WITHIN a component is the owner's and is untouched.
 */
export function ownerFullName(firstName: string, lastName: string): string {
  return [firstName, lastName]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");
}

/**
 * Default entry naming when an owner supplies no names. Anthony's convention:
 * a single entry is the plain full name, several are "Full Name #1", "#2", …
 * — a space, a hash, then the digit with nothing between. One entry carries
 * no hash and no number at all.
 *
 * `startAt` numbers a batch added to an owner who already has entries, so
 * topping up from 2 to 4 yields "#3" and "#4" rather than restarting at #1.
 * Every default-naming surface routes through here; building the string
 * inline is how the separator drifts.
 */
export function defaultEntryNames(
  fullName: string,
  count: number,
  startAt = 1,
): string[] {
  if (count <= 0) return [];
  // Edge whitespace on an owner's stored name must never reach the entry name.
  // Lynne matches these strings exactly, so "Ernie DellaPia Jr.  #1" with the
  // doubled space is a different entry to her than "Ernie DellaPia Jr. #1", and
  // an owner whose name is all whitespace would mint a bare " #1". Internal
  // spacing is the owner's and is left exactly as stored.
  const base = fullName.trim();
  if (base === "") return [];
  if (count === 1 && startAt === 1) return [base];
  return Array.from({ length: count }, (_, i) => `${base} #${startAt + i}`);
}
