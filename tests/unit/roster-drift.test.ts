import { describe, expect, it } from "vitest";
import type { AdminEntry } from "@/lib/data/admin-types";
import {
  isRemovedSinceSubmission,
  isRenamedSinceSubmission,
  isUnsentToLynne,
  nameOnLynnesSheet,
} from "@/lib/lynne/roster-drift";

const SENT = "2026-08-24T23:23:18Z";

function entry(over: Partial<AdminEntry> = {}): AdminEntry {
  return {
    id: "e1",
    ownerId: "o1",
    ownerName: "Test Owner",
    entryIndex: 1,
    entryName: "Test 1",
    nameIsDefault: false,
    lynneLabel: null,
    lynneNumber: null,
    isFreeEntry: false,
    voidedAt: null,
    pickCount: 0,
    isAdminEntry: false,
    submittedToLynneAt: null,
    submittedAsName: null,
    removalCommunicatedAt: null,
    ...over,
  };
}

describe("roster drift vs Lynne's copy", () => {
  it("a live, never-sent entry is new and nothing else", () => {
    const e = entry();
    expect(isUnsentToLynne(e)).toBe(true);
    expect(isRenamedSinceSubmission(e)).toBe(false);
    expect(isRemovedSinceSubmission(e)).toBe(false);
  });

  it("a live, sent, unrenamed entry drifts in no way", () => {
    const e = entry({ submittedToLynneAt: SENT, submittedAsName: "Test 1" });
    expect(isUnsentToLynne(e)).toBe(false);
    expect(isRenamedSinceSubmission(e)).toBe(false);
    expect(isRemovedSinceSubmission(e)).toBe(false);
  });

  it("renamed after submission is renamed only", () => {
    const e = entry({
      submittedToLynneAt: SENT,
      submittedAsName: "Old Name",
      entryName: "New Name",
    });
    expect(isRenamedSinceSubmission(e)).toBe(true);
    expect(isUnsentToLynne(e)).toBe(false);
    expect(isRemovedSinceSubmission(e)).toBe(false);
  });

  it("voided after submission is a removal she must be told about", () => {
    const e = entry({
      submittedToLynneAt: SENT,
      submittedAsName: "Jim DiCicco 1",
      voidedAt: "2026-09-01T16:00:00Z",
    });
    expect(isRemovedSinceSubmission(e)).toBe(true);
    expect(isUnsentToLynne(e)).toBe(false);
    expect(isRenamedSinceSubmission(e)).toBe(false);
  });

  it("voided but never sent is NOT a removal — she never had it", () => {
    const e = entry({ voidedAt: "2026-09-01T16:00:00Z" });
    expect(isRemovedSinceSubmission(e)).toBe(false);
    expect(isUnsentToLynne(e)).toBe(false);
    expect(isRenamedSinceSubmission(e)).toBe(false);
  });

  it("a communicated removal stops being pending", () => {
    const e = entry({
      submittedToLynneAt: SENT,
      submittedAsName: "Jim DiCicco 1",
      voidedAt: "2026-09-01T16:00:00Z",
      removalCommunicatedAt: "2026-09-01T17:00:00Z",
    });
    expect(isRemovedSinceSubmission(e)).toBe(false);
  });

  it("a voided entry never counts as a rename, even if renamed first", () => {
    const e = entry({
      submittedToLynneAt: SENT,
      submittedAsName: "Old Name",
      entryName: "New Name",
      voidedAt: "2026-09-01T16:00:00Z",
    });
    expect(isRenamedSinceSubmission(e)).toBe(false);
    expect(isRemovedSinceSubmission(e)).toBe(true);
  });

  it("the three states are mutually exclusive across a mixed roster", () => {
    const roster = [
      entry({ id: "new" }),
      entry({
        id: "clean",
        submittedToLynneAt: SENT,
        submittedAsName: "Test 1",
      }),
      entry({
        id: "renamed",
        submittedToLynneAt: SENT,
        submittedAsName: "Old",
        entryName: "New",
      }),
      entry({
        id: "removed",
        submittedToLynneAt: SENT,
        submittedAsName: "Gone 1",
        voidedAt: "2026-09-01T16:00:00Z",
      }),
      entry({ id: "voided-unsent", voidedAt: "2026-09-01T16:00:00Z" }),
    ];
    for (const e of roster) {
      const hits = [
        isUnsentToLynne(e),
        isRenamedSinceSubmission(e),
        isRemovedSinceSubmission(e),
      ].filter(Boolean).length;
      expect(hits).toBeLessThanOrEqual(1);
    }
    expect(roster.filter(isUnsentToLynne).map((e) => e.id)).toEqual(["new"]);
    expect(roster.filter(isRenamedSinceSubmission).map((e) => e.id)).toEqual([
      "renamed",
    ]);
    expect(roster.filter(isRemovedSinceSubmission).map((e) => e.id)).toEqual([
      "removed",
    ]);
  });

  it("a removal is listed under the name Lynne's sheet carries", () => {
    const e = entry({
      entryName: "renamed after she got it",
      submittedAsName: "Jim DiCicco 1",
      submittedToLynneAt: SENT,
      voidedAt: "2026-09-01T16:00:00Z",
    });
    expect(nameOnLynnesSheet(e)).toBe("Jim DiCicco 1");
    expect(nameOnLynnesSheet(entry({ entryName: "Solo" }))).toBe("Solo");
  });
});
