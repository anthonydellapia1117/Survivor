// THE ONE LINK. Set by Anthony on 2026-09-11.
//
// Any outbound message that carries a link carries exactly this one: the
// anchor text "AD-26-Survivor" pointing at the site's root. Clickable, never a
// bare URL in front of the reader, and no second destination - not /grid, not
// /master-list, not an admin path.
//
// The standing rule is untouched and sits above this one: a message that ASKS
// for a pick carries no link at all, because the app has no pick entry
// (CLAUDE.md, Players submit by email reply or text). This governs the
// messages that may carry one.
//
// WHY THE PLAIN PART HAS NO URL. A message with a link goes out as
// multipart/alternative. The HTML part is what every reader in this pool sees
// and it holds the anchor; the plain part names the site the same way and
// stops there. Putting the raw address in the plain part would be the bare URL
// the rule forbids, and it would be the copy a guard has to keep exempting.
// Gmail rewrites the href into a google.com/url redirect on the way out -
// expected, and the only difference permitted between what is written here and
// what lands in an inbox.

/** What the reader sees and clicks. */
export const SITE_LINK_TEXT = "AD-26-Survivor";

/** The only href any outbound template may carry. */
export const SITE_LINK_HREF = "https://ad-26-survivor.vercel.app/";

/** Blue and underlined inline: an email has no stylesheet to inherit from. */
const LINK_STYLE = "color:#4f7cff;text-decoration:underline";

export function htmlEscape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** The anchor itself, the one place its markup is written. */
export function siteAnchor(): string {
  return `<a href="${SITE_LINK_HREF}" style="${LINK_STYLE}">${SITE_LINK_TEXT}</a>`;
}

/**
 * A plain-text body as the HTML part of the same message: escaped, line breaks
 * preserved, and every mention of the site's name turned into the one anchor.
 *
 * The plain body is the single source of the words - there is no second copy
 * of the sentence to drift - so a line that reads
 *
 *     You do not make picks in the app. It is there to look at: AD-26-Survivor
 *
 * is exactly that sentence in both parts, clickable in one of them.
 */
export function htmlBodyOf(text: string): string {
  const escaped = htmlEscape(text).replaceAll(htmlEscape(SITE_LINK_TEXT), siteAnchor());
  return [
    `<div style="font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;white-space:pre-wrap">`,
    escaped,
    `</div>`,
  ].join("");
}

/** Whether a body names the site at all, and so needs an HTML part. */
export function mentionsSite(text: string): boolean {
  return text.includes(SITE_LINK_TEXT);
}
