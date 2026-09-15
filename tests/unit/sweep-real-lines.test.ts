// THE REAL LINES THE PARSER MISSED ON 2026-09-15, each held to the exact
// resolution it must get now.
//
// Every one of these came from a roster address that morning, was a Week 2
// pick, and was staged as a player_question with the line verbatim in the
// payload - so 43 people's replies were sitting on the queue while the
// Wednesday 2 PM deadline ran down. The roster below is the production shape
// for those senders: the names and Lynne numbers as they stand, the gift on
// Kris Tomasco's two Chas Flaster entries included, because the scope is what
// decides most of these.
//
// The harness mirrors scripts/picks/cli.ts's resolve loop line for line; the
// wiring of that loop is held by the source assertions at the bottom, so a
// parser that reads these right and a CLI that does not call it cannot both
// be green.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parsePickLines,
  resolveEntry,
  scopeCheck,
  stripQuotedReply,
  unparsedLinesToAsk,
  type RosterEntry,
} from "../../scripts/picks/lib/resolve";

const mk = (
  entryName: string,
  lynneNumber: number,
  ownerName: string,
  ownerEmail: string,
  playerEmail: string | null = null,
): RosterEntry => ({
  id: `e${lynneNumber}`,
  entryName,
  ownerId: ownerName,
  ownerName,
  ownerEmail,
  playerEmail,
  isGifted: playerEmail !== null,
  lynneNumber,
});

const ASHLEY = "ashley@example.com";
const MARC = "marc@example.com";
const ANT = "acgiletto@example.com";
const ROB = "rf@example.com";
const MARIA = "maria@example.com";
const KRIS = "kris@example.com";
const CHAS = "chas@example.com";

const ROSTER: RosterEntry[] = [
  ...[1, 2, 3, 4].map((n) => mk(`Waggs #${n}`, 983 + n, "Ashley Scalia", ASHLEY)),
  mk("Marc Mass #1", 1035, "Marc Massimino", MARC),
  mk("Marc Mass #2", 1036, "Marc Massimino", MARC),
  mk("Rob & Alanna #1", 1071, "Rob & Alanna", ROB),
  // The 2026-09-12 owner split: #2 moved to its own owner, the name did not.
  mk("Rob & Alanna #2", 1072, "Ant Giletto", ANT),
  ...[1, 2, 3, 4].map((n) => mk(`ReRe #${n}`, 1040 + n, "Maria DiCicco", MARIA)),
  mk("Kris Tomasco #1", 1025, "Kris Tomasco", KRIS),
  mk("Kris Tomasco #2", 1026, "Kris Tomasco", KRIS),
  // Gifted: Chas plays these, Kris pays. They are Chas's to pick, not Kris's.
  mk("Chas Flaster #1", 1027, "Kris Tomasco", KRIS, CHAS),
  mk("Chas Flaster #2", 1028, "Kris Tomasco", KRIS, CHAS),
];

/** The CLI's entriesFor: what an address plays - its own entries, or the gifts addressed to it. */
function entriesFor(address: string): RosterEntry[] {
  const a = address.toLowerCase();
  return ROSTER.filter((e) => {
    if (e.isGifted && !e.playerEmail) return false;
    return e.playerEmail ? e.playerEmail.toLowerCase() === a : (e.ownerEmail ?? "").toLowerCase() === a;
  });
}

type Outcome =
  | { pick: [string, string] }
  | { staged: string; kind: "player_question" }
  | { silent: true };

/**
 * One message body from one sender, through the same steps the sweep takes:
 * quoted history stripped, lines parsed, an entry token resolved inside the
 * sender's scope, a bare team given to a sender with one entry, a teams-only
 * line and an unparsed line each staged with the reason the CLI would give.
 */
function sweep(body: string, sender: string): Outcome[] {
  const scope = entriesFor(sender);
  const preferredIds = new Set(scope.map((e) => e.id));
  const placed = scope.length > 0;
  const signatures = [...new Set(scope.map((e) => e.ownerName))];
  const out: Outcome[] = [];
  const { picks, unparsed, multi } = parsePickLines(stripQuotedReply(body));
  for (const ask of unparsedLinesToAsk(placed, unparsed, signatures)) out.push({ staged: ask.reason, kind: "player_question" });
  for (const m of multi) {
    const names = scope.map((e) => e.entryName).join(", ");
    out.push({
      staged:
        scope.length === m.teams.length
          ? `names ${m.teams.length} teams for ${scope.length} entries with the order unstated: which is which? entries ${names}; teams ${m.teams.join(", ")}`
          : `names ${m.teams.length} teams (${m.teams.join(", ")}) and the sender has ${scope.length} entr${scope.length === 1 ? "y" : "ies"} (${names})`,
      kind: "player_question",
    });
  }
  for (const p of picks) {
    if (p.entryRaw === null) {
      if (scope.length === 1) out.push({ pick: [scope[0].entryName, p.team] });
      else out.push({ staged: `no entry named and the sender has ${scope.length} entries`, kind: "player_question" });
      continue;
    }
    const r = resolveEntry(p.entryRaw, ROSTER, { preferredIds });
    if (!r.ok) {
      out.push({ staged: `entry "${p.entryRaw}": ${r.reason.replace(/_/g, " ")}`, kind: "player_question" });
      continue;
    }
    if (scopeCheck(r.entry.id, preferredIds) === "outside") {
      out.push({ staged: `entry "${p.entryRaw}" is ${r.entry.entryName}, not one of the sender's entries`, kind: "player_question" });
      continue;
    }
    out.push({ pick: [r.entry.entryName, p.team] });
  }
  return out.length ? out : [{ silent: true }];
}

describe("the real Week 2 lines, from the addresses that sent them", () => {
  const cases: { who: string; from: string; line: string; expect: Outcome[] }[] = [
    // Ashley Scalia, Waggs #1-#4 (984-987): a bare hyphen, a space on one
    // side only, the code beside the nickname, and "Tampa" alone.
    { who: "Ashley", from: ASHLEY, line: "Waggs3-Tampa", expect: [{ pick: ["Waggs #3", "TB"] }] },
    { who: "Ashley", from: ASHLEY, line: "Waggs4-Eagles", expect: [{ pick: ["Waggs #4", "PHI"] }] },
    { who: "Ashley", from: ASHLEY, line: "Waggs1- SF 49ers", expect: [{ pick: ["Waggs #1", "SF"] }] },
    { who: "Ashley", from: ASHLEY, line: "Waggs2- Baltimore Ravens", expect: [{ pick: ["Waggs #2", "BAL"] }] },
    // Marc Massimino, Marc Mass #1-#2 (1035-1036): two picks on one line,
    // the entry token the tail of his own entry's name run together.
    {
      who: "Marc",
      from: MARC,
      line: "Mass1 - Ravens Mass2 Niners",
      expect: [{ pick: ["Marc Mass #1", "BAL"] }, { pick: ["Marc Mass #2", "SF"] }],
    },
    // Ant Giletto, ONE live entry (Rob & Alanna #2, 1072): no entry token,
    // one team, the curly apostrophe of a phone.
    { who: "Ant", from: ANT, line: "I\u2019ll do the niners", expect: [{ pick: ["Rob & Alanna #2", "SF"] }] },
    // Maria DiCicco, ReRe #1-#4 (1041-1044): her NO., an arrow, a trailing asterisk.
    { who: "Maria", from: MARIA, line: "1042 \u2192 49ers*", expect: [{ pick: ["ReRe #2", "SF"] }] },
    { who: "Maria", from: MARIA, line: "1043 \u2192 Ravens*", expect: [{ pick: ["ReRe #3", "BAL"] }] },
    { who: "Maria", from: MARIA, line: "1044 \u2192 Buccaneers*", expect: [{ pick: ["ReRe #4", "TB"] }] },
    // Kris Tomasco, TWO of his own (1025-1026) plus two gifted to Chas that
    // are Chas's to pick: two teams for two entries, order unstated. One
    // question, naming his two and the two teams, never assigned by order.
    {
      who: "Kris",
      from: KRIS,
      line: "Chargers & 49ers",
      expect: [
        {
          staged: "names 2 teams for 2 entries with the order unstated: which is which? entries Kris Tomasco #1, Kris Tomasco #2; teams LAC, SF",
          kind: "player_question",
        },
      ],
    },
  ];
  for (const c of cases) {
    it(`${c.who}: ${JSON.stringify(c.line)}`, () => {
      expect(sweep(c.line, c.from)).toEqual(c.expect);
    });
  }

  it("Kris's question names his two and not Chas's two", () => {
    const [o] = sweep("Chargers & 49ers", KRIS);
    expect("staged" in o && o.staged).not.toMatch(/Chas Flaster/);
  });

  it("the whole of Ashley's message, four lines, is four picks and nothing staged", () => {
    const body = ["Waggs3-Tampa", "Waggs4-Eagles", "Waggs1- SF 49ers", "Waggs2- Baltimore Ravens"].join("\n");
    expect(sweep(body, ASHLEY)).toEqual([
      { pick: ["Waggs #3", "TB"] },
      { pick: ["Waggs #4", "PHI"] },
      { pick: ["Waggs #1", "SF"] },
      { pick: ["Waggs #2", "BAL"] },
    ]);
  });
});

describe("the lines that are noise and must stay unparsed", () => {
  it("a sign-off, a signature and a phone's footer produce no row at all", () => {
    expect(sweep("Sincerely", KRIS)).toEqual([{ silent: true }]);
    expect(sweep("Kris Tomasco", KRIS)).toEqual([{ silent: true }]);
    expect(sweep("Sent from my iPhone", KRIS)).toEqual([{ silent: true }]);
    expect(sweep("Sent via the iPhone", MARC)).toEqual([{ silent: true }]);
    expect(sweep("Maria DiCicco*", MARIA)).toEqual([{ silent: true }]);
  });

  it("a real question is a question, never a pick", () => {
    const q = { staged: "no team recognised on this line", kind: "player_question" as const };
    expect(sweep("Am I eliminated", KRIS)).toEqual([q]);
    expect(sweep("Is there somewhere I can see the picks each week?", MARC)).toEqual([q]);
    expect(sweep("I just gave cash to Pung and he said he would give it to you", ASHLEY)).toEqual([q]);
  });

  it("prose that names two teams while picking neither is NOT a pick", () => {
    // Anthony's exact line. It names Buffalo and Detroit and picks neither;
    // one live entry in scope, so a bare-team reading would have WRITTEN it.
    const line = "Got it.  I don't think I'm taking buffalo or Detroit this week.  I'll have my picks to you by Fri morning.";
    const out = sweep(line, ANT);
    expect(out.some((o) => "pick" in o)).toBe(false);
    expect(out).toEqual([{ staged: "no team recognised on this line", kind: "player_question" }]);
    // And split across lines, the same.
    const split = sweep("Got it.\nI don't think I'm taking buffalo or Detroit this week.\nI'll have my picks to you by Fri morning.", ANT);
    expect(split.some((o) => "pick" in o)).toBe(false);
  });

  it("a hedged pick stays a question even with the entry named", () => {
    expect(sweep("Waggs3 - Tampa or Eagles", ASHLEY).some((o) => "pick" in o)).toBe(false);
  });
});

describe("the rules the real lines needed, each at its edge", () => {
  it("separator: the first of the listed separators splits, and ' to ' is not one", () => {
    expect(parsePickLines("Waggs3-Tampa").picks).toMatchObject([{ entryRaw: "Waggs3", team: "TB" }]);
    expect(parsePickLines("Waggs3->Tampa").picks).toMatchObject([{ entryRaw: "Waggs3", team: "TB" }]);
    expect(parsePickLines("Waggs3: Tampa").picks).toMatchObject([{ entryRaw: "Waggs3", team: "TB" }]);
    expect(parsePickLines("Waggs3 = Tampa").picks).toMatchObject([{ entryRaw: "Waggs3", team: "TB" }]);
    expect(parsePickLines("Waggs3 \u2014 Tampa").picks).toMatchObject([{ entryRaw: "Waggs3", team: "TB" }]);
    // Trailing "*", "." and ")" come off both parts.
    expect(parsePickLines("1042 \u2192 49ers*").picks).toMatchObject([{ entryRaw: "1042", teamRaw: "49ers", team: "SF" }]);
    expect(parsePickLines("Waggs3) - Tampa.").picks).toMatchObject([{ entryRaw: "Waggs3", team: "TB" }]);
    // " to " is prose, so this is no separator split; it falls to the
    // trailing-words path with the words in front of the team as the entry.
    const to = parsePickLines("Waggs3 to Tampa").picks[0];
    expect(to.entryRaw).toBe("Waggs3 to");
  });

  it("entry keys: the words run together match the sender's entry, and a suffix of the sender's OWN entry matches but nobody else's", () => {
    const ashley = new Set(entriesFor(ASHLEY).map((e) => e.id));
    expect(resolveEntry("Waggs3", ROSTER, { preferredIds: ashley })).toMatchObject({ ok: true, how: "compact", entry: { entryName: "Waggs #3" } });
    const marc = new Set(entriesFor(MARC).map((e) => e.id));
    expect(resolveEntry("Mass1", ROSTER, { preferredIds: marc })).toMatchObject({ ok: true, how: "suffix", entry: { entryName: "Marc Mass #1" } });
    // The same shorthand from somebody who does not own the entry is nothing.
    expect(resolveEntry("Mass1", ROSTER, { preferredIds: ashley })).toMatchObject({ ok: false, reason: "unmatched" });
    expect(resolveEntry("Mass1", ROSTER)).toMatchObject({ ok: false, reason: "unmatched" });
    // A suffix that starts inside a word is not a suffix.
    expect(resolveEntry("ass1", ROSTER, { preferredIds: marc })).toMatchObject({ ok: false });
    // Two of the sender's entries sharing the tail stays unresolved.
    const twins: RosterEntry[] = [...ROSTER, mk("Big Mass #1", 1200, "Marc Massimino", MARC)];
    const marcTwins = new Set(entriesFor(MARC).map((e) => e.id)).add("e1200");
    expect(resolveEntry("Mass1", twins, { preferredIds: marcTwins })).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("a Lynne number is exact, in scope; outside the scope it is staged naming the number; unknown it says so", () => {
    expect(sweep("1042 \u2192 49ers", MARIA)).toEqual([{ pick: ["ReRe #2", "SF"] }]);
    // Kris naming Maria's number: a question, never a write.
    expect(sweep("1042 - 49ers", KRIS)).toEqual([
      { staged: 'entry "1042" is ReRe #2, not one of the sender\'s entries', kind: "player_question" },
    ]);
    expect(sweep("1099 - Eagles", MARIA)).toEqual([
      { staged: 'entry "1099": no live entry carries lynne number', kind: "player_question" },
    ]);
    // Never a near number.
    expect(resolveEntry("1045", ROSTER)).toMatchObject({ ok: false });
  });

  it("two picks on one line take the remainder only when it yields an entry AND a team", () => {
    const two = parsePickLines("Mass1 - Ravens Mass2 Niners");
    expect(two.picks.map((p) => [p.entryRaw, p.team])).toEqual([["Mass1", "BAL"], ["Mass2", "SF"]]);
    expect(two.unparsed).toEqual([]);
    // A remainder that is not an entry and a team is left to the unparsed reason.
    const one = parsePickLines("Mass1 - Ravens please");
    expect(one.picks.map((p) => [p.entryRaw, p.team])).toEqual([["Mass1", "BAL"]]);
    expect(one.unparsed).toEqual(["please"]);
    // A remainder that is a team with no entry token is NOT taken: with two
    // entries in scope it would be assigned by order, which is never done.
    const bare = parsePickLines("Mass1 - Ravens I'll take the Niners");
    expect(bare.picks.map((p) => [p.entryRaw, p.team])).toEqual([["Mass1", "BAL"]]);
    expect(bare.unparsed).toEqual(["I'll take the Niners"]);
  });

  it("one live entry and no entry token is that entry's pick; two or more is a question, never assigned by order", () => {
    expect(sweep("I\u2019ll do the niners", ANT)).toEqual([{ pick: ["Rob & Alanna #2", "SF"] }]);
    expect(sweep("niners", ANT)).toEqual([{ pick: ["Rob & Alanna #2", "SF"] }]);
    // Rob & Alanna still own #1 only, so the same words from Rob are #1's pick.
    expect(sweep("I\u2019ll do the niners", ROB)).toEqual([{ pick: ["Rob & Alanna #1", "SF"] }]);
    // Ashley has four: one team, no entry named, is a question.
    expect(sweep("I'll take the niners", ASHLEY)).toEqual([
      { staged: "no entry named and the sender has 4 entries", kind: "player_question" },
    ]);
  });

  it("as many teams as entries is ONE question naming both lists; a different count says the mismatch", () => {
    expect(sweep("Chargers & 49ers", KRIS)).toHaveLength(1);
    expect(sweep("Chargers, 49ers and Eagles", KRIS)).toEqual([
      { staged: "names 3 teams (LAC, SF, PHI) and the sender has 2 entries (Kris Tomasco #1, Kris Tomasco #2)", kind: "player_question" },
    ]);
    // Chas, the giftee, picking his two the same way gets his own question.
    const [chas] = sweep("Chargers & 49ers", CHAS);
    expect("staged" in chas && chas.staged).toMatch(/entries Chas Flaster #1, Chas Flaster #2; teams LAC, SF/);
  });

  it("the team words added on 2026-09-15 each name exactly one team", () => {
    const { picks } = parsePickLines(["Waggs1 - Tampa", "Waggs2 - Bucs", "Waggs3 - SF 49ers", "Waggs4 - Bengals"].join("\n"));
    expect(picks.map((p) => p.team)).toEqual(["TB", "TB", "SF", "CIN"]);
    // What could name two stays out.
    for (const two of ["New York", "LA", "Los Angeles"]) {
      expect(parsePickLines(`Waggs1 - ${two}`).picks).toEqual([]);
    }
  });
});

describe("the CLI takes these paths, not a copy of them", () => {
  const code = readFileSync(path.join(__dirname, "../..", "scripts/picks/cli.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  it("reads the teams-only lines, hands the sender's owner names in as signatures, and carries the Lynne number onto the roster", () => {
    expect(code).toMatch(/const \{ picks, unparsed, multi \} = parsePickLines\(body\);/);
    expect(code).toMatch(/for \(const m of multi\) \{/);
    expect(code).toMatch(/scopeEntries\.length === m\.teams\.length/);
    expect(code).toMatch(/unparsedLinesToAsk\(placed, unparsed, signatures\)/);
    expect(code).toMatch(/lynneNumber: e\.lynne_number,/);
  });
});
