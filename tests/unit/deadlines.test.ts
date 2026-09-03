import { describe, it, expect } from "vitest";
import { deadlineTier, pickDeadlineIso, TIER_LABEL } from "@/lib/deadlines";

// The week's two stored boundaries, as seeded for every week including Week 1:
//   early = Wednesday 2026-09-09 12:00 ET   late = Friday 2026-09-11 12:00 ET
const EARLY = "2026-09-09T16:00:00.000Z";
const LATE = "2026-09-11T16:00:00.000Z";

// Built from formatToParts rather than toLocaleString: the latter's
// punctuation, spacing and ordering vary between Node/ICU builds, so a passing
// assertion here could break on a different runtime without the deadline
// changing at all. Assembling the parts ourselves pins the shape.
const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const ET = (iso: string): string => {
  const p = Object.fromEntries(
    ET_PARTS.formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.month}-${p.day} ${p.hour}:${p.minute} ${p.dayPeriod}`;
};

describe("deadlineTier", () => {
  it("puts each early day in its own tier and Sat-Mon in one", () => {
    expect(deadlineTier("Wednesday")).toBe("wed");
    expect(deadlineTier("Thursday")).toBe("thu");
    expect(deadlineTier("Friday")).toBe("fri");
    expect(deadlineTier("Saturday")).toBe("late");
    expect(deadlineTier("Sunday")).toBe("late");
    expect(deadlineTier("Monday")).toBe("late");
  });

  it("treats a bye or unknown team as the late boundary, like the SQL side", () => {
    expect(deadlineTier(null)).toBe("late");
    expect(deadlineTier(undefined)).toBe("late");
  });
});

describe("pickDeadlineIso", () => {
  // Anthony's rule, stated as the three cases he gave for Week 1.
  it("closes a Wednesday game at Tuesday noon ET", () => {
    expect(ET(pickDeadlineIso("Wednesday", EARLY, LATE))).toBe(
      "Tue 09-08 12:00 PM",
    );
  });

  it("closes a Thursday game at Wednesday noon ET", () => {
    expect(ET(pickDeadlineIso("Thursday", EARLY, LATE))).toBe(
      "Wed 09-09 12:00 PM",
    );
  });

  it("closes Saturday, Sunday and Monday together at Friday noon ET", () => {
    for (const day of ["Saturday", "Sunday", "Monday"] as const) {
      expect(ET(pickDeadlineIso(day, EARLY, LATE))).toBe("Fri 09-11 12:00 PM");
    }
  });

  // Not one of the three tiers Anthony stated; follows the same day-before
  // principle. Pinned so the choice is visible rather than incidental.
  it("closes a Friday game at Thursday noon ET", () => {
    expect(ET(pickDeadlineIso("Friday", EARLY, LATE))).toBe(
      "Thu 09-10 12:00 PM",
    );
  });

  it("gives every early tier a full day before the next", () => {
    const wed = Date.parse(pickDeadlineIso("Wednesday", EARLY, LATE));
    const thu = Date.parse(pickDeadlineIso("Thursday", EARLY, LATE));
    const fri = Date.parse(pickDeadlineIso("Friday", EARLY, LATE));
    const day = 24 * 60 * 60 * 1000;
    expect(thu - wed).toBe(day);
    expect(fri - thu).toBe(day);
  });

  it("has no Week 1 special case — the tiers depend only on the day", () => {
    // The bug: every Week 1 pick collapsed onto one Tuesday lock. If that
    // ever comes back, these four stop being distinct.
    const seen = new Set(
      (["Wednesday", "Thursday", "Friday", "Sunday"] as const).map((d) =>
        pickDeadlineIso(d, EARLY, LATE),
      ),
    );
    expect(seen.size).toBe(4);
  });

  it("moves the derived tiers with an edited early deadline", () => {
    // The Weeks screen can move a deadline; the tiers stay one day apart.
    const shifted = "2026-09-10T16:00:00.000Z";
    expect(pickDeadlineIso("Wednesday", shifted, LATE)).toBe(EARLY);
    expect(pickDeadlineIso("Thursday", shifted, LATE)).toBe(shifted);
  });
});

describe("TIER_LABEL", () => {
  it("names the day each tier closes on", () => {
    expect(TIER_LABEL.wed).toBe("Tuesday");
    expect(TIER_LABEL.thu).toBe("Wednesday");
    expect(TIER_LABEL.fri).toBe("Thursday");
    expect(TIER_LABEL.late).toBe("Friday");
  });
});
