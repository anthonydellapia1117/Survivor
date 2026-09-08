import { describe, expect, it } from "vitest";
import { draftBody, LOCK_GAME_DAYS, selectForLock, type OutboundPick } from "../../scripts/lynne/lib/outbound";

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
    expect(r.lines).toEqual(["1004  E.A.T.  -  Seattle Seahawks"]);
    expect(r.excluded).toEqual([]);
  });
  it("sorts by number, keeps her label byte-exact, and refuses an unnumbered entry by name", () => {
    const r = selectForLock(picks, "fri");
    expect(r.lines).toEqual([
      "980  AAA #9  -  Detroit Lions",
      "1013  Jim Teti  #2  -  BYE",
      "1045  Maria & Mary #2  -  Kansas City Chiefs",
      "1087  thedrick's picks  -  Detroit Lions",
    ]);
    expect(r.excluded).toEqual([{ pick: picks[1], why: "no Lynne number on file" }]);
  });
  it("draft body is hyphens only and ends with his sign-off", () => {
    const body = draftBody(1, "tue", ["1004  E.A.T.  -  Seattle Seahawks"]);
    expect(body).toContain("Week 1 picks - Tuesday noon lock (Wednesday game):");
    expect(body).not.toMatch(/[–—]/);
    expect(body.trimEnd().endsWith("Anthony")).toBe(true);
  });
});
