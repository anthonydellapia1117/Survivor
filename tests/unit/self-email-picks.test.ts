import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  conflictingSelfRows,
  isSelfPickSubject,
  parseSelfPickEmail,
  resolveSelfRef,
  selfPickReply,
  splitRefAndTeam,
  type SelfEntry,
} from "../../scripts/picks/lib/self-email";

// Anthony dictates picks he took by text or phone into a self-email. The
// ordinary intake cannot read his mailbox and must not: his free entries sit
// under his own owner row, so every self-sent copy would be read as picks.
// This grammar is the one narrow way in, and it is STRICT where the ordinary
// intake is forgiving - no fuzzy entry match, and a team must play that week.

const ENTRIES: SelfEntry[] = [
  { id: "e-1063", entryName: "Nolan Lawrence #1", lynneNumber: 1063 },
  { id: "e-1064", entryName: "Nolan Lawrence #2", lynneNumber: 1064 },
  { id: "e-1073", entryName: "rondro #1", lynneNumber: 1073 },
  { id: "e-dup1", entryName: "Twin", lynneNumber: 1100 },
  { id: "e-dup2", entryName: "twin", lynneNumber: 1101 },
];
// Week 1 as seeded: LAC, JAX, PIT and DET all play; BUF does not (bye).
const PLAYS = new Set(["LAC", "JAX", "PIT", "DET", "PHI", "SEA"]);

describe("the command itself", () => {
  const code = (f: string): string =>
    readFileSync(path.join(__dirname, "../..", f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

  it("checks the sender itself, and does not rely on the Gmail query alone", () => {
    const c = code("scripts/picks/self.ts");
    expect(c).toMatch(/m\.fromAddress\.trim\(\)\.toLowerCase\(\) !== ADMIN_MAILBOX/);
  });

  it("never sends - the reply is a draft, and the send path is not imported", () => {
    const c = code("scripts/picks/self.ts");
    expect(c).toMatch(/createDraft\(/);
    expect(c).not.toMatch(/sendAllowlisted|sendWeekReminder|from "\.\.\/lib\/send"/);
  });

  it("is a separate command, so nothing in it can change what the hourly sweep does", () => {
    // scripts/picks/cli.ts is the sweep. It must not import this grammar.
    expect(code("scripts/picks/cli.ts")).not.toMatch(/self-email/);
  });
});

describe("the subject gate", () => {
  it("takes Survivor as a whole word, any case, and nothing else", () => {
    expect(isSelfPickSubject("Survivor week 1 picks")).toBe(true);
    expect(isSelfPickSubject("re: SURVIVOR")).toBe(true);
    expect(isSelfPickSubject("Week 1 picks")).toBe(false);
    expect(isSelfPickSubject("survivors of the storm")).toBe(false);
    expect(isSelfPickSubject("")).toBe(false);
  });
});

describe("the team is taken from the END of the line, longest match first", () => {
  it("keeps a multi-word city with the team, not with the reference", () => {
    expect(splitRefAndTeam("1073 Los Angeles Chargers")).toEqual({ ref: "1073", team: "LAC" });
    expect(splitRefAndTeam("1073 LAC")).toEqual({ ref: "1073", team: "LAC" });
    expect(splitRefAndTeam("1073 Chargers")).toEqual({ ref: "1073", team: "LAC" });
    // The entry name carries a number and a hash and still survives the split.
    expect(splitRefAndTeam("Nolan Lawrence #1 Chargers")).toEqual({ ref: "Nolan Lawrence #1", team: "LAC" });
  });

  it("returns nothing when the tail is not a team", () => {
    expect(splitRefAndTeam("1073 whoever")).toBeNull();
    expect(splitRefAndTeam("LAC")).toBeNull();
  });
});

describe("a number is EXACT and a name is exact-or-nothing", () => {
  it("takes a Lynne number only when a live entry carries it", () => {
    expect(resolveSelfRef("1073", ENTRIES)).toMatchObject({ id: "e-1073" });
    expect(resolveSelfRef("9999", ENTRIES)).toEqual({ reason: "no live entry carries Lynne number 9999" });
    // Never a near number: 1072 is not 1073.
    expect(resolveSelfRef("1072", ENTRIES)).toEqual({ reason: "no live entry carries Lynne number 1072" });
  });

  it("matches a name on case and edge whitespace only, and NEVER fuzzily", () => {
    expect(resolveSelfRef("  nolan lawrence #1 ", ENTRIES)).toMatchObject({ id: "e-1063" });
    // A typo, a partial and an owner name are all refusals - the ordinary
    // intake would resolve these and this deliberately does not.
    for (const bad of ["Nolan Lawrance #1", "Nolan Lawrence", "Nolan", "rondro"]) {
      expect(resolveSelfRef(bad, ENTRIES), bad).toHaveProperty("reason");
    }
  });

  it("refuses a name two live entries share, and says to use the number", () => {
    expect(resolveSelfRef("TWIN", ENTRIES)).toEqual({
      reason: '2 live entries are named "TWIN" - use the Lynne number',
    });
  });
});

describe("a team must play that week", () => {
  it("applies a line whose team has a game and stages one whose team does not", () => {
    const rows = parseSelfPickEmail("1073 LAC\n1064 BUF", 1, ENTRIES, PLAYS);
    expect(rows[0]).toMatchObject({ ok: true, entryId: "e-1073", team: "LAC" });
    expect(rows[1]).toEqual({ ok: false, line: "1064 BUF", reason: "BUF has no game in week 1" });
  });

  it("stages a bye rather than writing one", () => {
    const rows = parseSelfPickEmail("1073 bye", 1, ENTRIES, PLAYS);
    expect(rows[0]).toMatchObject({ ok: false });
    expect((rows[0] as { reason: string }).reason).toMatch(/bye is not entered this way/);
  });
});

describe("the whole message", () => {
  it("reads Anthony's eight, numbers and names alike, and skips blank and bulleted lines", () => {
    const body = "\n1073 LAC\n- Nolan Lawrence #2 Detroit Lions\n\n1) rondro #1 Jaguars\n";
    const rows = parseSelfPickEmail(body, 1, ENTRIES, PLAYS);
    expect(rows.map((r) => (r.ok ? `${r.entryId}:${r.team}` : `stage:${r.reason}`))).toEqual([
      "e-1073:LAC",
      "e-1064:DET",
      "e-1073:JAX",
    ]);
  });

  it("flags an entry given two different teams in one message", () => {
    const rows = parseSelfPickEmail("1073 LAC\nrondro #1 JAX", 1, ENTRIES, PLAYS);
    expect([...conflictingSelfRows(rows)]).toEqual(["e-1073"]);
    // One entry named twice with the SAME team is not a conflict.
    expect([...conflictingSelfRows(parseSelfPickEmail("1073 LAC\nrondro #1 LAC", 1, ENTRIES, PLAYS))]).toEqual([]);
  });

  it("replies in under ten lines however long the message was", () => {
    // BOTH halves long, or the cap is never reached: a header, four applied,
    // an "and N more", three staged and an "and N more" is ten lines before
    // the slice, which is what makes this test able to fail.
    const many = [
      ...Array.from({ length: 40 }, () => "1073 LAC"),
      ...Array.from({ length: 40 }, (_, i) => `99${i} LAC`),
    ].join("\n");
    const rows = parseSelfPickEmail(many, 1, ENTRIES, PLAYS);
    expect(rows.filter((r) => r.ok).length).toBe(40);
    expect(rows.filter((r) => !r.ok).length).toBe(40);
    const reply = selfPickReply(rows, 1);
    expect(reply.split("\n").length).toBeLessThanOrEqual(9);
    expect(reply.split("\n")[0]).toBe("Week 1: 40 applied, 40 staged.");
  });
});
