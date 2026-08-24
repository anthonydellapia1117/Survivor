import { describe, expect, it } from "vitest";
import {
  collisionGroups,
  collisionKind,
  editDistance,
  findCollisions,
} from "@/lib/names";

describe("editDistance (capped OSA)", () => {
  it("counts substitution, insertion, deletion, transposition as 1", () => {
    expect(editDistance("tommybrads1", "tommybrads2")).toBe(1);
    expect(editDistance("pumpy321", "pumpy3211")).toBe(1);
    expect(editDistance("pumpy321", "pumpy32")).toBe(1);
    expect(editDistance("brads", "bards")).toBe(1); // transposition
  });

  it("caps beyond max instead of computing the true distance", () => {
    expect(editDistance("tom bradley", "ron malandro")).toBe(2);
    expect(editDistance("ab", "xy", 1)).toBe(2);
  });
});

describe("collisionKind", () => {
  it("exact for the very same string", () => {
    expect(collisionKind("Pumpy321", "Pumpy321")).toBe("exact");
  });

  it("case for case/spacing-only differences", () => {
    expect(collisionKind("Tommybrads2", "tommybrads2")).toBe("case");
    expect(collisionKind("Big  Kahuna", "big kahuna")).toBe("case");
  });

  it("edit1 across case folds — the tommybrads trap", () => {
    // Bases differ by case ("Tommybrads" vs "tommybrads") — NOT a clean
    // numbered set, so it stays flagged.
    expect(collisionKind("Tommybrads1", "tommybrads2")).toBe("edit1");
  });

  it("numbered sets are the naming convention, not a hazard", () => {
    expect(collisionKind("Nick&Kels 1", "Nick&Kels 2")).toBeNull();
    expect(collisionKind("Waggs1", "Waggs2")).toBeNull();
    expect(collisionKind("ReRe #1", "ReRe #2")).toBeNull();
    // Same number, different spacing = likely typo duplicate — flagged.
    expect(collisionKind("Waggs1", "Waggs 1")).toBe("edit1");
    // A cross-owner numbered pair is suspicious again.
    expect(
      collisionKind("Waggs1", "Waggs2", { sameOwner: false }),
    ).toBe("edit1");
  });

  it("null for safely distinct names", () => {
    expect(collisionKind("Pumpy321", "Big Kahuna")).toBeNull();
    expect(collisionKind("Nick&Kels 1", "Nick&Kels 34")).toBeNull(); // 2 edits
    expect(collisionKind("Maria DiCicco 1", "Tim Flaherty")).toBeNull();
  });
});

describe("findCollisions", () => {
  it("lists every hit, worst kind first", () => {
    const hits = findCollisions("tommybrads2", [
      "Tommybrads1",
      "tommybrads2",
      "Big Kahuna",
    ]);
    expect(hits).toEqual([
      { name: "tommybrads2", kind: "exact" },
      { name: "Tommybrads1", kind: "edit1" },
    ]);
  });
});

describe("collisionGroups", () => {
  it("numbered sets vanish; genuine hazards remain", () => {
    const groups = collisionGroups([
      "Nick&Kels 1",
      "Nick&Kels 2",
      "Nick&Kels 3",
      "Nick&Kels 4",
      "Big Kahuna",
      "Tommybrads1",
      "tommybrads2",
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].names).toEqual(["Tommybrads1", "tommybrads2"]);
    expect(groups[0].kind).toBe("edit1");
  });

  it("the same numbered set across two owners stays flagged", () => {
    const names = ["Waggs1", "Waggs2", "Waggs3"];
    expect(collisionGroups(names, ["Waggs", "Waggs", "Waggs"])).toEqual([]);
    const cross = collisionGroups(names, ["Waggs", "Waggs", "Somebody Else"]);
    expect(cross).toHaveLength(1);
    expect(cross[0].names).toContain("Waggs3");
  });

  it("elevates the group kind to the worst pair inside it", () => {
    const groups = collisionGroups(["Pumpy321", "pumpy321", "Pumpy322"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("case");
  });

  it("empty when every name is distinct", () => {
    expect(collisionGroups(["Alpha", "Bravo", "Charlie"])).toEqual([]);
  });
});
