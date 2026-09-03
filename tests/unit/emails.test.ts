import { describe, it, expect } from "vitest";
import {
  buildPickRequest,
  buildPickRequests,
  deadlineRows,
  CONTACT_PHONE,
} from "@/lib/emails/pick-request";
import { renderEmailHtml, renderEmailText } from "@/lib/emails/template";
import type { GameRow, WeekRow } from "@/lib/data/types";

// Week 1 as seeded: early = Wed 09-09 noon ET, late = Fri 09-11 noon ET.
const WEEK1: WeekRow = {
  week: 1,
  windowLabel: "thu_fri",
  deadlineAt: "2026-09-11T16:00:00+00:00",
  earlyDeadlineAt: "2026-09-09T16:00:00+00:00",
  lateDeadlineAt: "2026-09-11T16:00:00+00:00",
  resultsFinal: false,
  confirmed: true,
};

const g = (
  week: number,
  dayOfWeek: GameRow["dayOfWeek"],
): Pick<GameRow, "week" | "dayOfWeek"> => ({ week, dayOfWeek });

const WEEK1_GAMES = [
  g(1, "Wednesday"),
  g(1, "Thursday"),
  g(1, "Sunday"),
  g(1, "Monday"),
];

const owner = (entryNames: string[]) => ({
  id: "o1",
  greetingName: "Caroline",
  email: "carolinehamlett@gmail.com",
  entryNames,
});

describe("deadline rows follow the week's real tiers", () => {
  it("gives Week 1 three tiers, in order, with the weekday spelled out", () => {
    const rows = deadlineRows(WEEK1, WEEK1_GAMES);
    expect(rows.map((r) => r.value)).toEqual([
      "Tue Sep 8, 12:00 PM ET",
      "Wed Sep 9, 12:00 PM ET",
      "Fri Sep 11, 12:00 PM ET",
    ]);
  });

  // Hardcoding three would be wrong twice a season. Week 12 has a Wednesday
  // game, Thanksgiving, Black Friday and the weekend.
  it("gives a week with a Friday game four tiers", () => {
    const rows = deadlineRows(WEEK1, [...WEEK1_GAMES, g(1, "Friday")]);
    expect(rows).toHaveLength(4);
    expect(rows[2].value).toBe("Thu Sep 10, 12:00 PM ET");
  });

  it("always offers the Sat-Mon lock, even with no game that day", () => {
    const rows = deadlineRows(WEEK1, [g(1, "Thursday")]);
    expect(rows.map((r) => r.label)).toContain(
      "If your team plays Sat, Sun or Mon",
    );
  });

  it("ignores games from other weeks", () => {
    expect(deadlineRows(WEEK1, [g(2, "Friday"), g(1, "Sunday")])).toHaveLength(
      1,
    );
  });
});

describe("the message carries what the owner needs to reply", () => {
  const built = buildPickRequest(
    owner([
      "Caroline Reichenback #1",
      "Caroline Reichenback #2",
      "Caroline Reichenback #3",
      "Caroline Reichenback #4",
    ]),
    WEEK1,
    WEEK1_GAMES,
  );

  it("names every entry, in both renderings", () => {
    for (let i = 1; i <= 4; i += 1) {
      expect(built.html).toContain(`Caroline Reichenback #${i}`);
      expect(built.text).toContain(`Caroline Reichenback #${i}`);
    }
  });

  it("addresses the owner and carries the phone", () => {
    expect(built.html).toContain("Caroline —");
    expect(built.html).toContain(CONTACT_PHONE);
    expect(built.text).toContain(CONTACT_PHONE);
  });

  it("says how many entries in the subject so a reply can be checked off", () => {
    expect(built.subject).toBe("Week 1 picks — Caroline (4 entries)");
  });

  it("reads as one entry, not 1 entries, for a single-entry owner", () => {
    const one = buildPickRequest(owner(["Pumpy321"]), WEEK1, WEEK1_GAMES);
    expect(one.subject).toBe("Week 1 pick — Caroline (1 entry)");
    expect(one.html).toContain("Your entry");
    expect(one.html).not.toContain("Your entries");
  });
});

describe("Gmail-safe rendering", () => {
  const built = buildPickRequest(owner(["A #1"]), WEEK1, WEEK1_GAMES);

  // Gmail strips <style> blocks and class attributes on paste, so a look that
  // depends on either arrives as unstyled text.
  it("uses no <style> block and no classes", () => {
    expect(built.html).not.toMatch(/<style/i);
    expect(built.html).not.toMatch(/class=/i);
  });

  it("paints the dark background on the content itself", () => {
    // Nothing survives on <body>, so the colour has to be on the tables.
    expect(built.html).toContain("background-color:#0b0d0f");
  });

  it("uses no CSS variables, which do not resolve in mail clients", () => {
    expect(built.html).not.toContain("var(--");
  });
});

describe("names are rendered verbatim but escaped", () => {
  // Entry names are stored verbatim and include apostrophes and ampersands.
  // They must read correctly and must not be able to inject markup.
  it("keeps the characters and closes no tags", () => {
    const built = buildPickRequest(
      owner(["thedrick's picks", "Maria & Mary #1", "<b>not bold</b>"]),
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built.html).toContain("thedrick&#039;s picks");
    expect(built.html).toContain("Maria &amp; Mary #1");
    expect(built.html).toContain("&lt;b&gt;not bold&lt;/b&gt;");
    expect(built.html).not.toContain("<b>not bold</b>");
    // The plain-text side is not markup, so it stays exactly as stored.
    expect(built.text).toContain("thedrick's picks");
    expect(built.text).toContain("Maria & Mary #1");
  });
});

describe("the batch reports who cannot be mailed", () => {
  const base = {
    entryNames: ["X #1"],
    greetingName: "X",
    fullName: "Ex Ample",
  };

  it("skips an owner with no address and names them", () => {
    const out = buildPickRequests(
      [
        { ...base, id: "a", email: "a@x.com" },
        { ...base, id: "b", email: null, fullName: "No Address" },
        { ...base, id: "c", email: "   ", fullName: "Blank Address" },
      ],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(out.built.map((b) => b.ownerId)).toEqual(["a"]);
    expect(out.skippedNoEmail.map((s) => s.name)).toEqual([
      "No Address",
      "Blank Address",
    ]);
  });

  it("leaves out an owner with no entries entirely", () => {
    const out = buildPickRequests(
      [{ ...base, id: "a", email: "a@x.com", entryNames: [] }],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(out.built).toHaveLength(0);
    expect(out.skippedNoEmail).toHaveLength(0);
  });
});

describe("the shell is reusable for other season mail", () => {
  // A recap or standings message is the same shell with different blocks.
  // If this stops compiling or rendering, the template has stopped being
  // general and has become the pick request only.
  const doc = {
    subject: "Week 1 results",
    eyebrow: "AD Survivor Pool",
    title: "Week 1 results",
    greeting: "All —",
    blocks: [
      { kind: "lead" as const, text: "Week 1 is scored." },
      {
        kind: "rows" as const,
        caption: "Standings",
        rows: [
          { label: "Still alive", value: "81", accent: "#10b981" },
          { label: "Out", value: "13", accent: "#ef4444" },
        ],
      },
    ],
    footer: "Reply with questions.",
  };

  it("renders both forms without a pick-request block", () => {
    const html = renderEmailHtml(doc);
    expect(html).toContain("Week 1 results");
    expect(html).toContain("Still alive");
    // Accent colours are honoured, so a recap can mark wins and losses.
    expect(html).toContain("#10b981");
    expect(html).toContain("#ef4444");
  });

  it("aligns the value column in the plain-text form", () => {
    // The padding exists so numbers line up under each other; asserting the
    // alignment rather than a literal run of spaces keeps this about the
    // property and not about how wide today's labels happen to be.
    const lines = renderEmailText(doc)
      .split("\n")
      .filter((l) => l.includes("81") || l.includes("13"));
    expect(lines).toHaveLength(2);
    const at = lines.map((l) => l.search(/\d/));
    expect(at[0]).toBe(at[1]);
  });
});
