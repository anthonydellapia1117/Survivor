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
