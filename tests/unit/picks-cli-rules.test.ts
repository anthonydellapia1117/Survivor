import { describe, expect, it } from "vitest";
import { pendingKind, pickSourceFor } from "../../scripts/picks/lib/resolve";

describe("pickSourceFor", () => {
  it("records mail read from Gmail as email whatever the flag says", () => {
    expect(pickSourceFor("gmail", null)).toBe("email");
    expect(pickSourceFor("gmail", "text")).toBe("email");
    expect(pickSourceFor("gmail", "email")).toBe("email");
  });

  it("records pasted text as text unless the flag names an email body", () => {
    expect(pickSourceFor("paste", null)).toBe("text");
    expect(pickSourceFor("paste", "text")).toBe("text");
    expect(pickSourceFor("paste", "email")).toBe("email");
  });
});

describe("pendingKind", () => {
  it("is identity when there is no sender and no scope (pasted text, no --from)", () => {
    expect(pendingKind(null, 0)).toBe("identity");
  });

  it("is player_question for a --from owner matched by name with no address on file", () => {
    expect(pendingKind(null, 3)).toBe("player_question");
  });

  it("is identity when the sender matches nobody on the roster", () => {
    expect(pendingKind("stranger@example.com", 0)).toBe("identity");
  });

  it("is player_question only when the sender is a known person", () => {
    expect(pendingKind("chas.flaster@gmail.com", 2)).toBe("player_question");
  });
});

import { effectiveSubmitTime, leadingLines, scopeCheck, weekNamedIn } from "../../scripts/picks/lib/resolve";

describe("weekNamedIn", () => {
  it("reads the week a subject or first line names", () => {
    expect(weekNamedIn("Re: Week 1 picks - Kris - 2 entries")).toBe(1);
    expect(weekNamedIn("WEEK 12 picks")).toBe(12);
    expect(weekNamedIn("week #3: Eagles")).toBe(3);
  });

  it("is null when no week is named or the number is not a week", () => {
    expect(weekNamedIn("Eagles this week")).toBeNull();
    expect(weekNamedIn("Week 99")).toBeNull();
    expect(weekNamedIn("Week 0")).toBeNull();
    expect(weekNamedIn("")).toBeNull();
  });

  it("looks only at the leading lines of a body", () => {
    const body = "Kris Tomasco #1 - Eagles\n\nweek 2 next time\nlots\nof\nlines\nWeek 7 deep down";
    expect(weekNamedIn(leadingLines(body))).toBe(2);
    expect(weekNamedIn(leadingLines("a\nb\nc\nd\ne\nWeek 7"))).toBeNull();
  });
});

describe("scopeCheck", () => {
  it("lets a known sender pick only for their own entries", () => {
    const scope = new Set(["e1", "e2"]);
    expect(scopeCheck("e1", scope)).toBe("ok");
    expect(scopeCheck("e9", scope)).toBe("outside");
  });

  it("is open when there is no sender scope", () => {
    expect(scopeCheck("e9", new Set())).toBe("ok");
  });
});

describe("effectiveSubmitTime", () => {
  const now = new Date("2026-09-11T18:00:00Z");
  it("uses the mail's receipt time when there is one", () => {
    expect(effectiveSubmitTime("2026-09-11T15:00:00Z", now).toISOString()).toBe("2026-09-11T15:00:00.000Z");
  });
  it("falls back to now for pasted text or an unreadable time", () => {
    expect(effectiveSubmitTime(null, now)).toBe(now);
    expect(effectiveSubmitTime("not a date", now)).toBe(now);
  });
});

import { overrideDecision, stripQuotedReply } from "../../scripts/picks/lib/resolve";

describe("overrideDecision", () => {
  const late = "2026-09-11T16:00:00Z";
  const before = new Date("2026-09-10T12:00:00Z");
  const after = new Date("2026-09-12T12:00:00Z");
  it("lets a first pick through, late or not", () => {
    expect(overrideDecision(null, before, late)).toEqual({ ok: true });
    expect(overrideDecision(null, after, late)).toEqual({ ok: true });
  });
  it("stages a change to a pick that is already scored", () => {
    const d = overrideDecision({ team: "SEA", submitted_at: "2026-09-08T12:00:00Z", result: "loss" }, after, late);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("already scored");
  });
  it("stages an older mail that would override a newer pick", () => {
    const d = overrideDecision({ team: "PHI", submitted_at: "2026-09-10T15:00:00Z", result: null }, before, late);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("older than the current pick");
  });
  it("stages a change after the lock when a pick is already on file", () => {
    const d = overrideDecision({ team: "PHI", submitted_at: "2026-09-10T15:00:00Z", result: null }, after, late);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("after the lock");
  });
  it("allows a newer mail to change an unscored pick before the lock", () => {
    const d = overrideDecision({ team: "PHI", submitted_at: "2026-09-09T15:00:00Z", result: null }, before, late);
    expect(d).toEqual({ ok: true });
  });
  it("judges the lock at receipt time: a correction that arrived before the lock is written however late it is read", () => {
    // The lock is in the past for this test so that a check against the
    // command's own clock (processing time) would refuse it.
    const pastLock = "2026-09-04T16:00:00Z";
    const arrived = new Date("2026-09-04T15:00:00Z");
    expect(overrideDecision({ team: "PHI", submitted_at: "2026-09-04T14:00:00Z", result: null }, arrived, pastLock)).toEqual({ ok: true });
    const arrivedLate = new Date("2026-09-04T17:00:00Z");
    expect(overrideDecision({ team: "PHI", submitted_at: "2026-09-04T14:00:00Z", result: null }, arrivedLate, pastLock)).toMatchObject({ ok: false });
  });
});

describe("stripQuotedReply", () => {
  it("cuts a wrapped Gmail attribution before its quoted text", () => {
    const body = "Eagles for both\n\nOn Mon, Sep 7, 2026 at 8:16 AM Anthony DellaPia <\nanthonydellapia@gmail.com> wrote:\n> Week 1 picks are due";
    expect(stripQuotedReply(body)).toBe("Eagles for both");
  });
  it("keeps a line that merely starts with On", () => {
    expect(stripQuotedReply("On second thought, Ravens\nthanks")).toBe("On second thought, Ravens\nthanks");
  });
});

import { weekOfMessage } from "../../scripts/picks/lib/resolve";
import { intakeAddresses } from "../../scripts/lib/roster";
import { takeValue, weekArg } from "../../scripts/lib/args";
import type { EntryRow as ER, OwnerRow as OR } from "../../scripts/lib/db";

describe("weekOfMessage", () => {
  it("never takes a week from the quoted history under a reply that names none", () => {
    const pasted = "Eagles for both\n\nOn Tue, Sep 8, 2026 Anthony wrote:\n> Week 1 picks - Kris - 2 entries\n> reply with a team";
    expect(weekOfMessage("", pasted)).toBeNull();
  });
  it("prefers the week the player wrote over the thread's subject", () => {
    expect(weekOfMessage("Re: Survivor - Week 1 picks posted", "Week 2: Chiefs\n\nOn Sun wrote:\n> old")).toBe(2);
  });
  it("falls back to the subject when the body names none", () => {
    expect(weekOfMessage("Re: Week 1 picks - Kris - 2 entries", "Eagles for both")).toBe(1);
    expect(weekOfMessage("Re: hi", "Eagles for both")).toBeNull();
  });
});

describe("intakeAddresses", () => {
  const owners: OR[] = [
    { id: "adm", first_name: "Anthony", last_name: "DellaPia", email: "AnthonyDellaPia@gmail.com", participation_status: "confirmed" },
    { id: "o1", first_name: "Kris", last_name: "Tomasco", email: "kris@x.com", participation_status: "confirmed" },
    { id: "o2", first_name: "John", last_name: "Vassallo", email: "john@x.com", participation_status: "declined" },
  ];
  const e = (id: string, owner: string, extra: Partial<ER> = {}): ER => ({
    id, owner_id: owner, entry_name: id, player_email: null, is_gifted: false, is_free_entry: false, lynne_number: null, lynne_label: null, voided_at: null, ...extra,
  });
  const entries: ER[] = [
    e("AAA #1", "adm", { is_free_entry: true }),
    e("Kris Tomasco #1", "o1"),
    e("Chas Flaster #1", "o1", { is_gifted: true, player_email: "Chas@x.com" }),
    e("John Vassallo #1", "o2", { is_gifted: true, player_email: "someone@x.com" }),
    e("Old #1", "o1", { is_gifted: true, player_email: "gone@x.com", voided_at: "2026-09-01T00:00:00Z" }),
  ];
  it("lists confirmed owners and their players once, never the admin mailbox", () => {
    expect(intakeAddresses(owners, entries, "anthonydellapia@gmail.com")).toEqual(["kris@x.com", "chas@x.com"]);
  });
});

describe("args", () => {
  it("refuses a flag with no value or with another flag as its value", () => {
    expect(() => takeValue(["--file"], 1, "--file")).toThrow("--file needs a value");
    expect(() => takeValue(["--file", "--week"], 1, "--file")).toThrow("--file needs a value");
    expect(takeValue(["--file", "picks.txt"], 1, "--file")).toBe("picks.txt");
  });
  it("accepts only a week from 1 to 18", () => {
    expect(weekArg("1")).toBe(1);
    expect(weekArg("18")).toBe(18);
    for (const bad of ["0", "19", "x", "1.5", ""]) expect(() => weekArg(bad)).toThrow();
  });
});

import { entriesOfConfirmedOwners } from "../../scripts/lib/roster";

describe("entriesOfConfirmedOwners", () => {
  it("drops a declined owner's live entries and every voided entry", () => {
    const owners: OR[] = [
      { id: "o1", first_name: "Kris", last_name: "Tomasco", email: "kris@x.com", participation_status: "confirmed" },
      { id: "o2", first_name: "John", last_name: "Vassallo", email: "john@x.com", participation_status: "declined" },
    ];
    const e = (id: string, owner: string, voided: string | null = null): ER => ({
      id, owner_id: owner, entry_name: id, player_email: null, is_gifted: false, is_free_entry: false, lynne_number: null, lynne_label: null, voided_at: voided,
    });
    const out = entriesOfConfirmedOwners(owners, [e("a", "o1"), e("b", "o2"), e("c", "o1", "2026-09-04T00:00:00Z")]);
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });
});

import { resolveEntry } from "../../scripts/picks/lib/resolve";

describe("the token stage is exact on words, never fuzzy (CLAUDE.md, Matching)", () => {
  const roster = [
    { id: "n1", entryName: "Nicky DiVirgilio #1", ownerId: "o", ownerName: "Nick DiVirgilio", ownerEmail: "n@x.com", playerEmail: null },
    { id: "n2", entryName: "Nicky DiVirgilio #2", ownerId: "o", ownerName: "Nick DiVirgilio", ownerEmail: "n@x.com", playerEmail: null },
    { id: "e1", entryName: "Nicco E", ownerId: "p", ownerName: "Nicco Esposito", ownerEmail: "e@x.com", playerEmail: null },
    { id: "m3", entryName: "Mario 3rd #3", ownerId: "q", ownerName: "Mario Tropea III", ownerEmail: "m@x.com", playerEmail: null },
    { id: "y3", entryName: "Maria & Mary #3", ownerId: "r", ownerName: "Maria Rossi", ownerEmail: "r@x.com", playerEmail: null },
  ];
  it("matches the words exactly, case and punctuation aside", () => {
    expect(resolveEntry("divirgilio nicky 2", roster)).toMatchObject({ ok: true, how: "tokens", entry: { entryName: "Nicky DiVirgilio #2" } });
  });
  it("stages a one-letter typo instead of guessing the entry", () => {
    expect(resolveEntry("Nicky DiVirgilo 2", roster)).toMatchObject({ ok: false, reason: "unmatched" });
    expect(resolveEntry("Nico E", roster)).toMatchObject({ ok: false, reason: "unmatched" });
  });
  it("does not let a near miss on another entry turn an exact shorthand into an ambiguity", () => {
    expect(resolveEntry("Mario 3", roster)).toMatchObject({ ok: true, how: "tokens", entry: { entryName: "Mario 3rd #3" } });
  });
});

import { conflictedKeys, conflictingKeys, itemIdentity, repeatedWeek, scopeEntriesFor, senderUnplaced, stagedDetail, stripWeekHeading, unparsedReason, type RosterEntry } from "../../scripts/picks/lib/resolve";
import { aliveEntries } from "../../scripts/lib/roster";
import { resolveFromArg } from "../../scripts/picks/lib/from";

describe("stripWeekHeading", () => {
  it("turns a same-line week heading into a bare pick and drops a bare heading", () => {
    expect(stripWeekHeading("Week 2: Chiefs")).toBe("Chiefs");
    expect(stripWeekHeading("WEEK 12 picks - Kris Tomasco #1 - Eagles")).toBe("Kris Tomasco #1 - Eagles");
    expect(stripWeekHeading("Week 2\nEagles for both")).toBe("\nEagles for both");
    expect(stripWeekHeading("Pumpy321 Eagles")).toBe("Pumpy321 Eagles");
  });
});

describe("conflictingKeys", () => {
  it("names an entry given two teams in one message and ignores a repeated same team", () => {
    const keys = conflictingKeys([
      { key: "m1|1|e1", team: "PHI" },
      { key: "m1|1|e1", team: "KC" },
      { key: "m1|1|e2", team: "SEA" },
      { key: "m1|1|e2", team: "SEA" },
    ]);
    expect([...keys]).toEqual(["m1|1|e1"]);
  });
});

describe("conflictedKeys", () => {
  it("counts a repeated team staged as an elimination against a new team for the same entry in the same message", () => {
    const keys = conflictedKeys([{ key: "m1|2|e1", team: "KC" }], [{ key: "m1|2|e1", team: "PHI" }]);
    expect([...keys]).toEqual(["m1|2|e1"]);
  });
  it("is no conflict when the staged repeat is the only team the message gave the entry", () => {
    expect(conflictedKeys([{ key: "m1|2|e2", team: "SEA" }], [{ key: "m1|2|e1", team: "PHI" }]).size).toBe(0);
  });
});

describe("repeatedWeek", () => {
  it("finds the week a team was already used and is null otherwise", () => {
    const prior = new Map([["PHI", 1], ["SKIP_WEEK", 3]]);
    expect(repeatedWeek("PHI", prior)).toBe(1);
    expect(repeatedWeek("SKIP_WEEK", prior)).toBe(3);
    expect(repeatedWeek("KC", prior)).toBeNull();
    expect(repeatedWeek("KC", undefined)).toBeNull();
  });
});

describe("resolveFromArg", () => {
  const owners: OR[] = [
    { id: "kris", first_name: "Kris", last_name: "Tomasco", email: "kris@x.com", participation_status: "confirmed" },
    { id: "tim", first_name: "Tim", last_name: "Flaherty", email: null, participation_status: "confirmed" },
  ];
  const e = (id: string, owner: string, name: string, extra: Partial<ER> = {}): ER => ({
    id, owner_id: owner, entry_name: name, player_email: null, is_gifted: false, is_free_entry: false, lynne_number: null, lynne_label: null, voided_at: null, ...extra,
  });
  const entries: ER[] = [
    e("k1", "kris", "Kris Tomasco #1"),
    e("c1", "kris", "Chas Flaster #1", { is_gifted: true, player_email: "Chas.Flaster@gmail.com" }),
    e("c2", "kris", "Chas Flaster #2", { is_gifted: true, player_email: "chas.flaster@gmail.com" }),
    e("p1", "tim", "Pumpy321"),
  ];
  it("resolves a gifted entry's name to the player who plays it, never the buyer", () => {
    expect(resolveFromArg("Chas Flaster", owners, entries)).toEqual({ address: "chas.flaster@gmail.com", ownerId: null });
    expect(resolveFromArg("chas.flaster@gmail.com", owners, entries)).toEqual({ address: "chas.flaster@gmail.com", ownerId: null });
  });
  it("resolves an owner by name, with or without an address on file", () => {
    expect(resolveFromArg("Tomasco", owners, entries)).toEqual({ address: "kris@x.com", ownerId: "kris" });
    expect(resolveFromArg("Pumpy", owners, entries)).toEqual({ address: null, ownerId: "tim" });
  });
  it("counts an owner who also plays a gift to the same mailbox as one person", () => {
    const withChas: OR[] = [...owners, { id: "chas", first_name: "Chas", last_name: "Flaster", email: "chas.flaster@gmail.com", participation_status: "confirmed" }];
    const withOwn: ER[] = [...entries, e("cx", "chas", "Flaster Own")];
    expect(resolveFromArg("Flaster", withChas, withOwn)).toEqual({ address: "chas.flaster@gmail.com", ownerId: "chas" });
  });
  it("refuses a gifted entry with no address rather than scoping its buyer", () => {
    const orphaned = [...entries, e("l1", "kris", "Lou Orphan #1", { is_gifted: true, player_email: null })];
    expect(() => resolveFromArg("Lou Orphan", owners, orphaned)).toThrow("no player address on file");
  });
  it("refuses nobody and more than one person", () => {
    expect(() => resolveFromArg("nobody", owners, entries)).toThrow("matches 0 people");
    expect(() => resolveFromArg("Flaster", [...owners, { id: "x", first_name: "Chas", last_name: "Flasterson", email: "cf@x.com", participation_status: "confirmed" }], entries)).toThrow("matches 2 people");
  });
});

describe("scopeEntriesFor and senderUnplaced", () => {
  const r = (id: string, ownerId: string, entryName: string, extra: Partial<RosterEntry> = {}): RosterEntry => ({
    id, entryName, ownerId, ownerName: "Kris Tomasco", ownerEmail: null, playerEmail: null, isGifted: false, ...extra,
  });
  const roster: RosterEntry[] = [
    r("k1", "kris", "Kris Tomasco #1"),
    r("k2", "kris", "Kris Tomasco #2"),
    r("c1", "kris", "Chas Flaster #1", { isGifted: true, playerEmail: "chas.flaster@gmail.com" }),
    r("o1", "kris", "Orphan #1", { isGifted: true, playerEmail: null }),
    r("p1", "tim", "Pumpy321", { ownerName: "Tim Flaherty" }),
  ];
  const entriesFor = (address: string) => roster.filter((e) => e.playerEmail === address);
  it("gives a --from owner only the entries they play: no gifted entry, addressed or not", () => {
    const scope = scopeEntriesFor({ senderAddress: null, fromOwnerId: "kris" }, roster, entriesFor);
    expect(scope.map((e) => e.id)).toEqual(["k1", "k2"]);
  });
  it("gives a known address what entriesFor says", () => {
    const scope = scopeEntriesFor({ senderAddress: "chas.flaster@gmail.com", fromOwnerId: null }, roster, entriesFor);
    expect(scope.map((e) => e.id)).toEqual(["c1"]);
  });
  it("is unplaced for an identified sender with no live entry, by address or by --from, and never for plain pasted text", () => {
    expect(senderUnplaced({ senderAddress: "declined@example.com", fromOwnerId: null }, 0)).toBe(true);
    expect(senderUnplaced({ senderAddress: null, fromOwnerId: "no-entries" }, 0)).toBe(true);
    expect(senderUnplaced({ senderAddress: null, fromOwnerId: null }, 0)).toBe(false);
    expect(senderUnplaced({ senderAddress: null, fromOwnerId: "kris" }, 2)).toBe(false);
  });
});

describe("itemIdentity", () => {
  it("is the Gmail message id, so two replies with one label are two messages", () => {
    expect(itemIdentity("m1", "Re: Week 1 picks", 0)).not.toBe(itemIdentity("m2", "Re: Week 1 picks", 1));
    expect(itemIdentity("m1", "Re: Week 1 picks", 0)).toBe("m1");
  });
  it("tells pasted items apart by ordinal when there is no message id", () => {
    expect(itemIdentity(null, "pasted text", 0)).not.toBe(itemIdentity(null, "pasted text", 1));
  });
});

describe("aliveEntries", () => {
  const e = (id: string, name: string, voided: string | null = null): ER => ({
    id, owner_id: "o", entry_name: name, player_email: null, is_gifted: false, is_free_entry: false, lynne_number: null, lynne_label: null, voided_at: voided,
  });
  const entries = [e("a", "Alive"), e("b", "Gone"), e("c", "Unlisted"), e("v", "Voided", "2026-09-04T00:00:00Z")];
  const standings = [
    { entry_id: "a", status: "at_risk", losses: 1, bye_used: false },
    { entry_id: "b", status: "eliminated", losses: 2, bye_used: false },
  ];
  it("keeps only entries alive on the standings and names the rest", () => {
    const r = aliveEntries(entries, standings);
    expect(r.alive.map((x) => x.entry_name)).toEqual(["Alive"]);
    expect(r.out.map((x) => `${x.entry.entry_name}: ${x.why}`)).toEqual(["Gone: eliminated", "Unlisted: no standings row"]);
  });
});

describe("unparsedReason", () => {
  it("surfaces LA and NY as a question instead of dropping them as noise", () => {
    expect(unparsedReason("LA")).toMatch(/names two teams/);
    expect(unparsedReason("ny.")).toMatch(/names two teams/);
  });
  it("drops greetings, thanks and a word or two with no team", () => {
    expect(unparsedReason("thanks!")).toBeNull();
    expect(unparsedReason("ok")).toBeNull();
    expect(unparsedReason("Hi Anthony")).toBeNull();
  });
  it("reports any other line with words in it", () => {
    expect(unparsedReason("go birds")).toBe("no team recognised on this line");
  });
});

describe("stagedDetail", () => {
  it("carries the week and the queue only", () => {
    expect(stagedDetail(2)).toBe("week 2 - /admin/queue");
  });
});

import { readFileSync } from "node:fs";
import { overrideDecision as overrideDecisionForSnapshot, picksToCarryForward } from "../../scripts/picks/lib/resolve";

describe("two messages for one entry in one run", () => {
  const LATE_DEADLINE = "2026-09-11T18:00:00Z";
  const onTime = new Date("2026-09-11T15:00:00Z");
  const afterLock = new Date("2026-09-11T19:00:00Z");

  it("judges the second against the first, so an after-lock correction is staged and not written over it", () => {
    // Both messages used to read the pre-run snapshot, so the second saw no
    // current pick, was proposed, and the write loop let it override the
    // first - bypassing the rule that a change after the lock needs Anthony
    // (issue #21).
    const snapshot = new Map<string, { entry_id: string; team: string; late: boolean; submitted_at: string; result: string | null }>();

    // Message one: PHI, on time, no pick on file.
    expect(overrideDecision(snapshot.get("e1") ?? null, onTime, LATE_DEADLINE)).toEqual({ ok: true });
    const first = { entry_id: "e1", team: "PHI", late: false, submitted_at: onTime.toISOString(), result: null };
    for (const [id, row] of picksToCarryForward(new Map([["e1", first]]), new Map([["e1", new Set(["PHI"])]]))) {
      snapshot.set(id, row);
    }
    expect(snapshot.get("e1")?.team).toBe("PHI");

    // Message two: KC, after the lock. Now it sees PHI and is refused.
    const decision = overrideDecision(snapshot.get("e1") ?? null, afterLock, LATE_DEADLINE);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.reason).toMatch(/after the lock with PHI already on file/);
  });

  it("does not let a message naming the team already on file move the snapshot's time", () => {
    // A Tuesday PHI on file, then an older Monday PHI and a later Monday KC
    // in one run. The same-team message is let through the override guard
    // (it is not a change of team), so recording it against madeAt replaced
    // Tuesday with Monday - and KC, still older than the real pick, then
    // passed the stale-message guard and overwrote it. A wrong write.
    const onFile = { entry_id: "e1", team: "PHI", late: false, submitted_at: "2026-09-08T12:00:00Z", result: null };
    const monA = new Date("2026-09-07T10:00:00Z");
    const monB = new Date("2026-09-07T11:00:00Z");

    // The same-team no-op records nothing, so the snapshot keeps the real row.
    const snapshot = new Map<string, typeof onFile>([["e1", onFile]]);
    const existing = snapshot.get("e1") ?? null;
    const itemPicks = new Map<string, typeof onFile>();
    if (!(existing && existing.team === "PHI")) {
      itemPicks.set("e1", { entry_id: "e1", team: "PHI", late: false, submitted_at: monA.toISOString(), result: null });
    }
    for (const [id, row] of picksToCarryForward(itemPicks, new Map([["e1", new Set(["PHI"])]]))) snapshot.set(id, row);
    expect(snapshot.get("e1")?.submitted_at).toBe("2026-09-08T12:00:00Z");

    // So the later, still-older KC is refused rather than written.
    const d = overrideDecisionForSnapshot(snapshot.get("e1") ?? null, monB, "2026-09-11T18:00:00Z");
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toMatch(/older than the current pick/);
  });

  it("keeps that condition in the sweep, and lets a bye already on file stay an ordinary no-op", () => {
    const src = readFileSync("scripts/picks/cli.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    // Only a pick that will be written moves the snapshot on.
    expect(src).toMatch(/if \(!\(existing && existing\.team === p\.team\)\) \{\n\s*itemPicks\.set\(t\.entry\.id, \{/);
    // An entry whose current pick for this week is already the bye reads as
    // bye_used, so re-sending it must not be refused as a second bye.
    expect(src).toMatch(/if \(p\.team === SKIP_WEEK && !\(existing && existing\.team === SKIP_WEEK\)\) \{/);
  });

  it("carries forward only an entry the message gave exactly one team", () => {
    const rowA = { team: "PHI" };
    const rowB = { team: "KC" };
    // One team: carried.
    expect([...picksToCarryForward(new Map([["e1", rowA]]), new Map([["e1", new Set(["PHI"])]])).keys()]).toEqual(["e1"]);
    // Two teams in one message is the conflict, both are withdrawn, so
    // neither may stand as the current pick for the next message.
    expect(picksToCarryForward(new Map([["e1", rowA]]), new Map([["e1", new Set(["PHI", "KC"])]])).size).toBe(0);
    // A repeated team staged as an elimination counts as one of the two.
    expect(picksToCarryForward(new Map([["e1", rowA]]), new Map([["e1", new Set(["PHI", "DAL"])]])).size).toBe(0);
    // An entry with no teams recorded is not carried.
    expect(picksToCarryForward(new Map([["e2", rowB]]), new Map()).size).toBe(0);
    // Entries are judged one at a time.
    const both = picksToCarryForward(
      new Map([["e1", rowA], ["e2", rowB]]),
      new Map([["e1", new Set(["PHI", "KC"])], ["e2", new Set(["KC"])]]),
    );
    expect([...both.keys()]).toEqual(["e2"]);
  });

  it("is wired into the sweep: the snapshot moves after the message, never inside it", () => {
    const src = readFileSync("scripts/picks/cli.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(src).toMatch(/for \(const \[entryId, row\] of picksToCarryForward\(itemPicks, itemTeams\)\) ctx\.currentByEntry\.set\(entryId, row\);/);
    // Inside the message the snapshot is untouched, so the conflict pass
    // still sees both teams rather than a stale-pick complaint.
    expect(src.indexOf("picksToCarryForward(itemPicks, itemTeams)")).toBeGreaterThan(src.indexOf("proposals.push({"));
    expect(src).toMatch(/sawTeam\(t\.entry\.id, p\.team\);/);
    // The accepted pick is RECORDED, or there is nothing to carry forward and
    // the snapshot never moves - the original bug, with the suite green.
    expect(src).toMatch(/itemPicks\.set\(t\.entry\.id, \{\n\s*entry_id: t\.entry\.id,\n\s*team: p\.team,/);
  });
});

describe("a bye the database would refuse", () => {
  it("is checked before proposing, so one refused write cannot stop the run", () => {
    // admin_submit_pick raises on an ineligible bye. Reaching the write with
    // it left the proposals before it written, the rest not written, and the
    // remaining mail unread until the next sweep (issue #22).
    const src = readFileSync("scripts/picks/cli.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(src).toMatch(/if \(p\.team === SKIP_WEEK && !\(existing && existing\.team === SKIP_WEEK\)\) \{/);
    expect(src).toMatch(/byeRefusal\(item\.week, standingByEntry\.get\(t\.entry\.id\) \?\? null, doubleElimThroughWeek\)/);
    // Staging is not enough: the proposal has to be ABANDONED. With the
    // continue dropped the bye is staged and still proposed, so it still
    // reaches admin_submit_pick and still kills the run - the whole bug - and
    // every other assertion here, and the whole suite, stays green.
    expect(src).toMatch(/if \(why !== null\) \{\n\s*fail\(`\$\{t\.entry\.entryName\} -> bye: \$\{why\}`, p\.line\);\n\s*continue;\n\s*\}/);
    // The check comes before the proposal, not after it.
    expect(src.indexOf("if (p.team === SKIP_WEEK)")).toBeLessThan(src.indexOf("proposals.push({"));
    // The window comes from config, never a literal.
    expect(src).toMatch(/loadDoubleElimThroughWeek\(client\)/);
    expect(src).not.toMatch(/doubleElimThroughWeek = 7/);
  });
});
