import { describe, expect, it } from "vitest";
import {
  entryKey,
  parsePickLines,
  resolveEntry,
  resolveTeam,
  splitNumber,
  stripQuotedReply,
  type RosterEntry,
} from "../../scripts/picks/lib/resolve";

const mk = (entryName: string, ownerName: string, ownerEmail: string, playerEmail: string | null = null): RosterEntry => ({
  id: `${ownerName}:${entryName}`,
  entryName,
  ownerId: ownerName,
  ownerName,
  ownerEmail,
  playerEmail,
});

const roster: RosterEntry[] = [
  ...[1, 2, 3, 4].map((n) => mk(`Maria & Mary #${n}`, "Mary Scalia", "laja68@aol.com", "mrealdine@verizon.net")),
  mk("Pumpy321", "Tim Flaherty", "flahertytim@yahoo.com"),
  mk("Tommybrads #1", "Tom Bradley", "tommybrads12@gmail.com"),
  mk("tommybrads #2", "Tom Bradley", "tommybrads12@gmail.com"),
  ...[1, 2, 3, 4].map((n) => mk(`Nick&Kels #${n}`, "Nicholas Teti", "njt2848@gmail.com")),
  mk("Nicky DiVirgilio #1", "Nick DiVirgilio", "nd@example.com"),
  mk("Nicky DiVirgilio #2", "Nick DiVirgilio", "nd@example.com"),
  ...[1, 2, 3, 4].map((n) => mk(`Jim Teti #${n}`, "Jim Teti", "jamesteti@comcast.net")),
  ...[1, 2, 3, 4].map((n) => mk(`TJA #${n}`, "TJ Auletto", "tjauletto@gmail.com")),
  mk("Ron Malandro Jr", "Ron Malandro Jr", "ron@example.com"),
];

describe("entryKey and splitNumber", () => {
  it("drops case, # and spacing only", () => {
    expect(entryKey("TJA # 2")).toBe("tja 2");
    expect(entryKey("Jim Teti  #1")).toBe("jim teti 1");
    expect(entryKey("Adriana Flacco ")).toBe("adriana flacco");
    expect(entryKey("Nick&Kels #4 ")).toBe("nick&kels 4");
  });
  it("splits a trailing number only after a separator", () => {
    expect(splitNumber("Waggs 3")).toEqual({ base: "Waggs", n: 3 });
    expect(splitNumber("TJA # 2")).toEqual({ base: "TJA", n: 2 });
    expect(splitNumber("Mary/Maria 3")).toEqual({ base: "Mary/Maria", n: 3 });
    expect(splitNumber("Pumpy321")).toEqual({ base: "Pumpy321", n: null });
  });
});

describe("resolveTeam", () => {
  it("takes codes, full names, nicknames and typo'd cities", () => {
    expect(resolveTeam("PHI")).toBe("PHI");
    expect(resolveTeam("Eagles")).toBe("PHI");
    expect(resolveTeam("the Eagles")).toBe("PHI");
    expect(resolveTeam("Philadelphia Eagles")).toBe("PHI");
    expect(resolveTeam("Chargers")).toBe("LAC");
    expect(resolveTeam("Los Angles Chargers")).toBe("LAC");
    expect(resolveTeam("Niners")).toBe("SF");
    expect(resolveTeam("JAC")).toBe("JAX");
    expect(resolveTeam("Jets")).toBe("NYJ");
    expect(resolveTeam("bye")).toBe("SKIP_WEEK");
  });
  it("refuses anything that names two teams or nothing", () => {
    expect(resolveTeam("New York")).toBeNull();
    expect(resolveTeam("Los Angeles")).toBeNull();
    expect(resolveTeam("LA")).toBeNull();
    expect(resolveTeam("Steelrs")).toBeNull();
    expect(resolveTeam("")).toBeNull();
  });
});

describe("resolveEntry", () => {
  it("matches exactly, then cosmetically", () => {
    expect(resolveEntry("Pumpy321", roster)).toMatchObject({ ok: true, how: "exact" });
    expect(resolveEntry("tja #2", roster)).toMatchObject({ ok: true, how: "cosmetic", entry: { entryName: "TJA #2" } });
    expect(resolveEntry("TJA # 2", roster)).toMatchObject({ ok: true, how: "cosmetic", entry: { entryName: "TJA #2" } });
    expect(resolveEntry("Tommybrads 1", roster)).toMatchObject({ ok: true, entry: { entryName: "Tommybrads #1" } });
    expect(resolveEntry("tommybrads 2", roster)).toMatchObject({ ok: true, entry: { entryName: "tommybrads #2" } });
  });
  it("reads player shorthand and a one-letter typo", () => {
    expect(resolveEntry("Mary/Maria 3", roster)).toMatchObject({ ok: true, entry: { entryName: "Maria & Mary #3" } });
    expect(resolveEntry("Mary/Matia 3", roster)).toMatchObject({ ok: true, entry: { entryName: "Maria & Mary #3" } });
    expect(resolveEntry("maria and mary #1", roster)).toMatchObject({ ok: true, entry: { entryName: "Maria & Mary #1" } });
  });
  it("lets a player name himself when he has one entry, and refuses when he has several", () => {
    expect(resolveEntry("Tim Flaherty", roster)).toMatchObject({ ok: true, how: "owner_name", entry: { entryName: "Pumpy321" } });
    expect(resolveEntry("Jim Teti", roster)).toMatchObject({ ok: false, reason: "owner_has_multiple_entries" });
    const r = resolveEntry("Jim Teti", roster);
    expect(r.ok === false && r.candidates.length).toBe(4);
  });
  it("never guesses between candidates", () => {
    expect(resolveEntry("Nick", roster)).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(resolveEntry("Maria & Mary", roster)).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(resolveEntry("Nobody Here", roster)).toMatchObject({ ok: false, reason: "unmatched", candidates: [] });
  });
  it("prefers the sender's own entries when a name fits more than one owner", () => {
    const two = [...roster, mk("Nick&Kels #1", "Other Nick", "other@example.com")];
    const preferredIds = new Set(roster.filter((e) => e.ownerEmail === "njt2848@gmail.com").map((e) => e.id));
    expect(resolveEntry("nick & kels 1", two, { preferredIds })).toMatchObject({ ok: true, entry: { ownerName: "Nicholas Teti" } });
    expect(resolveEntry("nick & kels 1", two)).toMatchObject({ ok: false, reason: "ambiguous" });
  });
});

describe("parsePickLines", () => {
  it("reads the shapes players send", () => {
    const { picks, unparsed } = parsePickLines(
      ["Maria & Mary #3 - Eagles", "Mary/Maria 1: Chargers", "Pumpy321 Chargers", "Eagles for both", "2. TJA #4 = Los Angles Chargers", "hello there", "Thanks!"].join("\n"),
    );
    expect(picks.map((p) => [p.entryRaw, p.team, p.all])).toEqual([
      ["Maria & Mary #3", "PHI", false],
      ["Mary/Maria 1", "LAC", false],
      ["Pumpy321", "LAC", false],
      [null, "PHI", true],
      ["TJA #4", "LAC", false],
    ]);
    expect(unparsed).toEqual(["hello there", "Thanks!"]);
  });
  it("reads a bare team as the sender's entry", () => {
    expect(parsePickLines("Detroit Lions").picks).toMatchObject([{ entryRaw: null, team: "DET" }]);
  });
});

describe("stripQuotedReply", () => {
  it("keeps the player's words and drops the history", () => {
    const body = ["Mary/Maria 3 - Eagles", "", "> earlier", "On Mon, Sep 7, 2026 at 9:00 AM Anthony wrote:", "> Week 1 picks"].join("\n");
    expect(stripQuotedReply(body)).toBe("Mary/Maria 3 - Eagles");
  });
});

describe("resolveEntry, owner name with a number", () => {
  it("picks the numbered entry of the owner named", () => {
    expect(resolveEntry("Jim Teti 3", roster)).toMatchObject({ ok: true, entry: { entryName: "Jim Teti #3" } });
    expect(resolveEntry("James Teti 3", [...roster.filter((e) => !e.entryName.startsWith("Jim Teti")), ...[1, 2, 3, 4].map((n) => mk(`JT #${n}`, "James Teti", "jt@example.com"))])).toMatchObject({ ok: true, how: "owner_name", entry: { entryName: "JT #3" } });
  });
});
