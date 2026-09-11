// THE ONE LINK, held to. Set by Anthony on 2026-09-11.
//
// Any outbound message that carries a link carries exactly one: the anchor
// "AD-26-Survivor" on https://ad-26-survivor.vercel.app/. Clickable, no bare
// URL in front of a reader, no second destination.
//
// Two scans, because either alone can be passed:
//
//   * the SOURCE scan catches a URL typed into copy - the shape of the
//     mistake, a literal pasted into a sentence;
//   * the RENDERED scan catches a URL that arrives indirectly, through an
//     import or an interpolation, which no literal scan in the template's own
//     file can see. It is run on the real bodies, plain part and HTML part.
//
// The standing rule above this one is unchanged and has its own file: a
// message that ASKS for a pick carries no link at all, because the app has no
// pick entry (tests/unit/player-copy-submit-path.test.ts).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SITE_LINK_HREF, SITE_LINK_TEXT, htmlBodyOf, siteAnchor } from "../../scripts/lib/site-link";
import { distributeMessage } from "../../scripts/distribute/lib/message";
import { reminderBody, reminderHtml } from "../../scripts/remind/lib/message";
import { bccBody, recipientBody } from "../../scripts/chase/lib/message";
import { buildPickRequests } from "@/lib/emails/pick-request";
import type { GameRow, WeekRow } from "@/lib/data/types";
import type { GameLite, WeekBounds } from "../../scripts/picks/lib/deadline";
import { literals } from "../helpers/source-literals";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(here(rel), "utf8");

/** Every module that builds words for an outbound message. */
const TEMPLATES = [
  "../../src/lib/emails/pick-request.ts",
  "../../src/lib/emails/template.ts",
  "../../src/lib/emails/group-send.ts",
  "../../scripts/chase/lib/message.ts",
  "../../scripts/remind/lib/message.ts",
  "../../scripts/distribute/lib/message.ts",
  "../../scripts/picks/lib/self-email.ts",
  "../../scripts/lib/site-link.ts",
];

const URL_RE = /https?:\/\/[^\s"'<>)]+/gi;

const WEEK1: WeekRow = {
  week: 1,
  windowLabel: "thu_fri",
  deadlineAt: "2026-09-11T18:00:00+00:00",
  earlyDeadlineAt: "2026-09-09T18:00:00+00:00",
  lateDeadlineAt: "2026-09-11T18:00:00+00:00",
  resultsFinal: false,
  confirmed: true,
};
const GAMES: Pick<GameRow, "week" | "dayOfWeek">[] = [
  { week: 1, dayOfWeek: "Wednesday" },
  { week: 1, dayOfWeek: "Sunday" },
];
const BOUNDS: WeekBounds = {
  week: 1,
  earlyDeadlineAt: WEEK1.earlyDeadlineAt,
  lateDeadlineAt: WEEK1.lateDeadlineAt,
};
const REMIND_GAMES: GameLite[] = [
  { week: 1, dayOfWeek: "Wednesday", homeTeam: "SEA", awayTeam: "NE" },
  { week: 1, dayOfWeek: "Sunday", homeTeam: "PHI", awayTeam: "DAL" },
];
const NOW = new Date("2026-09-11T12:00:00Z");
const COUNTS = { noLosses: 3, lossBye: 1, out: 2, alive: 4 };

const remind = { week: 1, kind: "late" as const, deadlineIso: WEEK1.lateDeadlineAt, slot: "fri" as const };

function pickRequest() {
  return buildPickRequests(
    [
      {
        id: "o1",
        greetingName: "Caroline",
        fullName: "Caroline Reichenback",
        email: "owner@example.com",
        entries: [{ id: "e1", entryName: "Pumpy321", isGifted: false, playerEmail: null }],
      },
    ],
    WEEK1,
    GAMES,
  ).built[0];
}

/** Every outbound body a recipient can actually receive, plain part and HTML part. */
function bodies(): { what: string; body: string }[] {
  const built = pickRequest();
  const dist = distributeMessage(3, COUNTS);
  return [
    { what: "pick request, text", body: built.text },
    { what: "pick request, html", body: built.html },
    { what: "chase, one recipient", body: recipientBody({ week: 1, greetingName: "Tom", entryNames: ["Solo"], tiers: [], lateDeadlineIso: WEEK1.lateDeadlineAt }) },
    { what: "chase, bcc", body: bccBody({ week: 1, tiers: [], lateDeadlineIso: WEEK1.lateDeadlineAt, entryCounts: [1, 2] }) },
    { what: "week reminder, text", body: reminderBody(remind, BOUNDS, REMIND_GAMES, NOW, { outstanding: 7 }) },
    { what: "week reminder, html", body: reminderHtml(remind, BOUNDS, REMIND_GAMES, NOW, { outstanding: 7 }) },
    { what: "distribute, text", body: dist.body },
    { what: "distribute, html", body: dist.html },
  ];
}

describe("the one link", () => {
  it("is the only URL any outbound template's source carries", () => {
    for (const file of TEMPLATES) {
      // LITERALS, not the whole file: a comment naming the address it
      // replaced is prose about the rule, and a scan that fires on it is
      // firing on the explanation instead of the mistake.
      const urls = [...new Set(literals(read(file)).match(URL_RE) ?? [])];
      const foreign = urls.filter((u) => u !== SITE_LINK_HREF);
      expect({ file, foreign }).toEqual({ file, foreign: [] });
    }
  });

  it("is the only URL any rendered body carries", () => {
    for (const { what, body } of bodies()) {
      const urls = [...new Set(body.match(URL_RE) ?? [])];
      const foreign = urls.filter((u) => u !== SITE_LINK_HREF);
      expect({ what, foreign }).toEqual({ what, foreign: [] });
    }
  });

  it("puts no URL at all in front of a reader of the plain part", () => {
    // The href belongs in an anchor. A plain part carrying the address would
    // be the bare URL the rule forbids - it would also be the copy every
    // future guard has to keep exempting.
    for (const { what, body } of bodies()) {
      if (what.endsWith("html")) continue;
      expect({ what, urls: body.match(URL_RE) ?? [] }).toEqual({ what, urls: [] });
    }
  });

  it("names the site by its anchor text wherever a link is meant", () => {
    // Assert-first, so the two scans above cannot be passing on copy that
    // lost its link entirely: these two messages are the ones allowed one.
    const dist = distributeMessage(3, COUNTS);
    expect(dist.body).toContain(SITE_LINK_TEXT);
    expect(dist.html).toContain(siteAnchor());
    const text = reminderBody(remind, BOUNDS, REMIND_GAMES, NOW, { outstanding: 7 });
    expect(text).toContain(SITE_LINK_TEXT);
    expect(reminderHtml(remind, BOUNDS, REMIND_GAMES, NOW, { outstanding: 7 })).toContain(siteAnchor());
  });

  it("is exactly the anchor text and href Anthony set, with the trailing slash", () => {
    expect(SITE_LINK_TEXT).toBe("AD-26-Survivor");
    expect(SITE_LINK_HREF).toBe("https://ad-26-survivor.vercel.app/");
    expect(siteAnchor()).toContain(`href="${SITE_LINK_HREF}"`);
    expect(siteAnchor()).toContain(`>${SITE_LINK_TEXT}<`);
  });

  it("escapes the words around the link rather than trusting them", () => {
    // A body reaches htmlBodyOf as text. An entry name is owner-supplied and
    // stored verbatim, so one can carry angle brackets; unescaped it would be
    // markup in the message.
    const out = htmlBodyOf(`<b>not bold</b> & ${SITE_LINK_TEXT}`);
    expect(out).toContain("&lt;b&gt;not bold&lt;/b&gt; &amp;");
    expect(out).toContain(siteAnchor());
    expect(out).not.toContain("<b>not bold</b>");
  });
});
