import { describe, expect, it } from "vitest";
import {
  deriveWeekResults,
  herCellIsOurPick,
  predictedMark,
  priorStandingOf,
  priorStandingText,
  resultClass,
  type DerivedResult,
  type MarkResultsInput,
  type PriorPick,
  type PriorStanding,
  type WeekPick,
} from "../../src/lib/lynne/mark-results";
import { derivedStandingOf, type MarkRow } from "../../src/lib/lynne/mark-variance";

// The week's result derived from her fill mark and the stored prior record.
// Set by Anthony on 2026-09-15: "Write her Week 1 results to picks.result for
// our 121, from her Final Sheet, audited. She is the elimination authority
// and that field is where her authority lives." Every branch of the rule is
// exercised here with real teams in the shape the plan produces; each guard
// was broken on purpose before it was trusted (see the commit).

const row = (no: number, entryId: string, fill: MarkRow["fill"], weekCellText: string | null = "LA Chargers"): MarkRow => ({
  entryId,
  no,
  entryName: `entry ${entryId}`,
  fill,
  weekCellText,
});
const pick = (entryId: string, team: string, result: string | null = "pending"): WeekPick => ({ entryId, team, result });
const prior = (entryId: string, week: number, team: string, result: string | null): PriorPick => ({ entryId, week, team, result });

function derive(over: Partial<MarkResultsInput>) {
  return deriveWeekResults({
    marks: [],
    currentPicks: [],
    priorPicks: [],
    week: 2,
    doubleElimThrough: 7,
    ...over,
  });
}

const NONE: PriorStanding = { losses: 0, bye: false, lateLoss: false };
const ONE_LOSS: PriorStanding = { losses: 1, bye: false, lateLoss: false };
const A_BYE: PriorStanding = { losses: 0, bye: true, lateLoss: false };
const LOSS_AND_BYE: PriorStanding = { losses: 1, bye: true, lateLoss: false };

describe("what the row spent before the week", () => {
  it("counts a stored loss, tie_loss or missed as a loss, a bye as a bye, and never adds the two into one number", () => {
    expect(priorStandingOf([], 7)).toEqual(NONE);
    expect(priorStandingOf([prior("a", 1, "PHI", "win")], 7)).toEqual(NONE);
    expect(priorStandingOf([prior("a", 1, "LAC", "loss")], 7)).toEqual(ONE_LOSS);
    expect(priorStandingOf([prior("a", 1, "GB", "tie_loss")], 7)).toEqual(ONE_LOSS);
    expect(priorStandingOf([prior("a", 1, "MISSED", "missed")], 7)).toEqual(ONE_LOSS);
    expect(priorStandingOf([prior("a", 1, "PHI", "win"), prior("a", 8, "SKIP_WEEK", "bye")], 7)).toEqual(A_BYE);
    // A bye beside a loss is one loss AND a bye, kept apart. The first
    // version added them into two lives and read the row OUT, which neither
    // derivedStandingOf nor poolBucketOf does.
    expect(priorStandingOf([prior("a", 1, "LAC", "loss"), prior("a", 8, "SKIP_WEEK", "pending")], 7)).toEqual(LOSS_AND_BYE);
  });

  it("marks a loss or missed week past the boundary as terminal on its own", () => {
    expect(priorStandingOf([prior("a", 9, "LAC", "loss")], 7)).toEqual({ losses: 1, bye: false, lateLoss: true });
    expect(priorStandingOf([prior("a", 9, "MISSED", "missed")], 7)).toEqual({ losses: 1, bye: false, lateLoss: true });
    expect(priorStandingOf([prior("a", 7, "LAC", "loss")], 7)).toEqual(ONE_LOSS);
  });

  it("is unknown while a prior pick on a real team is still pending", () => {
    expect(priorStandingOf([prior("a", 1, "PHI", "pending")], 7)).toBeNull();
    expect(priorStandingOf([prior("a", 1, "PHI", null)], 7)).toBeNull();
    // A MISSED pick is a loss whatever its stored result says.
    expect(priorStandingOf([prior("a", 1, "MISSED", "pending")], 7)).toEqual(ONE_LOSS);
  });

  it("is written out in words for a conflict's local side", () => {
    expect(priorStandingText(NONE)).toBe("0 losses and no bye");
    expect(priorStandingText(ONE_LOSS)).toBe("1 loss and no bye");
    expect(priorStandingText(LOSS_AND_BYE)).toBe("1 loss and a bye");
    expect(priorStandingText({ losses: 2, bye: false, lateLoss: true })).toBe("2 losses (one past the boundary) and no bye");
  });
});

describe("what her mark would read for a candidate result", () => {
  it("a win keeps the row where it was, a loss or missed week adds a loss, a bye is her yellow, and two losses is OUT", () => {
    expect(predictedMark("win", NONE, 2, 7)).toBe("clean");
    expect(predictedMark("loss", NONE, 2, 7)).toBe("loss");
    expect(predictedMark("bye", NONE, 8, 7)).toBe("loss");
    expect(predictedMark("missed", NONE, 2, 7)).toBe("loss");
    expect(predictedMark("win", ONE_LOSS, 2, 7)).toBe("loss");
    expect(predictedMark("loss", ONE_LOSS, 2, 7)).toBe("out");
    expect(predictedMark("win", { losses: 2, bye: false, lateLoss: false }, 3, 7)).toBe("out");
  });

  it("a bye beside a loss is her 1 LOSS/BYE bucket, not OUT - the reading the other two readers of her fill share", () => {
    // Unreachable through admin_submit_pick (a bye is refused after a loss
    // inside the boundary, and a loss past it is terminal); held so the three
    // readers cannot drift apart on it. Confirmed to FAIL with the bye added
    // into the loss count.
    expect(predictedMark("bye", ONE_LOSS, 9, 7)).toBe("loss");
    expect(predictedMark("win", LOSS_AND_BYE, 10, 7)).toBe("loss");
    expect(predictedMark("win", A_BYE, 9, 7)).toBe("loss");
  });

  it("a first loss or missed week past the double-elimination boundary is OUT outright", () => {
    expect(predictedMark("loss", NONE, 8, 7)).toBe("out");
    expect(predictedMark("missed", NONE, 8, 7)).toBe("out");
    expect(predictedMark("loss", NONE, 7, 7)).toBe("loss");
    expect(predictedMark("win", NONE, 8, 7)).toBe("clean");
    expect(predictedMark("loss", A_BYE, 9, 7)).toBe("out");
  });

  it("a row already out on a prior loss past the boundary reads OUT whatever this week did", () => {
    const late: PriorStanding = { losses: 1, bye: false, lateLoss: true };
    expect(predictedMark("win", late, 10, 7)).toBe("out");
    expect(predictedMark("loss", late, 10, 7)).toBe("out");
  });

  it("loss and tie_loss are one class", () => {
    expect(resultClass("tie_loss")).toBe("loss");
    expect(resultClass("loss")).toBe("loss");
    expect(resultClass("win")).toBe("win");
  });
});

describe("the derivation and the read-only comparison read her fill with ONE vocabulary", () => {
  // derivedStandingOf (mark-variance.ts) reads a row's standing from its
  // picks and the finals; predictedMark reads the same standing with the
  // week's result supplied instead of scored. For every record the rules
  // engine can hold, the two must agree - or a row's derivation and its own
  // comparison line could call her mark two different things. Confirmed to
  // FAIL with a bye added into the loss count, and with the late loss
  // dropped from the prior standing.
  type Stored = "win" | "loss" | "tie_loss" | "missed" | "bye";
  interface Rec {
    week: number;
    team: string;
    result: Stored;
  }
  const records: { prior: Rec[]; week: number; team: string }[] = [
    { prior: [], week: 2, team: "PHI" },
    { prior: [{ week: 1, team: "LAC", result: "loss" }], week: 2, team: "BAL" },
    { prior: [{ week: 1, team: "GB", result: "tie_loss" }], week: 2, team: "BAL" },
    { prior: [{ week: 1, team: "MISSED", result: "missed" }], week: 2, team: "BAL" },
    { prior: [{ week: 1, team: "PHI", result: "win" }, { week: 8, team: "SKIP_WEEK", result: "bye" }], week: 9, team: "BAL" },
    { prior: [{ week: 1, team: "LAC", result: "loss" }], week: 9, team: "SKIP_WEEK" },
    { prior: [{ week: 1, team: "LAC", result: "loss" }, { week: 2, team: "DAL", result: "loss" }], week: 3, team: "BAL" },
    { prior: [{ week: 9, team: "LAC", result: "loss" }], week: 10, team: "BAL" },
    { prior: [], week: 8, team: "MISSED" },
    { prior: [], week: 8, team: "SKIP_WEEK" },
  ];
  const candidatesFor = (team: string): DerivedResult[] =>
    team === "SKIP_WEEK" ? ["bye"] : team === "MISSED" ? ["missed"] : ["win", "loss"];

  it("agrees on every candidate of every record", () => {
    for (const c of records) {
      const before = priorStandingOf(c.prior.map((r) => prior("a", r.week, r.team, r.result)), 7);
      if (before === null) throw new Error("every prior here is scored");
      const results = new Map<string, "win" | "loss" | "tie">();
      for (const r of c.prior) {
        if (r.team === "SKIP_WEEK" || r.team === "MISSED") continue;
        results.set(`${r.week}:${r.team}`, r.result === "win" ? "win" : r.result === "tie_loss" ? "tie" : "loss");
      }
      const picks = [...c.prior.map((r) => ({ week: r.week, team: r.team })), { week: c.week, team: c.team }];
      for (const r of candidatesFor(c.team)) {
        const scored = new Map(results);
        if (r === "win" || r === "loss") scored.set(`${c.week}:${c.team}`, r);
        const ours = derivedStandingOf(picks, scored, c.week, 7);
        expect({ record: c, candidate: r, predicted: predictedMark(r, before, c.week, 7) }).toEqual({
          record: c,
          candidate: r,
          predicted: ours,
        });
      }
    }
  });
});

describe("her cell against our pick", () => {
  it("is our pick when her word maps to the same code, exactly, and a bye needs her BYE", () => {
    expect(herCellIsOurPick("LA Chargers", "LAC")).toBe(true);
    expect(herCellIsOurPick("LA Chargers", "LAR")).toBe(false);
    expect(herCellIsOurPick("BYE", "SKIP_WEEK")).toBe(true);
    expect(herCellIsOurPick("Philadelphia", "SKIP_WEEK")).toBe(false);
    expect(herCellIsOurPick(null, "PHI")).toBe(false);
    expect(herCellIsOurPick("OUT", "PHI")).toBe(false);
    // A missed pick has no team for her to name.
    expect(herCellIsOurPick(null, "MISSED")).toBe(true);
    expect(herCellIsOurPick("OUT", "MISSED")).toBe(true);
  });
});

describe("the derived result, one candidate matching her mark", () => {
  it("clean with nothing used before is a win", () => {
    const d = derive({ marks: [row(977, "a", "none", "Philadelphia")], currentPicks: [pick("a", "PHI")] });
    expect(d.applies).toEqual([{ entry_id: "a", result: "win" }]);
    expect(d.byResult).toEqual({ win: 1, loss: 0, bye: 0, missed: 0 });
    expect(d.lossesByTeam).toEqual({});
    expect(d.conflicts).toEqual([]);
  });

  it("yellow with nothing used before is a loss, and the losing team is counted", () => {
    const d = derive({
      marks: [row(977, "a", "yellow"), row(978, "b", "yellow"), row(979, "c", "yellow", "Dallas")],
      currentPicks: [pick("a", "LAC"), pick("b", "LAC"), pick("c", "DAL")],
    });
    expect(d.applies).toEqual([
      { entry_id: "a", result: "loss" },
      { entry_id: "b", result: "loss" },
      { entry_id: "c", result: "loss" },
    ]);
    expect(d.byResult.loss).toBe(3);
    expect(d.lossesByTeam).toEqual({ LAC: 2, DAL: 1 });
  });

  it("yellow with a prior loss is a win - her yellow says one loss somewhere, not this week", () => {
    const d = derive({
      marks: [row(977, "a", "yellow", "Baltimore")],
      currentPicks: [pick("a", "BAL")],
      priorPicks: [prior("a", 1, "LAC", "loss")],
    });
    expect(d.applies).toEqual([{ entry_id: "a", result: "win" }]);
  });

  it("yellow with a prior bye and a real team this week is a win - a bye is a life to her", () => {
    const d = derive({
      marks: [row(977, "a", "yellow", "Baltimore")],
      currentPicks: [pick("a", "BAL")],
      priorPicks: [prior("a", 1, "SKIP_WEEK", "bye")],
      week: 9,
    });
    expect(d.applies).toEqual([{ entry_id: "a", result: "win" }]);
  });

  it("red with a prior loss is a loss", () => {
    const d = derive({
      marks: [row(977, "a", "red", "Baltimore")],
      currentPicks: [pick("a", "BAL")],
      priorPicks: [prior("a", 1, "LAC", "loss")],
    });
    expect(d.applies).toEqual([{ entry_id: "a", result: "loss" }]);
    expect(d.lossesByTeam).toEqual({ BAL: 1 });
  });

  it("red with nothing used before past the boundary is a loss - a first loss there is terminal", () => {
    const d = derive({ marks: [row(977, "a", "red", "Baltimore")], currentPicks: [pick("a", "BAL")], week: 8 });
    expect(d.applies).toEqual([{ entry_id: "a", result: "loss" }]);
  });

  it("red with nothing used before INSIDE the boundary is a derived_conflict with both values, not a write", () => {
    // Its own type, never mark_conflict: the score comparison records the
    // same row under that one and a shared type counted the row twice.
    const d = derive({ marks: [row(977, "a", "red", "Baltimore")], currentPicks: [pick("a", "BAL")], week: 2 });
    expect(d.applies).toEqual([]);
    expect(d.conflicts).toEqual([
      {
        type: "derived_conflict",
        entryId: "a",
        entryName: "entry a",
        lynne: { team: "Baltimore", result: "OUT" },
        local: { team: "BAL", result: "0 losses and no bye before week 2; win reads no losses, loss reads 1 loss/bye" },
      },
    ]);
  });

  it("clean with a prior loss is a derived_conflict - our record says a loss is on it and her sheet says none is", () => {
    const d = derive({
      marks: [row(977, "a", "none", "Baltimore")],
      currentPicks: [pick("a", "BAL")],
      priorPicks: [prior("a", 1, "LAC", "loss")],
    });
    expect(d.applies).toEqual([]);
    expect(d.conflicts.map((c) => [c.type, c.lynne.result, c.local.result])).toEqual([
      ["derived_conflict", "no losses", "1 loss and no bye before week 2; win reads 1 loss/bye, loss reads OUT"],
    ]);
  });

  it("a bye under yellow is a bye, and a missed week under yellow is missed; neither is a losing team", () => {
    // The bye opens after the boundary, so it sits in week 8; a missed week
    // there would read OUT (a first loss past the boundary), so it sits inside.
    const bye = derive({ marks: [row(977, "a", "yellow", "BYE")], currentPicks: [pick("a", "SKIP_WEEK")], week: 8 });
    expect(bye.applies).toEqual([{ entry_id: "a", result: "bye" }]);
    const missed = derive({ marks: [row(978, "b", "yellow", null)], currentPicks: [pick("b", "MISSED")], week: 2 });
    expect(missed.applies).toEqual([{ entry_id: "b", result: "missed" }]);
    expect(bye.byResult).toEqual({ win: 0, loss: 0, bye: 1, missed: 0 });
    expect(missed.byResult).toEqual({ win: 0, loss: 0, bye: 0, missed: 1 });
    expect(bye.lossesByTeam).toEqual({});
    expect(missed.lossesByTeam).toEqual({});
    // A missed week past the boundary under red is missed, and terminal.
    const late = derive({ marks: [row(978, "b", "red", null)], currentPicks: [pick("b", "MISSED")], week: 8 });
    expect(late.applies).toEqual([{ entry_id: "b", result: "missed" }]);
  });

  it("a bye under a clean fill is a derived_conflict: a bye is her 1 LOSS/BYE bucket", () => {
    const d = derive({ marks: [row(977, "a", "none", "BYE")], currentPicks: [pick("a", "SKIP_WEEK")], week: 8 });
    expect(d.applies).toEqual([]);
    expect(d.conflicts.map((c) => c.type)).toEqual(["derived_conflict"]);
  });

  it("a bye after a loss under yellow is a bye, and under red is a derived_conflict - never stacked into OUT by this reader", () => {
    // The rules engine refuses this bye (a loss inside the boundary spends
    // it), so the row cannot arise; if her sheet ever showed it, red would
    // reach Anthony as a conflict rather than a guessed loss.
    const yellow = derive({
      marks: [row(977, "a", "yellow", "BYE")],
      currentPicks: [pick("a", "SKIP_WEEK")],
      priorPicks: [prior("a", 1, "LAC", "loss")],
      week: 9,
    });
    expect(yellow.applies).toEqual([{ entry_id: "a", result: "bye" }]);
    const red = derive({
      marks: [row(977, "a", "red", "BYE")],
      currentPicks: [pick("a", "SKIP_WEEK")],
      priorPicks: [prior("a", 1, "LAC", "loss")],
      week: 9,
    });
    expect(red.applies).toEqual([]);
    expect(red.conflicts.map((c) => [c.type, c.local.result])).toEqual([
      ["derived_conflict", "1 loss and no bye before week 9; bye reads 1 loss/bye"],
    ]);
  });
});

describe("rows set aside, counted and never applied", () => {
  it("an unknown fill, and the season-end yellow, are set aside", () => {
    const d = derive({ marks: [row(977, "a", "other")], currentPicks: [pick("a", "LAC")] });
    expect(d).toMatchObject({ applies: [], unknown: 1, conflicts: [] });
    const w18 = derive({ marks: [row(977, "a", "yellow", "Detroit")], currentPicks: [pick("a", "DET")], week: 18 });
    expect(w18).toMatchObject({ applies: [], unknown: 1 });
    // Through Week 17 the same yellow still derives: a row that burned its
    // bye and won this week.
    const w17 = derive({
      marks: [row(977, "a", "yellow", "Detroit")],
      currentPicks: [pick("a", "DET")],
      priorPicks: [prior("a", 9, "SKIP_WEEK", "bye")],
      week: 17,
    });
    expect(w17.applies).toEqual([{ entry_id: "a", result: "win" }]);
  });

  it("a stored tie_loss against a derived loss is already on file - one class, no write", () => {
    const d = derive({ marks: [row(977, "a", "yellow", "Green Bay")], currentPicks: [pick("a", "GB", "tie_loss")] });
    expect(d.applies).toEqual([]);
    expect(d.alreadyApplied).toBe(1);
    expect(d.conflicts).toEqual([]);
    expect(derive({ marks: [row(977, "a", "yellow")], currentPicks: [pick("a", "LAC", "loss")] }).alreadyApplied).toBe(1);
    expect(derive({ marks: [row(977, "a", "none")], currentPicks: [pick("a", "LAC", "win")] }).alreadyApplied).toBe(1);
  });

  it("a stored win against a derived loss is a result_conflict and is NOT in the applies - never overwritten", () => {
    const d = derive({ marks: [row(977, "a", "yellow")], currentPicks: [pick("a", "LAC", "win")] });
    expect(d.applies).toEqual([]);
    expect(d.alreadyApplied).toBe(0);
    expect(d.conflicts).toEqual([
      {
        type: "result_conflict",
        entryId: "a",
        entryName: "entry a",
        lynne: { team: "LA Chargers", result: "loss (her mark: 1 loss/bye)" },
        local: { team: "LAC", result: "win" },
      },
    ]);
  });

  it("two losses already taken is undecidable: win and loss both read OUT, so the mark cannot say which", () => {
    const d = derive({
      marks: [row(977, "a", "red", "Baltimore")],
      currentPicks: [pick("a", "BAL")],
      priorPicks: [prior("a", 1, "LAC", "loss"), prior("a", 2, "DAL", "loss")],
      week: 3,
    });
    expect(d).toMatchObject({ applies: [], undecidable: 1, conflicts: [] });
  });

  it("a prior loss past the boundary is undecidable too: the row is already out and her red is about that loss", () => {
    // The first version read this as B = 1 and wrote a loss for this week
    // from her red, which says nothing about this week.
    const d = derive({
      marks: [row(977, "a", "red", "Baltimore")],
      currentPicks: [pick("a", "BAL")],
      priorPicks: [prior("a", 9, "LAC", "loss")],
      week: 10,
    });
    expect(d).toMatchObject({ applies: [], undecidable: 1, conflicts: [] });
  });

  it("no current pick for the week is not applied and not reported here - the plan already has it", () => {
    const d = derive({ marks: [row(977, "a", "none", "Philadelphia")], currentPicks: [] });
    expect(d).toMatchObject({ applies: [], noCurrentPick: 1, conflicts: [] });
  });

  it("her cell naming a team other than ours, or nothing, is set aside - her mark is about her team", () => {
    const d = derive({
      marks: [row(977, "a", "none", "Green Bay"), row(978, "b", "none", null), row(979, "c", "none", "Philly??")],
      currentPicks: [pick("a", "KC"), pick("b", "KC"), pick("c", "PHI")],
    });
    expect(d).toMatchObject({ applies: [], cellDiffers: 3, conflicts: [] });
  });

  it("a prior week still pending on a real team is set aside: B would be understated", () => {
    // Without this, a yellow row whose Week 1 loss is still pending would
    // derive Week 2 as a loss it did not take.
    const d = derive({
      marks: [row(977, "a", "yellow", "Baltimore")],
      currentPicks: [pick("a", "BAL")],
      priorPicks: [prior("a", 1, "LAC", "pending")],
    });
    expect(d).toMatchObject({ applies: [], priorUnscored: 1, conflicts: [] });
  });

  it("reads only prior weeks before the import week, in her numbering", () => {
    const d = derive({
      marks: [row(980, "b", "yellow"), row(977, "a", "none", "Philadelphia")],
      currentPicks: [pick("a", "PHI"), pick("b", "LAC")],
      // A later week's loss is not a life used BEFORE this week.
      priorPicks: [prior("b", 3, "DAL", "loss")],
    });
    expect(d.applies).toEqual([
      { entry_id: "a", result: "win" },
      { entry_id: "b", result: "loss" },
    ]);
  });
});
