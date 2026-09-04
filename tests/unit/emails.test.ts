import { describe, it, expect } from "vitest";
import {
  buildPickRequest,
  buildPickRequests,
  ccAddress,
  deadlineRows,
  CONTACT_PHONE,
} from "@/lib/emails/pick-request";
import { renderEmailHtml, escapeHtml } from "@/lib/emails/template";
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

const owner = (entryNames: string[], ccEmail: string | null = null) => ({
  id: "o1",
  greetingName: "Caroline",
  email: "owner@example.com",
  ccEmail,
  entryNames,
});

describe("deadline rows follow the schedule, not a fixed count", () => {
  it("Week 1 shows three tiers — it has no Friday game", () => {
    const rows = deadlineRows(WEEK1, WEEK1_GAMES);
    expect(rows.map((r) => r.value)).toEqual([
      "Tue Sep 8, 12:00 PM ET",
      "Wed Sep 9, 12:00 PM ET",
      "Fri Sep 11, 12:00 PM ET",
    ]);
  });

  it("a week with a Friday game shows four, in order", () => {
    const rows = deadlineRows(WEEK1, [...WEEK1_GAMES, g(1, "Friday")]);
    expect(rows).toHaveLength(4);
    expect(rows[2].value).toBe("Thu Sep 10, 12:00 PM ET");
    // Strictly ascending: a later tier must never be listed before an earlier.
    const times = rows.map((r) => Date.parse(r.value.replace(" ET", " 2026")));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("always offers the Sat-Mon lock, even for a week with no games listed", () => {
    expect(deadlineRows(WEEK1, [])).toHaveLength(1);
  });

  it("names the weekday — a date alone makes a player go and look", () => {
    for (const r of deadlineRows(WEEK1, WEEK1_GAMES)) {
      expect(r.value).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /);
    }
  });
});

describe("a pick request carries what the owner needs to reply", () => {
  const built = buildPickRequest(
    owner(["Caroline Reichenback #1", "Caroline Reichenback #2"]),
    WEEK1,
    WEEK1_GAMES,
  );

  it("lists every entry by name, in both flavours", () => {
    for (const name of ["Caroline Reichenback #1", "Caroline Reichenback #2"]) {
      expect(built.html).toContain(name);
      expect(built.text).toContain(name);
    }
  });

  it("carries the contact number", () => {
    expect(built.html).toContain(CONTACT_PHONE);
    expect(built.text).toContain(CONTACT_PHONE);
  });

  it("addresses the owner and counts their entries in the subject", () => {
    expect(built.subject).toBe("Week 1 picks — Caroline (2 entries)");
    expect(built.html).toContain("Caroline —");
  });

  it("says entry, singular, for a one-entry owner", () => {
    const one = buildPickRequest(owner(["Pumpy321"]), WEEK1, WEEK1_GAMES);
    expect(one.subject).toBe("Week 1 pick — Caroline (1 entry)");
    expect(one.html).toContain("Your entry");
    expect(one.html).not.toContain("Your entries");
  });

  // The singular body used to say "for Week 1" literally, so from week 2 on a
  // one-entry owner got a subject naming the right week above a body naming
  // the wrong one.
  it("names the selected week in the body, not just the subject", () => {
    const w5 = { ...WEEK1, week: 5 };
    for (const names of [["Solo"], ["A #1", "A #2"]]) {
      const b = buildPickRequest(owner(names), w5, [g(5, "Sunday")]);
      expect(b.subject).toContain("Week 5");
      expect(b.html).not.toContain("Week 1");
      expect(b.text).not.toContain("Week 1");
    }
  });
});

describe("the HTML survives Gmail", () => {
  const built = buildPickRequest(owner(["A #1"]), WEEK1, WEEK1_GAMES);

  // Gmail strips <style> and class attributes, so a rule that lives in either
  // is a rule that does not arrive. Everything must be inline.
  it("uses no style block and no classes", () => {
    expect(built.html).not.toMatch(/<style/i);
    expect(built.html).not.toMatch(/\sclass=/i);
  });

  it("paints its own dark background rather than inheriting one", () => {
    // Pasting into a compose window drops the page behind the content, so a
    // message that relies on a body colour arrives dark-on-white.
    expect(built.html).toMatch(/background-color:#0b0d0f/);
  });

  it("is a fragment, not a document — it goes inside a compose window", () => {
    expect(built.html).not.toMatch(/<!doctype|<html|<head|<body/i);
  });
});

describe("owner-supplied names cannot inject markup", () => {
  // Entry names are stored verbatim by policy and are owner-supplied, so they
  // reach the renderer as untrusted text.
  it("escapes angle brackets and ampersands in an entry name", () => {
    const built = buildPickRequest(
      owner(["<script>alert(1)</script>", "Maria & Mary #1"]),
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built.html).not.toContain("<script>");
    expect(built.html).toContain("&lt;script&gt;");
    expect(built.html).toContain("Maria &amp; Mary #1");
  });

  it("leaves the plain-text flavour verbatim", () => {
    const built = buildPickRequest(
      owner(["Maria & Mary #1"]),
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built.text).toContain("Maria & Mary #1");
  });

  it("escapeHtml covers quotes as well as brackets", () => {
    expect(escapeHtml(`a"b'c<d>e&f`)).toBe("a&quot;b&#039;c&lt;d&gt;e&amp;f");
  });
});

describe("the batch reports rather than guesses", () => {
  const base = {
    greetingName: "X",
    fullName: "X Y",
    ccEmail: null,
    entryNames: ["X #1"],
  };

  it("skips an owner with no email and names them", () => {
    const { built, skippedNoEmail } = buildPickRequests(
      [
        { ...base, id: "a", email: "a@x.com" },
        { ...base, id: "b", email: null, fullName: "No Address" },
        { ...base, id: "c", email: "   ", fullName: "Blank Address" },
      ],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built).toHaveLength(1);
    expect(skippedNoEmail.map((s) => s.name)).toEqual([
      "No Address",
      "Blank Address",
    ]);
    expect(skippedNoEmail[0].entryCount).toBe(1);
  });

  it("ignores an owner with no live entries entirely — not a skip, just nothing to say", () => {
    const { built, skippedNoEmail } = buildPickRequests(
      [{ ...base, id: "a", email: null, entryNames: [] }],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built).toHaveLength(0);
    expect(skippedNoEmail).toHaveLength(0);
  });

  it("trims a padded address rather than mailing whitespace", () => {
    const { built } = buildPickRequests(
      [{ ...base, id: "a", email: "  a@x.com  " }],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built[0].to).toBe("a@x.com");
  });
});

describe("the shell is reusable, not pick-specific", () => {
  it("renders an arbitrary block set — what a recap or standings mail needs", () => {
    const html = renderEmailHtml({
      subject: "s",
      eyebrow: "AD Survivor Pool",
      title: "Week 1 results",
      greeting: "All —",
      blocks: [
        { kind: "paragraph", text: "Nine entries out." },
        {
          kind: "rows",
          caption: "Standings",
          rows: [{ label: "Still alive", value: "85" }],
        },
      ],
      footer: "f",
    });
    expect(html).toContain("Week 1 results");
    expect(html).toContain("Still alive");
    expect(html).not.toMatch(/\sclass=/i);
  });
});

// A second contact address, for the case that produced it: Kris Tomasco owns
// and pays for four entries, two of which Chas Flaster plays. One message, the
// owner as recipient, the player copied.
describe("a second contact address is copied, not substituted", () => {
  const KRIS = [
    "Kris Tomasco #1",
    "Kris Tomasco #2",
    "Chas Flaster #1",
    "Chas Flaster #2",
  ];

  it("carries the CC address when one is on file", () => {
    const b = buildPickRequest(
      owner(KRIS, "second@example.com"),
      WEEK1,
      WEEK1_GAMES,
    );
    expect(b.to).toBe("owner@example.com");
    expect(b.cc).toBe("second@example.com");
  });

  it("leaves the CC empty when there is none — the header is then omitted", () => {
    expect(buildPickRequest(owner(KRIS), WEEK1, WEEK1_GAMES).cc).toBe("");
  });

  // The owner is still the one asked for the picks, and the message still
  // lists every entry: the CC changes who SEES it, never who owns it or what
  // it says. If this ever fails, a CC has started editing the message.
  it("does not change the message the owner receives", () => {
    const plain = buildPickRequest(owner(KRIS), WEEK1, WEEK1_GAMES);
    const copied = buildPickRequest(
      owner(KRIS, "second@example.com"),
      WEEK1,
      WEEK1_GAMES,
    );
    expect(copied.subject).toBe(plain.subject);
    expect(copied.html).toBe(plain.html);
    expect(copied.text).toBe(plain.text);
    for (const name of KRIS) expect(copied.text).toContain(name);
  });

  it("drops a CC that is the recipient, whatever its case or padding", () => {
    for (const same of [
      "owner@example.com",
      "  Owner@Example.COM  ",
    ]) {
      expect(buildPickRequest(owner(KRIS, same), WEEK1, WEEK1_GAMES).cc).toBe(
        "",
      );
    }
  });

  it("treats a blank CC as none rather than mailing whitespace", () => {
    expect(ccAddress("a@x.com", "   ")).toBe("");
    expect(ccAddress("a@x.com", "")).toBe("");
    expect(ccAddress("a@x.com", null)).toBe("");
    expect(ccAddress("a@x.com", "  b@x.com  ")).toBe("b@x.com");
  });

  it("carries the CC through the batch builder", () => {
    const { built } = buildPickRequests(
      [
        {
          id: "a",
          greetingName: "Kris",
          fullName: "Kris Tomasco",
          email: "owner@example.com",
          ccEmail: "second@example.com",
          entryNames: KRIS,
        },
        {
          id: "b",
          greetingName: "Solo",
          fullName: "Solo Owner",
          email: "solo@x.com",
          ccEmail: null,
          entryNames: ["Solo"],
        },
      ],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built.map((b) => b.cc)).toEqual(["second@example.com", ""]);
  });

  // A CC is a copy, never a fallback. An owner with no address of their own is
  // still reported as unmailable even when somebody else could be copied —
  // sending only to the CC would ask the wrong person for the picks.
  it("does not let a CC stand in for a missing owner address", () => {
    const { built, skippedNoEmail } = buildPickRequests(
      [
        {
          id: "a",
          greetingName: "X",
          fullName: "No Address",
          email: null,
          ccEmail: "someone@x.com",
          entryNames: ["X #1"],
        },
      ],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built).toHaveLength(0);
    expect(skippedNoEmail.map((s) => s.name)).toEqual(["No Address"]);
  });
});
