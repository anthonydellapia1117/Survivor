import { describe, expect, it } from "vitest";
import { buildOutboundPicks, draftBody, LOCK_GAME_DAYS, selectForLock, type OutboundPick } from "../../scripts/lynne/lib/outbound";

const picks: OutboundPick[] = [
  { entryName: "E.A.T.", lynneNumber: 1004, lynneLabel: "E.A.T.", team: "SEA", gameDay: "Wednesday" },
  { entryName: "AAA #11", lynneNumber: null, lynneLabel: null, team: "DET", gameDay: "Sunday" },
  { entryName: "thedrick's picks", lynneNumber: 1087, lynneLabel: "thedrick's picks", team: "DET", gameDay: "Sunday" },
  { entryName: "AAA #9", lynneNumber: 980, lynneLabel: "AAA #9", team: "DET", gameDay: "Sunday" },
  { entryName: "Maria & Mary #2", lynneNumber: 1045, lynneLabel: "Maria & Mary #2", team: "KC", gameDay: "Monday" },
  { entryName: "Jim Teti #2", lynneNumber: 1013, lynneLabel: "Jim Teti  #2", team: "SKIP_WEEK", gameDay: null },
];

describe("selectForLock", () => {
  it("maps each lock day to the game days it closes", () => {
    expect(LOCK_GAME_DAYS.tue).toEqual(["Wednesday"]);
    expect(LOCK_GAME_DAYS.wed).toEqual(["Thursday"]);
    expect(LOCK_GAME_DAYS.thu).toEqual(["Friday"]);
    expect(LOCK_GAME_DAYS.fri).toEqual(["Saturday", "Sunday", "Monday"]);
  });
  it("gives only the tier's entries, in her numbering, with the full team name", () => {
    const r = selectForLock(picks, "tue");
    expect(r.lines).toEqual(["1004  E.A.T.  -  Seattle"]);
    expect(r.excluded).toEqual([]);
  });
  it("sorts by number, keeps her label byte-exact, and refuses an unnumbered entry by name", () => {
    const r = selectForLock(picks, "fri");
    expect(r.lines).toEqual([
      "980  AAA #9  -  Detroit",
      "1013  Jim Teti  #2  -  BYE",
      "1045  Maria & Mary #2  -  Kansas City",
      "1087  thedrick's picks  -  Detroit",
    ]);
    expect(r.excluded).toEqual([{ pick: picks[1], why: "no Lynne number on file" }]);
  });
  it("draft body is hyphens only and ends with his sign-off", () => {
    const body = draftBody(1, "tue", ["1004  E.A.T.  -  Seattle"]);
    expect(body).toContain("Week 1 picks - Tuesday noon lock (Wednesday game):");
    expect(body).not.toMatch(/[–—]/);
    expect(body.trimEnd().endsWith("Anthony")).toBe(true);
  });
});

import { lockDeadlineIso, fullTeamName } from "../../scripts/lynne/lib/outbound";

describe("lock deadline and her vocabulary", () => {
  const early = "2026-09-09T16:00:00.000Z";
  const late = "2026-09-11T16:00:00.000Z";
  it("closes each lock day at the tier CLAUDE.md gives it", () => {
    expect(lockDeadlineIso("tue", early, late)).toBe("2026-09-08T16:00:00.000Z");
    expect(lockDeadlineIso("wed", early, late)).toBe(early);
    expect(lockDeadlineIso("thu", early, late)).toBe("2026-09-10T16:00:00.000Z");
    expect(lockDeadlineIso("fri", early, late)).toBe(late);
  });
  it("writes teams the way her sheet does", () => {
    expect(fullTeamName("SEA")).toBe("Seattle");
    expect(fullTeamName("LAR")).not.toBe("LAR");
    expect(fullTeamName("SKIP_WEEK")).toBe("BYE");
  });
});

describe("her label", () => {
  it("uses our entry name when she holds no different label, and still refuses no number", () => {
    const r = selectForLock(
      [
        { entryName: "Pumpy321", lynneNumber: 1001, lynneLabel: null, team: "PHI", gameDay: "Sunday" },
        { entryName: "TNat", lynneNumber: null, lynneLabel: null, team: "PHI", gameDay: "Sunday" },
      ],
      "fri",
    );
    expect(r.lines).toEqual(["1001  Pumpy321  -  Philadelphia"]);
    expect(r.excluded.map((x) => x.why)).toEqual(["no Lynne number on file"]);
  });
});

describe("buildOutboundPicks", () => {
  const entries = [
    { id: "a", entry_name: "Pumpy321", lynne_number: 1001, lynne_label: null },
    { id: "b", entry_name: "E.A.T.", lynne_number: 1004, lynne_label: "E.A.T." },
    { id: "c", entry_name: "Nicco E", lynne_number: 1010, lynne_label: null },
    { id: "d", entry_name: "TNat", lynne_number: 1020, lynne_label: null },
  ];
  const current = [
    { entry_id: "a", team: "MISSED" },
    { entry_id: "b", team: "SEA" },
    { entry_id: "c", team: "KC" },
    { entry_id: "d", team: "DET" },
  ];
  const statusById = new Map([
    ["a", "active"],
    ["b", "at_risk"],
    ["c", "eliminated"],
  ]);
  const r = buildOutboundPicks(entries, current, statusById, (team) => (team === "SEA" ? "Wednesday" : "Sunday"));
  it("never forwards the sweep's MISSED row as a team", () => {
    expect(r.picks.map((p) => p.entryName)).not.toContain("Pumpy321");
    expect(r.skipped).toContainEqual({ entryName: "Pumpy321", team: "MISSED", why: "missed-pick sweep row, not a team" });
  });
  it("never forwards an eliminated entry's pick, and names it", () => {
    expect(r.picks.map((p) => p.entryName)).not.toContain("Nicco E");
    expect(r.skipped).toContainEqual({ entryName: "Nicco E", team: "KC", why: "eliminated (status eliminated)" });
  });
  it("refuses an entry with no standings row rather than assuming it alive", () => {
    expect(r.picks.map((p) => p.entryName)).not.toContain("TNat");
    expect(r.skipped.find((x) => x.entryName === "TNat")?.why).toMatch(/not on the standings/);
  });
  it("keeps an alive entry with its number, her label and its game day", () => {
    expect(r.picks).toEqual([{ entryName: "E.A.T.", lynneNumber: 1004, lynneLabel: "E.A.T.", team: "SEA", gameDay: "Wednesday" }]);
  });
});
