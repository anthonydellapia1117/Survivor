// The Gmail filter's rule, in code (Anthony, 2026-09-09): mail from anyone
// whose subject names the pool or the picks is read by the sweep too, even
// when the sender is on no roster row. Such mail lands as an identity
// question for him - a stranger's picks are never written - rather than
// sitting unread because a filter in a settings screen was not updated.
// The words come from scripts/ops/config.json (sweepSubjectTerms).

import type { InboundMessage } from "../../lib/gmail";

/** The Gmail search for the subject rule: unread, not a draft, subject carrying any of the words. */
export function subjectSweepQuery(terms: string[]): string {
  const words = terms.map((t) => t.trim()).filter(Boolean);
  if (words.length === 0) throw new Error("subject sweep: no terms");
  return `is:unread -in:draft subject:(${words.join(" OR ")})`;
}

/** Whether a subject carries any of the words, as whole words, any case. */
export function isSweptSubject(subject: string, terms: string[]): boolean {
  return terms.some((t) => new RegExp(`\\b${t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(subject));
}

/**
 * The subject-swept messages worth keeping: not from an address the sweep
 * already read (a known player), not from the admin's own mailbox, not from
 * the master pool's runner (her mail is not a pick), and with the subject
 * actually matching (Gmail's search is looser than the words).
 */
export function strangerMessages(
  msgs: InboundMessage[],
  knownAddresses: string[],
  excludeAddresses: string[],
  terms: string[],
): InboundMessage[] {
  const skip = new Set([...knownAddresses, ...excludeAddresses].map((a) => a.trim().toLowerCase()).filter(Boolean));
  return msgs.filter((m) => !skip.has(m.fromAddress.trim().toLowerCase()) && isSweptSubject(m.subject, terms));
}
