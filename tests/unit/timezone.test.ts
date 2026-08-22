import { describe, expect, it } from "vitest";
import { etWallToUtc, utcToEtWall } from "@/lib/timezone";

describe("ET wall-clock conversion", () => {
  it("noon EDT (September) is 16:00 UTC", () => {
    expect(etWallToUtc("2026-09-16", "12:00")).toBe("2026-09-16T16:00:00.000Z");
  });

  it("noon EST (December) is 17:00 UTC", () => {
    expect(etWallToUtc("2026-12-02", "12:00")).toBe("2026-12-02T17:00:00.000Z");
  });

  it("handles the fall-back day (DST ends Nov 1 2026)", () => {
    expect(etWallToUtc("2026-11-01", "12:00")).toBe("2026-11-01T17:00:00.000Z");
    expect(etWallToUtc("2026-10-31", "12:00")).toBe("2026-10-31T16:00:00.000Z");
  });

  it("round-trips every seeded deadline", () => {
    for (const iso of [
      "2026-09-08T16:00:00.000Z",
      "2026-10-28T16:00:00.000Z",
      "2026-11-04T17:00:00.000Z",
      "2027-01-08T17:00:00.000Z",
    ]) {
      const wall = utcToEtWall(iso);
      expect(wall.time).toBe("12:00");
      expect(etWallToUtc(wall.date, wall.time)).toBe(iso);
    }
  });
});
