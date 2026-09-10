import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  conflictingSelfRows,
  guardSelfRows,
  stageKindFor,
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

// The three guards the PARSER cannot apply, because they need the entry's own
// history: admin_submit_pick knows none of them (it supersedes whatever is
// current and it has never heard of a repeated team), so a dictated line only
// meets them if guardSelfRows applies them first.
describe("the guards the parser cannot apply", () => {
  const LATE = "2026-09-11T18:00:00Z";
  const ctx = (over: Partial<Parameters<typeof guardSelfRows>[1]> = {}) => ({
    currentByEntry: new Map(),
    priorByEntry: new Map(),
    madeAt: new Date("2026-09-11T12:00:00Z"),
    lateDeadlineIso: LATE,
    ...over,
  });
  const one = (body: string, over = {}) => guardSelfRows(parseSelfPickEmail(body, 2, ENTRIES, PLAYS), ctx(over))[0];

  it("stages a team the entry already used, because a repeat is an elimination in her pool", () => {
    const r = one("1073 LAC", { priorByEntry: new Map([["e-1073", new Map([["LAC", 1]])]]) });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/already used in week 1.*ELIMINATION/);
    // It still carries the entry and team, so it stages as a pick Anthony can approve.
    expect(r).toMatchObject({ entryId: "e-1073", team: "LAC" });
  });

  it("stages rather than overwriting a pick that is already scored", () => {
    const cur = new Map([["e-1073", { team: "PHI", submitted_at: "2026-09-11T09:00:00Z", result: "win" }]]);
    const r = one("1073 LAC", { currentByEntry: cur });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/already scored/);
  });

  it("stages a change that arrives after the lock, and lets one that beat it through", () => {
    const cur = new Map([["e-1073", { team: "PHI", submitted_at: "2026-09-11T09:00:00Z", result: "pending" }]]);
    expect(one("1073 LAC", { currentByEntry: cur, madeAt: new Date("2026-09-11T19:00:00Z") }).ok).toBe(false);
    expect(one("1073 LAC", { currentByEntry: cur, madeAt: new Date("2026-09-11T13:00:00Z") }).ok).toBe(true);
  });

  // Re-sending the team an entry ALREADY holds is the one case that must not
  // be written: admin_submit_pick supersedes unconditionally and stamps the
  // new row pending, so a harmless resend would erase a scored result.
  it("treats the same team already on file as a no-op - not written, not staged", () => {
    const cur = new Map([["e-1073", { team: "LAC", submitted_at: "2026-09-11T09:00:00Z", result: "win" }]]);
    const r = one("1073 LAC", { currentByEntry: cur, madeAt: new Date("2026-09-11T19:00:00Z") });
    expect(r.ok).toBe(false);
    expect((r as { noop?: true }).noop).toBe(true);
    expect((r as { reason: string }).reason).toMatch(/already on file as LAC/);
  });

  // A row staged as kind "pick" promises Approve will write it, and
  // admin_approve_pending refuses a scored or superseded pick outright - so
  // those two have to be questions or they sit open behind a button that
  // always errors.
  it("stages a scored or superseded refusal as a question, and everything else as a pick", () => {
    expect(stageKindFor("scored")).toBe("player_question");
    expect(stageKindFor("stale")).toBe("player_question");
    expect(stageKindFor("after_lock")).toBe("pick");
    expect(stageKindFor("repeat")).toBe("pick");
    expect(stageKindFor("conflict")).toBe("pick");

    const cur = new Map([["e-1073", { team: "PHI", submitted_at: "2026-09-11T09:00:00Z", result: "loss" }]]);
    expect(one("1073 LAC", { currentByEntry: cur })).toMatchObject({ stageAs: "player_question" });
    expect(one("1073 LAC", { priorByEntry: new Map([["e-1073", new Map([["LAC", 1]])]]) }))
      .toMatchObject({ stageAs: "pick" });
  });
});

describe("what the command and the migration wire up", () => {
  const code = (f: string): string => readFileSync(path.join(__dirname, "../..", f), "utf8");

  it("takes its roster from aliveEntries, so an eliminated entry cannot be dictated a pick", () => {
    const c = code("scripts/picks/self.ts");
    expect(c).toMatch(/aliveEntries\(await loadLiveEntries\(client\), await loadStandings\(client\)\)/);
  });

  it("sends the receipt time and the staged rows to the RPC", () => {
    const c = code("scripts/picks/self.ts");
    expect(c).toMatch(/submitted_at: m\.receivedAt/);
    expect(c).toMatch(/p_staged: toStage/);
  });

  it("files a message that produced nothing, so the same mail is not read again every run", () => {
    const c = code("scripts/picks/self.ts").replace(/\/\/[^\n]*/g, " ");
    const i = c.indexOf("!toWrite.length && !toStage.length");
    const j = c.indexOf("continue;", i);
    expect(i).toBeGreaterThan(-1);
    expect(c.slice(i, j)).toMatch(/fileMessage\(m\.id\)/);
  });

  it("keeps a no-op out of both the writes and the queue", () => {
    const c = code("scripts/picks/self.ts");
    expect(c).toMatch(/!r\.ok && r\.noop !== true/);
  });

  // The pick editor is /admin/picks. /admin/entries edits entry metadata and
  // has no pick field, so sending him there leaves the correction unmade and
  // the row dismissed.
  it("sends a refusal the queue cannot write to the screen that can write it", () => {
    // The prompt's OWN line, not a window of characters around it: a window
    // sized to today's wording either drops the route when the sentence grows
    // or picks one up from the comment above, and a guard that can pass or
    // fail for the wrong reason is worse than none.
    const line = code("scripts/picks/self.ts")
      .split("\n")
      .find((l) => l.includes("Approve cannot write this one"));
    expect(line).toBeDefined();
    expect(line).toMatch(/\/admin\/picks/);
    expect(line).not.toMatch(/\/admin\/entries/);
  });

  it("refuses a blank actor, so nothing it audits is untraceable", () => {
    expect(code("supabase/migrations/20260911000067_self_pick_email.sql"))
      .toMatch(/coalesce\(trim\(p_actor\), ''\) = ''/);
  });

  it("stops on a replay before drafting a reply that would claim rows were applied", () => {
    const c = code("scripts/picks/self.ts").replace(/\/\/[^\n]*/g, " ");
    const i = c.indexOf("result.already_applied");
    const j = c.indexOf("createDraft(gmail");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(c.slice(i, j)).toMatch(/continue;/);
  });

  it("calls the six-argument admin_submit_pick and really stages what it reports staged", () => {
    const sql = code("supabase/migrations/20260911000067_self_pick_email.sql");
    expect(sql).toMatch(/admin_submit_pick\(r\.entry_id, r\.week, r\.team, 'text', p_actor, r\.submitted_at\)/);
    expect(sql).toMatch(/perform admin_stage_pending\(/);
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\('self_pick_email:/);
  });
});
