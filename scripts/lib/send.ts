// The one place in scripts/ that can send mail, and it can send exactly the
// templates on its allowlist: pick_reminder (set by Anthony on 2026-09-08,
// C3) and week_reminder (set by Anthony on 2026-09-09, the reminder he wrote
// for Week 1 made repeatable). Each template has its own function and its
// own gate; nothing else here sends.
//
// pick_reminder, one message per recipient with no pick:
//
//   - only a template on SEND_ALLOWLIST
//   - only when the environment has REMINDER_AUTOSEND=true; unset means
//     drafts only, and every command behaves that way by default
//   - only to a recipient who still has no current pick (the caller decides
//     that from the live roster; this module refuses an empty entry list)
//   - at most once per recipient per lock day, judged from audit_log rows
//     with action pick_reminder_sent, so a re-run never sends twice
//   - every send writes an audit row carrying the recipient, the lock day
//     and the Gmail message id, and a claim row goes in BEFORE the Gmail
//     call so at most once holds even if the run dies mid-send
//
// Anything else that wants to send has to come here and add itself to the
// allowlist in a reviewed change. gmail.ts stays send-free.
//
// Two runs overlapping (a Routine firing while Anthony runs the command by
// hand) could each read no prior send and both mail one recipient. The
// snapshot is re-read immediately before each send, which closes the window
// to the Gmail call itself; a database reservation would need a migration
// and, per CLAUDE.md (Working rules), a concurrency case one admin does not
// produce is documented, not built for. Do not run two autosends at once.

import type { gmail_v1 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env";
import { encodeRaw, type OutboundMessage } from "./gmail";
import { ccFor, deliveryAddressesFor, expandDelivery } from "@/lib/emails/recipient-exceptions";
import { loadAuditByAction, recordAudit } from "./db";
import { assertNoRetiredAddresses } from "./roster";

export const SEND_ALLOWLIST = ["pick_reminder", "week_reminder"] as const;
export type SendableTemplate = (typeof SEND_ALLOWLIST)[number];
export const SEND_AUDIT_ACTION = "pick_reminder_sent";
/**
 * Written BEFORE the Gmail call. A claim with no matching sent row means a
 * send was attempted and its outcome is unknown; the next run treats it as
 * sent (never a second mail) and Anthony reads it on /admin/audit.
 */
export const SEND_CLAIM_ACTION = "pick_reminder_claim";

export function isSendable(template: string): template is SendableTemplate {
  return (SEND_ALLOWLIST as readonly string[]).includes(template);
}

/** REMINDER_AUTOSEND=true, exactly; anything else is drafts only. */
export function autosendEnabled(): boolean {
  loadEnv();
  return process.env.REMINDER_AUTOSEND === "true";
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The lock day of a deadline: its calendar date in ET, e.g. 2026-09-11. */
export function lockDayKey(deadlineIso: string): string {
  return ET_DATE.format(new Date(deadlineIso));
}

export interface PriorSend {
  recipient: string;
  lockDay: string;
  messageId: string;
  at: string;
}

/** One audit row as a prior send; null when it names no recipient or lock day. */
export function priorSendFrom(r: { at: string; target_id: string | null; after: Record<string, unknown> | null }): PriorSend | null {
  const a = r.after ?? {};
  const recipient = String(a.recipient ?? "").toLowerCase();
  const lockDay = String(a.lock_day ?? "");
  if (!recipient || !lockDay) return null;
  // A claim row has no message id (the send had not happened yet); only a
  // sent row carries one, which is how the CLI tells "already sent" from
  // "already claimed".
  return { recipient, lockDay, messageId: String(a.message_id ?? ""), at: r.at };
}

/**
 * Every pick_reminder claim and send on record, from audit_log. A claim
 * counts as a send: once a run has claimed a recipient for a lock day, no
 * run mails them again that day, whatever happened after the claim.
 */
export async function priorSends(client: SupabaseClient): Promise<PriorSend[]> {
  const [claims, sends] = await Promise.all([
    loadAuditByAction(client, SEND_CLAIM_ACTION),
    loadAuditByAction(client, SEND_AUDIT_ACTION),
  ]);
  // Sends first, so a completed send is found before the claim that
  // preceded it; a claim with no sent row still counts on its own.
  const out: PriorSend[] = [];
  for (const r of [...sends, ...claims]) {
    const p = priorSendFrom(r);
    if (p) out.push(p);
  }
  return out;
}

export function alreadySent(prior: PriorSend[], recipient: string, lockDay: string): PriorSend | null {
  const key = recipient.trim().toLowerCase();
  return prior.find((p) => p.recipient === key && p.lockDay === lockDay) ?? null;
}

export interface SendRequest {
  template: SendableTemplate;
  to: string;
  subject: string;
  body: string;
  week: number;
  /** The deadline the message asks the recipient to meet. */
  deadlineIso: string;
  /** Names of the entries the message asks about; must be non-empty. */
  entryNames: string[];
  actor: string;
}

export type SendOutcome =
  | { kind: "sent"; messageId: string; auditId: number; lockDay: string }
  | { kind: "already_sent"; prior: PriorSend; lockDay: string };

/**
 * Send one allowlisted message and record it. Throws when the gate is shut
 * (template not allowlisted, autosend off, nothing to ask for) rather than
 * quietly drafting: the caller decides the fallback.
 */
export async function sendAllowlisted(
  gmail: gmail_v1.Gmail,
  client: SupabaseClient,
  prior: PriorSend[],
  req: SendRequest,
): Promise<SendOutcome> {
  if (!isSendable(req.template)) {
    throw new Error(`Template "${req.template}" is not on the send allowlist (${SEND_ALLOWLIST.join(", ")}).`);
  }
  if (req.template !== "pick_reminder") {
    throw new Error(`sendAllowlisted sends pick_reminder only; ${req.template} has its own gate.`);
  }
  if (!autosendEnabled()) {
    throw new Error("REMINDER_AUTOSEND is not true: drafts only.");
  }
  if (req.entryNames.length === 0) {
    throw new Error(`Nothing to ask ${req.to} for: no unpicked entries.`);
  }
  // Before the claim row, never after: a claim written and then thrown past
  // would consume the recipient's lock day without a message going anywhere.
  //
  // THE WHOLE DELIVERY SET, not just req.to. The two named exceptions
  // (src/lib/emails/recipient-exceptions.ts) add addresses nobody derived
  // from the roster - a multi-address person's other mailboxes and a CC'd
  // owner - so those are precisely the ones that can be retired without the
  // roster knowing. Checking only req.to left them to encodeRaw, which runs
  // AFTER the claim: the throw would land with the lock day already consumed
  // and no message sent, and every later run that day would skip the person
  // as already claimed. Both reviewers caught it on #84.
  const to = deliveryAddressesFor(req.to);
  const cc = ccFor(req.to);
  assertNoRetiredAddresses([...to, ...cc], `pick_reminder addresses for week ${req.week}`);
  const lockDay = lockDayKey(req.deadlineIso);
  const dup = alreadySent(prior, req.to, lockDay);
  if (dup) return { kind: "already_sent", prior: dup, lockDay };
  // Re-read right before the send: the caller's snapshot may be minutes old.
  const fresh = await priorSends(client);
  const dupNow = alreadySent(fresh, req.to, lockDay);
  if (dupNow) {
    prior.push(dupNow);
    return { kind: "already_sent", prior: dupNow, lockDay };
  }

  // Claim first. If the process dies between here and the sent row, the
  // claim alone stops every later run from mailing this person today.
  const recipientKey = req.to.trim().toLowerCase();
  await recordAudit(client, {
    actor: req.actor,
    action: SEND_CLAIM_ACTION,
    targetTable: "gmail",
    targetId: `${recipientKey}:${lockDay}`,
    after: {
      template: req.template,
      recipient: recipientKey,
      week: req.week,
      lock_day: lockDay,
      deadline_at: req.deadlineIso,
      subject: req.subject,
      entry_names: req.entryNames,
    },
    note: `pick_reminder claim for ${req.to}, week ${req.week}, lock day ${lockDay}; a sent row follows on success`,
  });
  prior.push({ recipient: recipientKey, lockDay, messageId: "", at: new Date().toISOString() });

  // The two named exceptions were applied above, at the one send seam and
  // before the claim, rather than in each caller: a multi-address person gets
  // every copy and a CC'd owner is on the header whichever command built the
  // message (src/lib/emails/recipient-exceptions.ts).
  const m: OutboundMessage = { to, cc, subject: req.subject, body: req.body };
  const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw: encodeRaw(m) } });
  const messageId = res.data.id ?? "";
  let auditId: number;
  try {
    auditId = await recordAudit(client, {
      actor: req.actor,
      action: SEND_AUDIT_ACTION,
      targetTable: "gmail",
      targetId: messageId,
      after: {
        template: req.template,
        recipient: req.to.trim().toLowerCase(),
        week: req.week,
        lock_day: lockDay,
        deadline_at: req.deadlineIso,
        message_id: messageId,
        subject: req.subject,
        entry_names: req.entryNames,
      },
      note: `pick_reminder to ${req.to} for week ${req.week}, lock day ${lockDay}`,
    });
  } catch (e: unknown) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(
      `SENT to ${req.to} as Gmail message ${messageId} but the sent audit row failed (${why}). The claim row stands, so no run mails them again today; record message ${messageId} against it on /admin/audit.`,
    );
  }
  return { kind: "sent", messageId, auditId, lockDay };
}

// ------------------------------------------------------------ week_reminder
//
// One message per SLOT - a week has three, each sent on its own morning by
// `npm run remind` (Anthony, 2026-09-10): wed names the early boundary, thu
// names the late one, fri is the final call and names that same late one. To
// the admin's mailbox and Bcc every address on the live roster. Its gate, all
// enforced here:
//
//   - REMINDER_AUTOSEND=true, the same switch as pick_reminder
//   - the Bcc count equals the expected count the caller passes, exactly;
//     the caller derives both, this refuses to send when they differ
//   - at most once per SLOT, judged from audit_log rows with actions
//     week_reminder_claim and week_reminder_sent on the slot's key
//   - a claim row goes in BEFORE the Gmail call, the sent row with the
//     message id after it, so at most once holds if the run dies mid-send
//
// The key is week + slot and NOT week + boundary: thu and fri name the same
// boundary, so a key built from the boundary would let one of them send and
// silently swallow the other. `boundary` stays on the request and in the audit
// row because it is still true and still worth reading - which deadline the
// message named - it is just not what the once-only key is made of.

export const WEEK_REMINDER_CLAIM_ACTION = "week_reminder_claim";
export const WEEK_REMINDER_SENT_ACTION = "week_reminder_sent";

/** The three morning sends of a week; the key is built from one of these. */
export const WEEK_REMINDER_SLOTS = ["wed", "thu", "fri"] as const;
export type WeekReminderSlot = (typeof WEEK_REMINDER_SLOTS)[number];

/**
 * week:N:wed, week:N:thu or week:N:fri - one send each, per week.
 *
 * A SLOT only. It used to accept a boundary name as well, which was the escape
 * hatch that let the key fall back to week+boundary - and thu and fri name the
 * same boundary, so that fallback silently turns two sends into one and eats
 * whichever runs second. There is no fallback now.
 */
export function weekReminderKey(week: number, slot: WeekReminderSlot): string {
  return `week:${week}:${slot}`;
}

export interface PriorWeekReminder {
  /** week:N:wed, week:N:thu or week:N:fri. */
  key: string;
  messageId: string;
  at: string;
}

export function priorWeekReminderFrom(r: { at: string; target_id: string | null; after: Record<string, unknown> | null }): PriorWeekReminder | null {
  const a = r.after ?? {};
  const key = String(a.boundary_key ?? "");
  if (!key) return null;
  return { key, messageId: String(a.message_id ?? ""), at: r.at };
}

/** Every week_reminder claim and send on record. A claim counts as a send. */
export async function priorWeekReminders(client: SupabaseClient): Promise<PriorWeekReminder[]> {
  const [claims, sends] = await Promise.all([
    loadAuditByAction(client, WEEK_REMINDER_CLAIM_ACTION),
    loadAuditByAction(client, WEEK_REMINDER_SENT_ACTION),
  ]);
  const out: PriorWeekReminder[] = [];
  for (const r of [...sends, ...claims]) {
    const p = priorWeekReminderFrom(r);
    if (p) out.push(p);
  }
  return out;
}

export interface WeekReminderRequest {
  template: "week_reminder";
  to: string;
  /**
   * The RECIPIENTS - one address per PERSON, exactly as the roster derived
   * them. NOT the Bcc: this seam expands them to delivery addresses itself,
   * below, because the count gate is on people and the header is on
   * mailboxes, and a caller that hands over an already-expanded list makes
   * those two the same number again.
   */
  recipients: string[];
  subject: string;
  body: string;
  /** The HTML part, so the site's name goes out as an anchor rather than an address. */
  html?: string;
  week: number;
  /** Which stored deadline the message names. Recorded, never the key. */
  boundary: "early" | "late";
  /**
   * Which of the week's three morning sends this is. THE KEY IS BUILT FROM
   * THIS, so thu and fri - which name the same boundary - are two sends and
   * not one.
   *
   * REQUIRED. It was optional while the two-boundary shape was still around,
   * and an optional field that the key falls back from is a once-only guard
   * that can quietly degrade to the very collision this exists to stop
   * (Copilot on #54). Nothing is left to fall back to.
   */
  slot: WeekReminderSlot;
  deadlineIso: string;
  /** The count gate's expected number; recipients.length must equal it. */
  expectedRecipients: number;
  actor: string;
}

export type WeekReminderOutcome =
  | { kind: "sent"; messageId: string; auditId: number; key: string }
  | { kind: "already_sent"; prior: PriorWeekReminder; key: string };

export async function sendWeekReminder(
  gmail: gmail_v1.Gmail,
  client: SupabaseClient,
  req: WeekReminderRequest,
): Promise<WeekReminderOutcome> {
  if (req.template !== "week_reminder" || !isSendable(req.template)) {
    throw new Error(`Template "${req.template}" is not week_reminder.`);
  }
  if (!autosendEnabled()) {
    throw new Error("REMINDER_AUTOSEND is not true: drafts only.");
  }
  if (req.recipients.length === 0) {
    throw new Error("Nobody to send to: the recipient list is empty.");
  }
  if (req.recipients.length !== req.expectedRecipients) {
    throw new Error(`Count gate: ${req.recipients.length} recipients, ${req.expectedRecipients} expected. Not sent.`);
  }
  if (!/^Survivor\b/.test(req.subject)) {
    throw new Error(`Subject must begin with "Survivor" so replies hit the pool filter: "${req.subject}".`);
  }
  // The count gate counts; it does not read. A roster that has had a dead
  // address typed back onto it can derive exactly the expected number and
  // still carry the mailbox that bounced, so the list is READ here too - and
  // read BEFORE the claim row, because a claim written and then thrown past
  // would consume the slot for good with nothing sent.
  assertNoRetiredAddresses(req.recipients, `week_reminder recipients for week ${req.week}`);
  // THE EXPANSION HAPPENS HERE, AFTER THE GATE AND BEFORE THE CLAIM. The gate
  // counts PEOPLE and the Bcc carries MAILBOXES, so a multi-address person is
  // one to the first and several to the second. Doing it at the seam rather
  // than in the caller is what keeps those two numbers from being compared to
  // each other: the first version of this passed the expanded list in as the
  // Bcc and the gate above then rejected 42 against an expected 40, so the
  // week reminder could not send at all. Both reviewers caught it on #84.
  const bcc = expandDelivery(req.recipients);
  // And the expanded list is READ as well as counted, still before the claim:
  // an extra mailbox is typed in by hand and has never been through the
  // roster, so it is exactly the kind of address that can be dead. A claim
  // written and then thrown past would consume the slot with nothing sent.
  assertNoRetiredAddresses([req.to, ...bcc], `week_reminder delivery addresses for week ${req.week}`);
  const key = weekReminderKey(req.week, req.slot);
  // Read right before the send, never from a caller's snapshot.
  const prior = await priorWeekReminders(client);
  const dup = prior.find((p) => p.key === key);
  if (dup) return { kind: "already_sent", prior: dup, key };

  const recipients = bcc.map((a) => a.trim().toLowerCase());
  const peopleCount = req.recipients.length;
  await recordAudit(client, {
    actor: req.actor,
    action: WEEK_REMINDER_CLAIM_ACTION,
    targetTable: "gmail",
    targetId: key,
    after: {
      template: req.template,
      boundary_key: key,
      week: req.week,
      boundary: req.boundary,
      slot: req.slot,
      deadline_at: req.deadlineIso,
      subject: req.subject,
      recipient_count: peopleCount,
      address_count: recipients.length,
      recipients,
    },
    note: `week_reminder claim for ${key}; a sent row follows on success`,
  });

  const m: OutboundMessage = { to: [req.to], bcc: recipients, subject: req.subject, body: req.body, html: req.html };
  const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw: encodeRaw(m) } });
  const messageId = res.data.id ?? "";
  let auditId: number;
  try {
    auditId = await recordAudit(client, {
      actor: req.actor,
      action: WEEK_REMINDER_SENT_ACTION,
      targetTable: "gmail",
      targetId: messageId,
      after: {
        template: req.template,
        boundary_key: key,
        week: req.week,
        boundary: req.boundary,
        slot: req.slot,
        deadline_at: req.deadlineIso,
        message_id: messageId,
        subject: req.subject,
        recipient_count: peopleCount,
        address_count: recipients.length,
        recipients,
      },
      note: `week_reminder ${key} to ${peopleCount} recipients on ${recipients.length} addresses`,
    });
  } catch (e: unknown) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(
      `SENT ${key} as Gmail message ${messageId} but the sent audit row failed (${why}). The claim row stands, so no run sends it again; record message ${messageId} against it on /admin/audit.`,
    );
  }
  return { kind: "sent", messageId, auditId, key };
}
