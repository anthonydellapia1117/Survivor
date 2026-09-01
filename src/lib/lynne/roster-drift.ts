// How our roster drifts from Lynne's copy, in exactly three ways — each one a
// different email she is owed, so each is tracked and cleared independently.
//
//   NEW      she has never seen it            → send it
//   RENAMED  she has it under a stale name    → send the correction
//   REMOVED  she has it and we have voided it → ask her to pull it
//
// REMOVED is the one that hid for a while: voiding an entry dropped it from
// every roster view (they all filter voided entries out first), so her sheet
// kept a live entry nobody was picking for, and its number came back
// unmatched. It is derived from ALL entries, never from the active list.
//
// The three are deliberately disjoint: an entry is voided or it is not, and
// the rename check requires a live entry, so nothing is ever counted twice.

import type { AdminEntry } from "@/lib/data/admin-types";

/** Live and never sent: a late joiner Lynne has yet to receive. */
export function isUnsentToLynne(e: AdminEntry): boolean {
  return e.voidedAt === null && e.submittedToLynneAt === null;
}

/** Live, sent, and renamed since: she holds submittedAsName, we hold entryName. */
export function isRenamedSinceSubmission(e: AdminEntry): boolean {
  return (
    e.voidedAt === null &&
    e.submittedAsName !== null &&
    e.submittedToLynneAt !== null &&
    e.submittedAsName !== e.entryName
  );
}

/** Voided here, but she was sent it and has not been told to drop it. */
export function isRemovedSinceSubmission(e: AdminEntry): boolean {
  return (
    e.voidedAt !== null &&
    e.submittedToLynneAt !== null &&
    e.removalCommunicatedAt === null
  );
}

/** The name Lynne's sheet carries — what she has to find to strike a row. */
export function nameOnLynnesSheet(e: AdminEntry): string {
  return e.submittedAsName ?? e.entryName;
}
