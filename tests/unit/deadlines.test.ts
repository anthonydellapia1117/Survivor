import { describe, it, expect } from "vitest";
import {
  deadlineTier,
  pickDeadlineIso,
  teamDeadlines,
  TIER_LABEL,
} from "@/lib/deadlines";

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

describe("teamDeadlines", () => {
  // Week 1's real openers. Two teams in the same week, days apart.
  const week1 = [
    { dayOfWeek: "Wednesday" as const, awayTeam: "NE", homeTeam: "SEA" },
    { dayOfWeek: "Thursday" as const, awayTeam: "SF", homeTeam: "LAR" },
    { dayOfWeek: "Sunday" as const, awayTeam: "NO", homeTeam: "DET" },
  ];

  it("gives both sides of a game the same deadline", () => {
    const m = teamDeadlines(week1, EARLY, LATE);
    expect(m.get("NE")).toBe(m.get("SEA"));
    expect(m.get("SF")).toBe(m.get("LAR"));
  });

  it("separates teams by the day they play, inside one week", () => {
    const m = teamDeadlines(week1, EARLY, LATE);
    expect(ET(m.get("SEA")!)).toBe("Tue 09-08 12:00 PM");
    expect(ET(m.get("LAR")!)).toBe("Wed 09-09 12:00 PM");
    expect(ET(m.get("DET")!)).toBe("Fri 09-11 12:00 PM");
  });

  // The failure this exists to prevent: staging Seattle after Tuesday noon,
  // while the week's next open tier is still Wednesday, is already late. A
  // week-level "next deadline" cannot tell you that.
  it("marks Seattle late while Los Angeles is still open", () => {
    const m = teamDeadlines(week1, EARLY, LATE);
    const tuesdayAfternoon = Date.parse("2026-09-08T18:00:00.000Z");
    expect(Date.parse(m.get("SEA")!) < tuesdayAfternoon).toBe(true);
    expect(Date.parse(m.get("LAR")!) < tuesdayAfternoon).toBe(false);
  });

  it("omits a team with no game that week", () => {
    expect(teamDeadlines(week1, EARLY, LATE).has("KC")).toBe(false);
  });
});
