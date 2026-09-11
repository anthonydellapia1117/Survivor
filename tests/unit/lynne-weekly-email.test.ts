// The Friday picks email to Lynne.
//
// THE CONVENTION IS ANTHONY'S, AS SENT on 2026-09-11 at 5:56 PM ET, and this
// holds the shape to it: subject DellaPia_Week<N>_Picks matching the CSV
// filename exactly, the table in the body AND the same rows attached, To her
// and Bcc him. She replied "Got it."

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  weeklyPicksBody,
  weeklyPicksFilename,
  weeklyPicksStem,
  weeklyPicksSubject,
} from "@/lib/lynne/weekly-email";
import { encodeRaw } from "../../scripts/lib/gmail";
import { SITE_LINK_HREF, SITE_LINK_TEXT } from "../../scripts/lib/site-link";

const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

describe("the subject matches the filename exactly", () => {
  it("is DellaPia_Week<N>_Picks, underscores and all", () => {
    expect(weeklyPicksSubject(1)).toBe("DellaPia_Week1_Picks");
    expect(weeklyPicksFilename(1)).toBe("DellaPia_Week1_Picks.csv");
    // The point of the convention: one string, two uses.
    for (const w of [1, 2, 9, 18]) {
      expect(weeklyPicksFilename(w)).toBe(`${weeklyPicksSubject(w)}.csv`);
      expect(weeklyPicksStem(w)).toBe(weeklyPicksSubject(w));
    }
  });
});

describe("the body", () => {
  const body = weeklyPicksBody({
    week: 2,
    table: "NO.  NAMES  Week 2\n972  AAA #1  Detroit",
    rowCount: 121,
  });

  it("says how many picks and carries the table", () => {
    expect(body).toContain("Below are my 121 picks for Week 2.");
    expect(body).toContain("Picks below and attached:");
    expect(body).toContain("972  AAA #1  Detroit");
  });

  it("carries the ONE LINK by name, with no address in the plain part", () => {
    expect(body).toContain(SITE_LINK_TEXT);
    expect(body, "a bare URL in front of a reader is the thing the rule forbids")
      .not.toContain(SITE_LINK_HREF);
    expect(body.split(SITE_LINK_TEXT).length - 1, "exactly once").toBe(1);
  });

  it("invents no signature", () => {
    // Gmail appends his own when he opens the draft. Generating one would be
    // this repo deciding how he signs off.
    expect(body).not.toContain("Anthony DellaPia");
    expect(body).not.toContain("215");
  });
});

describe("what the draft actually carries", () => {
  const csv = "NO.,NAMES,Week 2\n972,AAA #1,Detroit\n";
  const raw = decode(
    encodeRaw({
      to: ["lynnepiazza10@gmail.com"],
      bcc: ["anthonydellapia@gmail.com"],
      subject: weeklyPicksSubject(2),
      body: "b",
      html: "<p>b</p>",
      attachments: [
        { filename: weeklyPicksFilename(2), mimeType: "text/csv", content: csv },
      ],
    }),
  );

  it("is multipart/mixed: the body AND the file", () => {
    expect(raw).toContain("Content-Type: multipart/mixed");
    // The body keeps its own plain/HTML choice inside the mixed wrapper.
    expect(raw).toContain("Content-Type: multipart/alternative");
    expect(raw).toContain('Content-Disposition: attachment; filename="DellaPia_Week2_Picks.csv"');
    expect(raw).toContain("Content-Transfer-Encoding: base64");
  });

  it("carries the CSV's real bytes", () => {
    expect(raw).toContain(Buffer.from(csv, "utf8").toString("base64"));
  });

  it("goes To Lynne and Bcc Anthony", () => {
    expect(raw).toContain("To: lynnepiazza10@gmail.com");
    expect(raw).toContain("Bcc: anthonydellapia@gmail.com");
  });

  it("leaves a message with NO attachment byte-identical to before", () => {
    const a = encodeRaw({ to: ["x@example.com"], subject: "s", body: "b" });
    const b = encodeRaw({ to: ["x@example.com"], subject: "s", body: "b", attachments: [] });
    expect(a).toBe(b);
    expect(decode(a)).not.toContain("multipart/mixed");
  });
});

describe("the job and the command", () => {
  const cfg = JSON.parse(readFileSync("scripts/ops/config.json", "utf8"));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  it("fires Friday 5:30 PM ET, and never sends", () => {
    const j = cfg.jobs["lynne-weekly"];
    expect(j.scheduleEt, "ET, because 5:30 PM is a different UTC hour in EST")
      .toEqual(["30 17 * * 5"]);
    expect(j.schedule, "never a fixed UTC cron").toBeUndefined();
    expect(j.sends).toBe(false);
    expect(j.command).toBe("lynne:weekly");
  });

  it("is a real npm script that only ever drafts", () => {
    expect(pkg.scripts["lynne:weekly"]).toBe("tsx scripts/lynne/weekly.ts");
    const src = readFileSync("scripts/lynne/weekly.ts", "utf8");
    expect(src).toContain("createDraft(");
    expect(src, "nothing here sends").not.toContain("messages.send");
    expect(src).not.toContain("sendAllowlisted");
  });

  it("builds its rows from EVERY live entry", () => {
    const src = readFileSync("scripts/lynne/weekly.ts", "utf8");
    expect(src).toContain("buildSubmitRows(live, pickByEntry, numberById)");
    // And says so against the live count, because the old builder dropped rows.
    expect(src).toContain("rows for ${live.length} live entries");
  });
});
