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

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(here(rel), "utf8");

// Every module that puts words in front of a player.
const PICK_REQUEST = "../../src/lib/emails/pick-request.ts";
const CHASE = "../../scripts/chase/lib/message.ts";
// Post-lock standings. This one MAY carry the site link: it points at /grid,
// which shows picks as their games kick off. A results link is not a
// submission instruction, so it is exempt from the link rule below and held
// to the phrase rule like the rest.
const DISTRIBUTE = "../../scripts/distribute/lib/message.ts";

function literals(src: string): string {
  const found = src.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`/g) ?? [];
  return found.join("\n");
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

describe("player-facing copy", () => {
  it("never tells a player to submit a pick in the app", () => {
    for (const file of [PICK_REQUEST, CHASE, DISTRIBUTE]) {
      const copy = literals(read(file));
      const hits = SENDS_THEM_TO_THE_APP.filter((re) => re.test(copy)).map(String);
      expect({ file, hits }).toEqual({ file, hits: [] });
    }
  });

  it("never puts the word submit anywhere near the app domain", () => {
    // Named explicitly because it is the exact shape the wrong draft took:
    // "Submit at ad-26-survivor.vercel.app". Prepositionless variants
    // ("submit ad-26-survivor.vercel.app") slip past the phrase list above,
    // so proximity is checked on its own.
    for (const file of [PICK_REQUEST, CHASE, DISTRIBUTE]) {
      const copy = literals(read(file));
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
