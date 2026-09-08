// The one place in scripts/ that can send mail, and it can send exactly one
// template. Set by Anthony on 2026-09-08 (C3):
//
//   - only a template on SEND_ALLOWLIST (today: pick_reminder)
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
import { loadAuditByAction, recordAudit } from "./db";

export const SEND_ALLOWLIST = ["pick_reminder"] as const;
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
  return { recipient, lockDay, messageId: String(a.message_id ?? r.target_id ?? ""), at: r.at };
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
  const out: PriorSend[] = [];
  for (const r of [...claims, ...sends]) {
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
  if (!autosendEnabled()) {
    throw new Error("REMINDER_AUTOSEND is not true: drafts only.");
  }
  if (req.entryNames.length === 0) {
    throw new Error(`Nothing to ask ${req.to} for: no unpicked entries.`);
  }
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

  const m: OutboundMessage = { to: [req.to], subject: req.subject, body: req.body };
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
