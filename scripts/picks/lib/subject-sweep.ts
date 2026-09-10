// The Gmail filter's rule, in code (Anthony, 2026-09-09): mail from anyone
// whose subject names the pool or the picks is read by the sweep too, even
// when the sender is on no roster row. Such mail lands as an identity
// question for him - a stranger's picks are never written - rather than
// sitting unread because a filter in a settings screen was not updated.
// The words come from scripts/ops/config.json (sweepSubjectTerms).

import type { InboundMessage } from "../../lib/gmail";
import { SWEEP_WINDOW_DAYS } from "../../lib/constants";

/**
 * The Gmail search for the subject rule: unread, not a draft, inside the
 * window, not from a machine, subject carrying any of the phrases.
 *
 * Three of those four clauses were added on 2026-09-10. Without the window
 * the sweep read five months of unread mail on its first credentialed run;
 * without the sender exclusions every GitHub notification on this repo
 * matched, because their subjects all read "Re: [.../Survivor] ..." and the
 * pool's own name is a term. A phrase is quoted so Gmail matches it whole.
 */
export function subjectSweepQuery(
  terms: string[],
  excludeSenders: string[] = [],
  windowDays: number = SWEEP_WINDOW_DAYS,
): string {
  const words = terms.map((t) => t.trim()).filter(Boolean);
  if (words.length === 0) throw new Error("subject sweep: no terms");
  if (!Number.isInteger(windowDays) || windowDays < 1) throw new Error("subject sweep: windowDays must be a positive integer");
  const quoted = words.map((w) => (w.includes(" ") ? `"${w}"` : w));
  const notFrom = excludeSenders
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .map((a) => `-from:${a}`);
  return [`is:unread`, `-in:draft`, `newer_than:${windowDays}d`, ...notFrom, `subject:(${quoted.join(" OR ")})`].join(" ");
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

/** What a stranger's unparseable message is staged as. */
export const STRANGER_NOTHING_REASON = "unknown sender, subject matched, nothing recognised in the message";
export const STRANGER_NOTHING_LINE = "(no pick found in the body)";

/**
 * The identity row a subject-swept stranger's message needs when parsing it
 * produced no row at all, and null when it produced any.
 *
 * A stranger whose body is empty, a bare greeting, or anything unparsedReason
 * calls noise yielded neither a pick nor a question: nothing was staged, so
 * the message was never marked processed and every hourly sweep found it
 * again, while the log line said it had been staged (issue #42). One identity
 * row makes the log true and gets the message filed once.
 *
 * A stranger's mail must never become a pick. This only makes it a question.
 */
export function strangerIdentityRow(
  stranger: boolean,
  rowsProduced: number,
): { kind: "identity"; reason: string; line: string } | null {
  if (!stranger || rowsProduced > 0) return null;
  return { kind: "identity", reason: STRANGER_NOTHING_REASON, line: STRANGER_NOTHING_LINE };
}
