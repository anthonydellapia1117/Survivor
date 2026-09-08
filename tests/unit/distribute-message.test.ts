import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lockPassed } from "../../scripts/distribute/lib/lock";
import { distributeMessage, GRID_URL } from "../../scripts/distribute/lib/message";
import { countStandings, standingsSentence, type StandingInput } from "../../scripts/distribute/lib/standings";
import { SITE_URL } from "../../scripts/lib/constants";
import type { WeekBounds } from "../../scripts/picks/lib/deadline";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const WEEK1: WeekBounds = {
  week: 1,
  earlyDeadlineAt: "2026-09-09T16:00:00+00:00",
  lateDeadlineAt: "2026-09-11T16:00:00+00:00",
};

describe("lockPassed", () => {
  it("is false one second before the late deadline", () => {
    expect(lockPassed(WEEK1, new Date("2026-09-11T15:59:59Z"))).toBe(false);
  });

  it("is true one second after the late deadline", () => {
    expect(lockPassed(WEEK1, new Date("2026-09-11T16:00:01Z"))).toBe(true);
  });

  it("is true at the deadline itself: 'earlier than' is the refusal, not 'at'", () => {
    expect(lockPassed(WEEK1, new Date("2026-09-11T16:00:00Z"))).toBe(true);
  });

  it("does not open on the early deadline: the week locks at the LATE one", () => {
    // Wednesday noon has passed, Friday noon has not. The Sunday picks are
    // still private, so the message that says they are posted must wait.
    expect(lockPassed(WEEK1, new Date("2026-09-10T12:00:00Z"))).toBe(false);
  });
});

// A known mix: two clean, one at risk on a loss, one clean but bye burned,
// one bye-eligible (still no losses), and two out - one by two losses, one
// by a loss with the bye already used.
const ROWS: StandingInput[] = [
  { status: "active", losses: 0, byeUsed: false },
  { status: "active", losses: 0, byeUsed: false },
  { status: "at_risk", losses: 1, byeUsed: false },
  { status: "active", losses: 0, byeUsed: true },
  { status: "bye_eligible", losses: 0, byeUsed: false },
  { status: "eliminated", losses: 2, byeUsed: false },
  { status: "eliminated", losses: 1, byeUsed: true },
];
const EXPECTED = "No Losses=3, 1 Loss/Bye used=2 and Out=2. We are down to 5 left in the pool.";

describe("the standings sentence", () => {
  it("counts the buckets and the survivors", () => {
    expect(countStandings(ROWS)).toEqual({ noLosses: 3, lossBye: 2, out: 2, alive: 5 });
  });

  it("is the exact expected string for a known mix", () => {
    expect(standingsSentence(countStandings(ROWS))).toBe(EXPECTED);
  });

  it("reads all zero for an empty roster rather than throwing", () => {
    expect(standingsSentence(countStandings([]))).toBe(
      "No Losses=0, 1 Loss/Bye used=0 and Out=0. We are down to 0 left in the pool.",
    );
  });

  it("uses the dashboard's template, read from src/app/page.tsx", () => {
    // The dashboard builds the same sentence inline. Neither file imports
    // the other, so the only way to notice a drift is to read the page's
    // source and compare the static text between the interpolations.
    const page = read("src/app/page.tsx");
    const found = /`No Losses=[^`]*`/.exec(page);
    expect(found, "dashboard sentence not found in src/app/page.tsx").not.toBeNull();
    const literal = found![0].slice(1, -1);
    const MARK = "\u0000";
    const pageSegments = literal.replace(/\$\{[^}]*\}/g, MARK).split(MARK);
    // Sentinel counts that appear nowhere in the fixed text, so replacing
    // them leaves exactly the fixed text.
    const ours = standingsSentence({ noLosses: 101, lossBye: 202, out: 303, alive: 404 });
    const ourSegments = ours.replace(/101|202|303|404/g, MARK).split(MARK);
    expect(ourSegments).toEqual(pageSegments);
    // And the four slots are filled in the same order.
    const slots = [...literal.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]);
    expect(slots).toHaveLength(4);
    expect(slots[0]).toContain("No Losses");
    expect(slots[1]).toContain("Loss/Bye");
    expect(slots[2]).toContain("Out");
    expect(slots[3]).toContain("alive");
  });
});

describe("distributeMessage", () => {
  const msg = distributeMessage(3, countStandings(ROWS));

  it("has a subject that says Survivor and names the week", () => {
    expect(msg.subject).toContain("Survivor");
    expect(msg.subject).toBe("Survivor - Week 3 picks posted");
  });

  it("links the grid on the only public URL", () => {
    expect(GRID_URL).toBe("https://ad-26-survivor.vercel.app/grid");
    expect(GRID_URL).toBe(`${SITE_URL}/grid`);
    expect(msg.body).toContain(GRID_URL);
  });

  it("is the link, the standings sentence and the sign-off, nothing else", () => {
    expect(msg.body).toBe(`Week 3 picks are locked. Each one posts on the grid as its game kicks off: ${GRID_URL}\n\n${EXPECTED}\n\nAD\n`);
    expect(msg.body.trimEnd().endsWith("\nAD")).toBe(true);
  });

  it("says nothing about money, recruited or free entries", () => {
    // Public surfaces carry none of this group's finances and no
    // recruited-vs-free split. A group send is a public surface.
    for (const text of [msg.subject, msg.body]) {
      expect(text).not.toMatch(/\$|\d+\s*dollars|money|paid|owe|due|recruit|free|margin|venmo/i);
    }
  });

  it("carries no entry names or per-owner detail: counts only", () => {
    // Everything numeric in the body, once the link and the week are taken
    // out, is the three buckets and the survivor count. The "1" is the fixed
    // "1 Loss/Bye used" label, not a count.
    const numbers = msg.body.replace(GRID_URL, "").replace("Week 3", "").match(/\d+/g) ?? [];
    expect(numbers).toEqual(["3", "1", "2", "2", "5"]);
  });
});

describe("hyphens only", () => {
  // Every line a human reads from this command, and the code that builds it.
  const FILES = [
    "scripts/distribute/cli.ts",
    "scripts/distribute/lib/lock.ts",
    "scripts/distribute/lib/message.ts",
    "scripts/distribute/lib/recipients.ts",
    "scripts/distribute/lib/standings.ts",
  ];

  it("no em dash or en dash in the message", () => {
    const msg = distributeMessage(1, countStandings(ROWS));
    expect(msg.subject).not.toMatch(/[–—]/);
    expect(msg.body).not.toMatch(/[–—]/);
    expect(standingsSentence(countStandings(ROWS))).not.toMatch(/[–—]/);
  });

  it("no em dash, en dash or emoji anywhere in the command's source", () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/[–—]/);
      expect(src, f).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  it("premise: the refusal line and the draft line are still in the CLI", () => {
    // If the wording moved out of cli.ts, the source scan above would be
    // scanning the wrong file and pass by vacuum.
    const cli = read("scripts/distribute/cli.ts");
    expect(cli).toContain("refusalBeforeLock(");
    const lock = readFileSync(join(__dirname, "../../scripts/distribute/lib/lock.ts"), "utf8");
    expect(lock).toContain("distribute runs after the lock.");
    expect(cli).toContain("Not sent: open Gmail, check it, send it yourself.");
    expect(cli).toContain("includeGiftedPlayers: true");
  });
});

import { refusalBeforeLock } from "../../scripts/distribute/lib/lock";

describe("refusalBeforeLock", () => {
  it("refuses one second before the lock with the time, and is null at and after it", () => {
    expect(refusalBeforeLock(WEEK1, new Date("2026-09-11T15:59:59Z"))).toBe("Week 1 locks at Fri Sep 11 12:00 PM ET; distribute runs after the lock.");
    expect(refusalBeforeLock(WEEK1, new Date("2026-09-11T16:00:00Z"))).toBeNull();
    expect(refusalBeforeLock(WEEK1, new Date("2026-09-12T16:00:00Z"))).toBeNull();
  });
});
