// Players submit by email reply or text, nothing else (CLAUDE.md). There is
// no pick entry on the public site, so a message that tells someone to submit
// there sends them somewhere that cannot take their pick, and the deadline
// passes while they look for it.
//
// The scan reads STRING LITERALS only, not whole files. Copy lives in
// literals; comments explaining the rule necessarily contain the very phrases
// the rule forbids, and a whole-file scan would match those instead of the
// copy - protection that fires on the explanation and not on the mistake.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPickRequests, CONTACT_PHONE } from "@/lib/emails/pick-request";
import type { GameRow, WeekRow } from "@/lib/data/types";
import { bccBody, recipientBody } from "../../scripts/chase/lib/message";
import { NOT_THE_APP, reminderBody, reminderHtml } from "../../scripts/remind/lib/message";
import { SITE_LINK_TEXT, siteAnchor } from "../../scripts/lib/site-link";
import type { GameLite, WeekBounds } from "../../scripts/picks/lib/deadline";
// One scanner, shared: see tests/helpers/source-literals.ts for why copy
// guards read literals and never whole files.
import { literals } from "../helpers/source-literals";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(here(rel), "utf8");

// Every module that puts words in front of a player.
const PICK_REQUEST = "../../src/lib/emails/pick-request.ts";
const CHASE = "../../scripts/chase/lib/message.ts";
// Post-lock standings. This one MAY carry the site link - a results link is
// not a submission instruction - so it is exempt from the link rule below and
// held to the phrase rule like the rest. Since 2026-09-11 the link is the one
// anchor, "AD-26-Survivor" on the site's root, and the plain part carries no
// address at all (tests/unit/outbound-link-rule.test.ts).
const DISTRIBUTE = "../../scripts/distribute/lib/message.ts";
// The week reminder. It asks for picks and it MAY carry the site link, on one
// line only: the one that says picks are not made there (CLAUDE.md, set by
// Anthony on 2026-09-09 in the reminder he wrote himself). That sentence says
// "in the app" to deny it, so it is cut out before the phrase scan runs and
// asserted present exactly once, so the exemption cannot widen quietly.
const REMIND = "../../scripts/remind/lib/message.ts";

/** A module's copy for the phrase scan, with REMIND's one exempt sentence removed. */
function copyOf(file: string): string {
  const copy = literals(read(file));
  if (file !== REMIND) return copy;
  expect(copy.split(NOT_THE_APP)).toHaveLength(2);
  return copy.replace(NOT_THE_APP, "");
}

// The app's own host, however it is written.
const APP_DOMAIN = /(?:https?:\/\/)?[a-z0-9-]*survivor[a-z0-9-]*\.vercel\.app|\bad-26-survivor\b/i;

// Ways a message could point a player at the app instead of at a reply.
const SENDS_THEM_TO_THE_APP = [
  /\bsubmit\b[^.]{0,40}\b(at|on|in|via|through)\b/i,
  /\b(in|on|through|via)\s+the\s+(app|site|website|portal)\b/i,
  /\b(log|sign)\s*in\b/i,
  /\benter\s+(your|the|a)\s+pick/i,
  /\bpick\s+(your|a)\s+team\s+(at|on)\b/i,
];

// Week 1 as seeded: early Wed noon ET, late Fri noon ET.
const WEEK1: WeekRow = {
  week: 1,
  windowLabel: "thu_fri",
  deadlineAt: "2026-09-11T16:00:00+00:00",
  earlyDeadlineAt: "2026-09-09T16:00:00+00:00",
  lateDeadlineAt: "2026-09-11T16:00:00+00:00",
  resultsFinal: false,
  confirmed: true,
};
const GAMES: Pick<GameRow, "week" | "dayOfWeek">[] = [
  { week: 1, dayOfWeek: "Wednesday" },
  { week: 1, dayOfWeek: "Sunday" },
];

const chaseBcc = { week: 1, tiers: [], lateDeadlineIso: WEEK1.lateDeadlineAt };

const REMIND_BOUNDS: WeekBounds = { week: 1, earlyDeadlineAt: WEEK1.earlyDeadlineAt, lateDeadlineAt: WEEK1.lateDeadlineAt };
const REMIND_GAMES: GameLite[] = [
  { week: 1, dayOfWeek: "Wednesday", homeTeam: "SEA", awayTeam: "NE" },
  { week: 1, dayOfWeek: "Thursday", homeTeam: "LAR", awayTeam: "SF" },
  { week: 1, dayOfWeek: "Sunday", homeTeam: "PHI", awayTeam: "DAL" },
];
const remindEarly = () =>
  reminderBody({ week: 1, kind: "early", deadlineIso: WEEK1.earlyDeadlineAt }, REMIND_BOUNDS, REMIND_GAMES, new Date("2026-09-09T10:00:00Z"), { outstanding: 7 });
const remindLate = () =>
  reminderBody({ week: 1, kind: "late", deadlineIso: WEEK1.lateDeadlineAt }, REMIND_BOUNDS, REMIND_GAMES, new Date("2026-09-11T10:00:00Z"), { outstanding: 7 });
const remindEarlyHtml = () =>
  reminderHtml({ week: 1, kind: "early", deadlineIso: WEEK1.earlyDeadlineAt }, REMIND_BOUNDS, REMIND_GAMES, new Date("2026-09-09T10:00:00Z"), { outstanding: 7 });
const remindLateHtml = () =>
  reminderHtml({ week: 1, kind: "late", deadlineIso: WEEK1.lateDeadlineAt }, REMIND_BOUNDS, REMIND_GAMES, new Date("2026-09-11T10:00:00Z"), { outstanding: 7 });
const chaseInput = (entryNames: string[]) => ({
  week: 1,
  greetingName: "Tom",
  entryNames,
  tiers: [],
  lateDeadlineIso: WEEK1.lateDeadlineAt,
});

// An entry as the generator sees it. A gift is is_gifted plus the address the
// pick request goes to - the two columns CLAUDE.md keeps separate.
const owned = (entryName: string) => ({
  id: `e-${entryName}`,
  entryName,
  isGifted: false,
  playerEmail: null,
});
const giftedTo = (entryName: string, playerEmail: string) => ({
  id: `e-${entryName}`,
  entryName,
  isGifted: true,
  playerEmail,
});

const pickRequest = (entryNames: string[]) =>
  buildPickRequests(
    [
      {
        id: "o1",
        greetingName: "Caroline",
        fullName: "Caroline Reichenback",
        email: "owner@example.com",
        entries: entryNames.map(owned),
      },
    ],
    WEEK1,
    GAMES,
  ).built[0];

// The generator groups by RECIPIENT, so who a message reaches depends on the
// gifts, not on the owner rows. `kind` picks the footer branch: a person who
// only owns, a person who only plays entries somebody else bought, and a
// person who does both in one mailbox.
function builtOfKind(kind: "owner" | "player" | "mixed") {
  const owners = [
    {
      id: "o1",
      greetingName: "Kris",
      fullName: "Kris Tomasco",
      email: "buyer@example.com",
      entries: [owned("Kris #1"), giftedTo("Chas #1", "player@example.com")],
    },
    {
      id: "o2",
      greetingName: "Chas",
      fullName: "Chas Flaster",
      email: "player@example.com",
      // The mixed case needs the same mailbox to own something too.
      entries: kind === "mixed" ? [owned("Chas own")] : [],
    },
  ];
  const { built } = buildPickRequests(owners, WEEK1, GAMES);
  const wanted = built.find((message) => message.kind === kind);
  if (!wanted) {
    throw new Error(`fixture built no ${kind} message; kinds were ${built.map((b) => b.kind).join(", ")}`);
  }
  return wanted;
}

// Every message a recipient can actually receive that ASKS for a pick, each
// branch built on its own. The post-lock message is not one of them: by then
// there is nothing to ask for, and it carries the site link by design.
function pickAsks(): { what: string; body: string }[] {
  const asks: { what: string; body: string }[] = [
    { what: "chase, one entry", body: recipientBody(chaseInput(["Solo"])) },
    { what: "chase, several entries", body: recipientBody(chaseInput(["A #1", "A #2"])) },
    { what: "chase bcc, all singular", body: bccBody({ ...chaseBcc, entryCounts: [1, 1] }) },
    { what: "chase bcc, someone plural", body: bccBody({ ...chaseBcc, entryCounts: [1, 3] }) },
    { what: "week reminder, early boundary", body: remindEarly() },
    { what: "week reminder, late boundary", body: remindLate() },
  ];
  for (const names of [["Pumpy321"], ["Caroline #1", "Caroline #2"]]) {
    const built = pickRequest(names);
    asks.push({ what: `pick request text, ${names.length} entry`, body: built.text });
    asks.push({ what: `pick request html, ${names.length} entry`, body: built.html });
  }
  // The footer has an owner, a player and a mixed branch. Building only owner
  // messages leaves a regression confined to a giftee's copy invisible, and a
  // giftee is exactly the person least able to ask Anthony what to do.
  for (const kind of ["owner", "player", "mixed"] as const) {
    const built = builtOfKind(kind);
    asks.push({ what: `pick request text, ${kind} recipient`, body: built.text });
    asks.push({ what: `pick request html, ${kind} recipient`, body: built.html });
  }
  return asks;
}

describe("player-facing copy", () => {
  it("never tells a player to submit a pick in the app", () => {
    for (const file of [PICK_REQUEST, CHASE, DISTRIBUTE, REMIND]) {
      const copy = copyOf(file);
      const hits = SENDS_THEM_TO_THE_APP.filter((re) => re.test(copy)).map(String);
      expect({ file, hits }).toEqual({ file, hits: [] });
    }
  });

  it("never puts the word submit anywhere near the app domain", () => {
    // Named explicitly because it is the exact shape the wrong draft took:
    // "Submit at ad-26-survivor.vercel.app". Prepositionless variants
    // ("submit ad-26-survivor.vercel.app") slip past the phrase list above,
    // so proximity is checked on its own.
    for (const file of [PICK_REQUEST, CHASE, DISTRIBUTE, REMIND]) {
      const copy = copyOf(file);
      const near = copy.match(
        new RegExp(`submit[\\s\\S]{0,80}?${APP_DOMAIN.source}|${APP_DOMAIN.source}[\\s\\S]{0,80}?submit`, "i"),
      );
      expect({ file, near: near?.[0] ?? null }).toEqual({ file, near: null });
    }
  });

  it("never links the site where a pick is asked for", () => {
    // The exemption is DISTRIBUTE and only DISTRIBUTE, and only after the
    // lock, when there is no pick left to ask for.
    for (const file of [PICK_REQUEST, CHASE]) {
      const src = read(file);
      expect({ file, url: APP_DOMAIN.test(literals(src)) }).toEqual({ file, url: false });
      expect({ file, siteUrl: /\bSITE_URL\b/.test(src) }).toEqual({ file, siteUrl: false });
    }
  });

  it("links the site in the week reminder on the not-the-app line and nowhere else", () => {
    // The second exemption, narrower than DISTRIBUTE's: the link may appear,
    // but only after the sentence that says picks are not made there. Checked
    // on the RENDERED bodies, every line, both boundaries.
    //
    // Since 2026-09-11 the plain part names the site rather than printing its
    // address, and the HTML part makes that word the one anchor. Both parts
    // are checked: holding only the plain one would let the HTML part grow a
    // second link nobody scanned.
    for (const [what, body, html] of [
      ["early", remindEarly(), remindEarlyHtml()],
      ["late", remindLate(), remindLateHtml()],
    ] as const) {
      const linked = body.split("\n").filter((l) => APP_DOMAIN.test(l));
      expect({ what, linked }).toEqual({ what, linked: [`${NOT_THE_APP} ${SITE_LINK_TEXT}`] });
      // And the denial itself is intact: nothing between "You do not make
      // picks in the app" and the link.
      expect(body).toContain(`You do not make picks in the app. It is there to look at: ${SITE_LINK_TEXT}`);
      // No address in front of a plain-text reader, and exactly one anchor in
      // front of everyone else.
      expect({ what, urls: body.match(/https?:\/\/[^\s]+/g) ?? [] }).toEqual({ what, urls: [] });
      expect({ what, anchors: html.match(/<a\s/g)?.length ?? 0 }).toEqual({ what, anchors: 1 });
      expect(html).toContain(siteAnchor());
    }
  });

  it("names both real paths in every message that asks for a pick", () => {
    // Reply and text are the two ways a pick can be sent, and both are
    // recorded (picks.source is 'email' or 'text'). A message that asks for a
    // pick and names only one tells the player the other does not count.
    //
    // These are the RENDERED messages, not the file's literals. Both modules
    // branch on singular and plural, and a file-wide scan stays green when
    // only one branch loses a path: the other branch still carries both words
    // somewhere in the file. Every branch a recipient can actually receive is
    // built here and checked on its own.
    //
    // The post-lock message is not among them, deliberately: by then there is
    // nothing left to ask for, and requiring a submission line in a results
    // email would be the opposite of the rule.
    const asks = pickAsks();
    for (const { what, body } of asks) {
      expect({
        what,
        reply: /reply to this/i.test(body),
        text: /\btext\b/i.test(body),
      }).toEqual({ what, reply: true, text: true });
    }
  });

  it("offers the text path without pointing at where the number is", () => {
    // "text the number below" was wrong: the footer renders after the block
    // that carries the number. Rather than fix the direction, drop it - the
    // number is in the message either way, and a positional word breaks again
    // the next time a block moves.
    for (const { what, body } of pickAsks()) {
      expect({ what, points: /\b(?:above|below)\b/i.test(body) }).toEqual({ what, points: false });
      expect({ what, hasNumber: body.includes(CONTACT_PHONE) }).toEqual({ what, hasNumber: true });
    }
  });

  it("puts no link in any message that asks for a pick", () => {
    // The literal scan above cannot see a URL that arrives indirectly - a
    // template importing GRID_URL from the post-lock module, say, and
    // interpolating it. The rendered bodies can: whatever a template imports,
    // the link is in the text by the time it reaches a player.
    //
    // mailto: and tel: are how the message says "reply" and "text", so they
    // are the two schemes that belong here. Anything web-shaped does not.
    for (const { what, body } of pickAsks()) {
      // The week reminder is the one ask allowed a link, on one line, and the
      // test above holds it to exactly that line; here it would only repeat
      // the exemption.
      if (what.startsWith("week reminder")) continue;
      expect({ what, links: body.match(/https?:\/\/[^\s"'<>]+/gi) ?? [] }).toEqual({
        what,
        links: [],
      });
      expect({ what, app: APP_DOMAIN.test(body) }).toEqual({ what, app: false });
    }
  });

  it("does ask for a reply, so the guards above are not passing on empty copy", () => {
    // Guards the guard: if a rename or a refactor moved the copy out of these
    // files, the two assertions above would pass on nothing at all.
    for (const file of [PICK_REQUEST, CHASE]) {
      expect({ file, asksForAReply: /reply to this/i.test(literals(read(file))) }).toEqual({
        file,
        asksForAReply: true,
      });
    }
  });
});
