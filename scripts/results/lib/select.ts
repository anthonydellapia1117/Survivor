// Which of Lynne's messages carries the week's sheet. Pure: the CLI hands
// it message metadata and it returns the newest message holding a
// "Football" .xlsx attachment. Newest is measured on Gmail's internalDate,
// never on the Date header, which is whatever her mail client wrote.

import type { AttachmentRef, MessageMeta } from "../../lib/gmail";

export interface FootballSelection {
  message: MessageMeta;
  attachment: AttachmentRef;
}

/** "Football" anywhere in the name and a .xlsx extension, both case-insensitive. */
export function isFootballXlsx(filename: string): boolean {
  return /football/i.test(filename) && /\.xlsx$/i.test(filename);
}

/** The first Football .xlsx attached to the message, or null. */
export function footballAttachment(m: MessageMeta): AttachmentRef | null {
  return m.attachments.find((a) => isFootballXlsx(a.filename)) ?? null;
}

/** The newest message carrying a Football .xlsx; null when none does. */
export function selectFootballMessage(messages: MessageMeta[]): FootballSelection | null {
  let best: FootballSelection | null = null;
  for (const message of messages) {
    const attachment = footballAttachment(message);
    if (!attachment) continue;
    if (best === null || message.internalMs > best.message.internalMs) {
      best = { message, attachment };
    }
  }
  return best;
}

/** The refusal for a file already imported, null when it is new. The sha256 is the identity. */
export function refuseDuplicateImport(
  prior: { id: string; week: number | null; imported_at: string } | null,
): string | null {
  if (!prior) return null;
  return `Already imported ${prior.imported_at} as import ${prior.id} (week ${prior.week ?? "unknown"}): refusing to run twice on the same file.`;
}

/**
 * The refusal when her sheet's latest filled week is not the week being
 * imported, null when it is (or when the file carries no filled week). An
 * older sheet has an empty Week N column and would record every entry as
 * missing; a NEWER sheet is Week N+1's file, and recording it as Week N
 * would spend its sha256 on the wrong week and refuse the real Week N+1
 * import later. Either way the fix is the message that carries the Week N
 * sheet, named by --message-id.
 */
export function refuseWeekMismatch(latestFilledWeek: number | null, week: number, filename: string): string | null {
  if (latestFilledWeek === null || latestFilledWeek === week) return null;
  const which = latestFilledWeek < week ? `predates Week ${week}` : `is a later sheet than Week ${week}'s and would spend its sha256 on the wrong week`;
  return `Her sheet's latest filled week is ${latestFilledWeek}, not ${week}: ${filename} ${which}. Pass --message-id for the message that carries her Week ${week} sheet.`;
}

/**
 * A legacy per-week file (entry, team, result columns) carries no week of
 * its own, so the newest such file cannot be taken as Week N's: a delayed
 * run would record the next week's file, sha256 and rows, under Week N.
 * It is imported only from a message Anthony named with --message-id.
 */
export function refuseUnverifiedLegacy(format: "grid" | "legacy", explicitMessage: boolean, week: number, filename: string): string | null {
  if (format !== "legacy" || explicitMessage) return null;
  return `${filename} is a per-week file that carries no week of its own, so it is not taken by date. Pass --message-id for the message that carries her Week ${week} file.`;
}
