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
