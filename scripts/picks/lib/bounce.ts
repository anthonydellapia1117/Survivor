// Bounces. Set by Anthony on 2026-09-15, the morning of the Wednesday 2 PM
// deadline: "Watch for bounces. Lynne reports Comcast bouncing on her end and
// three of ours are Comcast."
//
// A delivery failure is the one message about a player that does not come
// from the player, so neither sweep read could see it: the address read is
// keyed on roster senders and a DSN comes from mailer-daemon; the subject read
// is keyed on the pool's words and a DSN's subject is "Delivery Status
// Notification (Failure)". This is the third read. It reads every DSN in the
// window that is not yet filed, in full, takes the failed recipient out of the
// notice, and where that address is on the roster stages ONE identity row -
// the queue already renders that kind - naming the person's entries, and
// posts a NEEDS ANTHONY line. A DSN for an address that is on no roster row is
// filed under DONE and not staged: nothing of ours failed.
//
// Nothing here writes a pick, and nothing here changes an address: a bounce is
// a fact for Anthony to act on, never a reason for a run to drop a player.

import type { InboundMessage } from "../../lib/gmail";
import { notDoneClause } from "../../lib/gmail";
import { DONE_LABEL, SWEEP_WINDOW_DAYS } from "../../lib/constants";

/** The Gmail search for delivery failures: from a mailer, in the window, not yet filed. */
export function bounceSweepQuery(windowDays: number = SWEEP_WINDOW_DAYS, doneLabel: string = DONE_LABEL): string {
  if (!Number.isInteger(windowDays) || windowDays < 1) throw new Error("bounce sweep: windowDays must be a positive integer");
  return [`-in:draft`, `newer_than:${windowDays}d`, notDoneClause(doneLabel), `from:(mailer-daemon OR postmaster)`].join(" ");
}

/** Whether the sender is a mail system rather than a person. */
export function isBounceSender(fromAddress: string): boolean {
  const a = fromAddress.trim().toLowerCase();
  return /^(mailer-daemon|postmaster)(@|$)/.test(a);
}

const ADDRESS = "[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}";

/**
 * The address a delivery failure names, or null when the notice carries none
 * this can read. Three forms, in the order they are tried:
 *
 *   1. Gmail's own notice: "Your message wasn't delivered to X because ..."
 *      (the apostrophe is straight or curly, and the address may be on the
 *      next line);
 *   2. the older Google form: "Delivery to the following recipient failed
 *      permanently:" then the address on its own line;
 *   3. the DSN itself: "Final-Recipient: rfc822; X".
 *
 * There was no real bounce on file when this was written, so the three forms
 * are the fixtures. Anything else is null and the caller says so rather than
 * guessing an address out of the notice.
 */
export function failedRecipient(body: string): string | null {
  const text = (body ?? "").replace(/\r/g, "");
  const forms = [
    new RegExp(`wasn(?:'|\\u2019|&#39;)t delivered to\\s+<?(${ADDRESS})>?`, "i"),
    new RegExp(`Delivery to the following recipients? failed[^\\n]*\\n+\\s*<?(${ADDRESS})>?`, "i"),
    new RegExp(`Final-Recipient:\\s*rfc822;\\s*<?(${ADDRESS})>?`, "i"),
  ];
  for (const re of forms) {
    const m = re.exec(text);
    if (m) return m[1].trim().toLowerCase();
  }
  return null;
}

export interface BounceRow {
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  /** The address the notice names, lowercased; null when none could be read. */
  bouncedAddress: string | null;
  /** True when the address is an owner's or a player_email on a live entry. */
  onRoster: boolean;
  /** The entries that address plays, by name; empty when it is not on the roster. */
  entryNames: string[];
}

/**
 * Which of the DSNs concern the roster. `entriesFor` is the sweep's own scope
 * function - the entries an address plays - so the entries named are exactly
 * the ones whose pick request that address was sent.
 */
export function classifyBounces(
  msgs: InboundMessage[],
  rosterAddresses: Iterable<string>,
  entriesFor: (address: string) => { entryName: string }[],
): BounceRow[] {
  const roster = new Set([...rosterAddresses].map((a) => a.trim().toLowerCase()).filter(Boolean));
  return msgs.map((m) => {
    const bounced = failedRecipient(m.body);
    const onRoster = bounced !== null && roster.has(bounced);
    return {
      messageId: m.id,
      from: m.fromAddress,
      subject: m.subject,
      receivedAt: m.receivedAt,
      bouncedAddress: bounced,
      onRoster,
      entryNames: onRoster ? entriesFor(bounced!).map((e) => e.entryName) : [],
    };
  });
}

/** What the queue row for a roster bounce carries. */
export function bouncePayload(b: BounceRow, week: number): Record<string, unknown> {
  return {
    week,
    from: b.from,
    bounced_address: b.bouncedAddress,
    entries: b.entryNames,
    subject: b.subject,
    received_at: b.receivedAt,
    reason: "delivery failed",
    question: `Mail to ${b.bouncedAddress} for ${b.entryNames.join(", ") || "(no entry)"} bounced. Which address reaches them?`,
  };
}
