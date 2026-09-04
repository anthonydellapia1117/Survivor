// What counts as an address, and when two of them are the same person.
//
// Both the pick-request generator and the group-send list have to answer
// "is this CC actually a second person?", and when they answered it
// separately they disagreed: the pick screen reported a self-CC as dropped
// while the group-send screen counted it as a second contact. One row, two
// screens, opposite stories. The rule lives here so there is only one answer.

/** Trimmed, or "" — the app decides "blank" with JS trim() everywhere. */
export function normalizeAddress(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Two addresses that reach the same mailbox.
 *
 * Case-insensitive, because mailbox case is not significant to any provider
 * this pool uses and "Kris@" beside "kris@" is one person. Blank is never
 * the same as anything, including another blank: two owners with no address
 * are two unreachable people, not a duplicate.
 */
export function sameAddress(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizeAddress(a);
  const right = normalizeAddress(b);
  if (left === "" || right === "") return false;
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Catches a TYPO, not an RFC violation.
 *
 * Deliberately permissive: exactly one @, something either side of it, a dot
 * in the domain, and no whitespace. Real addresses in this pool are ordinary
 * consumer mailboxes, and a stricter rule that rejects a valid-but-unusual
 * address is worse than one that lets a malformed one through — a refused
 * save blocks a real arrangement, while a bad address surfaces the first time
 * a pick request bounces.
 *
 * Blank is VALID here. `is_gifted` with no address is a real state — somebody
 * else plays this entry and their address is not known yet — so a blank field
 * must save. Callers that need "is there an address at all" ask
 * normalizeAddress, which is a different question.
 */
export function isPlausibleAddress(value: string | null | undefined): boolean {
  const address = normalizeAddress(value);
  if (address === "") return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}
