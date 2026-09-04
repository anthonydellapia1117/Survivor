import { describe, it, expect } from "vitest";
import { buildPickRequests, CONTACT_PHONE } from "@/lib/emails/pick-request";
import { renderEmailHtml, escapeHtml } from "@/lib/emails/template";
import { groupSendList } from "@/lib/emails/group-send";
import { recipientsForPicks } from "@/lib/emails/recipients";
import { isPlausibleAddress } from "@/lib/emails/address";
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

const entry = (
  entryName: string,
  opts: { gifted?: boolean; player?: string | null } = {},
) => ({
  id: `e-${entryName}`,
  entryName,
  isGifted: opts.gifted ?? opts.player != null,
  playerEmail: opts.player ?? null,
});

const ownerRow = (
  entries: ReturnType<typeof entry>[],
  email: string | null = "owner@example.com",
) => ({
  id: "o1",
  greetingName: "Caroline",
  fullName: "Caroline Reichenback",
  email,
  entries,
});

/** The single message an ungifted roster produces. */
const only = (entries: ReturnType<typeof entry>[]) =>
  buildPickRequests([ownerRow(entries)], WEEK1, WEEK1_GAMES).built[0];

describe("a pick request carries what the recipient needs to reply", () => {
  const built = only([
    entry("Caroline Reichenback #1"),
    entry("Caroline Reichenback #2"),
  ]);

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
    const one = only([entry("Pumpy321")]);
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
      const b = buildPickRequests(
        [ownerRow(names.map((n) => entry(n)))],
        w5,
        [g(5, "Sunday")],
      ).built[0];
      expect(b.subject).toContain("Week 5");
      expect(b.html).not.toContain("Week 1");
      expect(b.text).not.toContain("Week 1");
    }
  });
});

describe("the HTML survives Gmail", () => {
  const built = only([entry("A #1")]);

  // Gmail strips <style> and class attributes, so a rule that lives in either
  // is a rule that does not arrive. Everything must be inline.
  it("uses no style block and no classes", () => {
    expect(built.html).not.toMatch(/<style/i);
    expect(built.html).not.toMatch(/\sclass=/i);
  });

  it("paints its own dark background rather than inheriting one", () => {
    expect(built.html).toMatch(/background-color:#0b0d0f/);
  });

  it("is a fragment, not a document — it goes inside a compose window", () => {
    expect(built.html).not.toMatch(/<!doctype|<html|<head|<body/i);
  });
});

describe("owner-supplied names cannot inject markup", () => {
  it("escapes angle brackets and ampersands in an entry name", () => {
    const built = only([
      entry("<script>alert(1)</script>"),
      entry("Maria & Mary #1"),
    ]);
    expect(built.html).not.toContain("<script>");
    expect(built.html).toContain("&lt;script&gt;");
    expect(built.html).toContain("Maria &amp; Mary #1");
  });

  it("leaves the plain-text flavour verbatim", () => {
    expect(only([entry("Maria & Mary #1")]).text).toContain("Maria & Mary #1");
  });

  it("escapeHtml covers quotes as well as brackets", () => {
    expect(escapeHtml(`a"b'c<d>e&f`)).toBe("a&quot;b&#039;c&lt;d&gt;e&amp;f");
  });
});

// The unit is the recipient, not the owner. Kris Tomasco buys four and gives
// two to Chas Flaster; Chas gets his own message about his own two.
describe("a gifted entry goes to whoever plays it", () => {
  const KRIS = () =>
    ownerRow(
      [
        entry("Kris Tomasco #1"),
        entry("Kris Tomasco #2"),
        entry("Chas Flaster #1", { player: "chas@example.com" }),
        entry("Chas Flaster #2", { player: "chas@example.com" }),
      ],
      "kris@example.com",
    );

  it("splits one owner into two messages, each listing only its own entries", () => {
    const { built } = buildPickRequests([KRIS()], WEEK1, WEEK1_GAMES);
    expect(built).toHaveLength(2);

    const [toKris, toChas] = built;
    expect(toKris.kind).toBe("owner");
    expect(toKris.to).toBe("kris@example.com");
    expect(toKris.text).toContain("Kris Tomasco #1");
    expect(toKris.text).not.toContain("Chas Flaster");

    expect(toChas.kind).toBe("player");
    expect(toChas.to).toBe("chas@example.com");
    expect(toChas.text).toContain("Chas Flaster #1");
    expect(toChas.text).toContain("Chas Flaster #2");
    expect(toChas.text).not.toContain("Kris Tomasco #1");
  });

  it("gives one giftee ONE message for both their entries", () => {
    const { built } = buildPickRequests([KRIS()], WEEK1, WEEK1_GAMES);
    const player = built.filter((b) => b.kind === "player");
    expect(player).toHaveLength(1);
    expect(player[0].subject).toContain("(2 entries)");
  });

  it("keys the giftee case-insensitively — one mailbox is one person", () => {
    const { built } = buildPickRequests(
      [
        ownerRow(
          [
            entry("A #1", { player: "chas@example.com" }),
            entry("A #2", { player: "Chas@Example.COM" }),
          ],
          "kris@example.com",
        ),
      ],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built).toHaveLength(1);
    expect(built[0].subject).toContain("(2 entries)");
  });

  it("tells the giftee whose entries these are, and the owner nothing new", () => {
    const { built } = buildPickRequests([KRIS()], WEEK1, WEEK1_GAMES);
    const [toKris, toChas] = built;
    expect(toChas.text).toContain("Caroline Reichenback");
    expect(toChas.text).toContain("yours to make");
    // Kris keeps two of his own, so the owner footer reads plural. The old
    // wording was hardcoded singular whatever the count.
    expect(toKris.text).toContain("you have entries in Anthony's group");
    expect(toKris.text).not.toContain("yours to make");
  });

  // Neither of the next two exists in the roster today. Both are one more
  // gift away, and keying the buckets on the (owner, person) PAIR produced
  // two emails for one person in each -- the exact "reads a list and works
  // out which half is theirs" problem the recipient unit exists to end.
  it("one person gifted by two buyers gets ONE message naming both", () => {
    const { built } = buildPickRequests(
      [
        {
          id: "o1",
          greetingName: "Kris",
          fullName: "Kris Tomasco",
          email: "kris@example.com",
          entries: [
            entry("Kris #1"),
            entry("Chas #1", { player: "chas@example.com" }),
          ],
        },
        {
          id: "o2",
          greetingName: "Ray",
          fullName: "Ray Vassallo",
          email: "ray@example.com",
          entries: [
            entry("Rayvas #1"),
            entry("Chas #2", { player: "CHAS@example.com" }),
          ],
        },
      ],
      WEEK1,
      WEEK1_GAMES,
    );
    const toChas = built.filter((b) => b.to.toLowerCase() === "chas@example.com");
    expect(toChas).toHaveLength(1);
    expect(toChas[0].subject).toContain("(2 entries)");
    expect(toChas[0].buyers.map((b) => b.name)).toEqual([
      "Kris Tomasco",
      "Ray Vassallo",
    ]);
    // Both buyers named, so nobody wonders who put which entry in their name.
    expect(toChas[0].text).toContain("Kris Tomasco and Ray Vassallo");
    // Three messages total, not four: Kris, Ray, Chas.
    expect(built).toHaveLength(3);
  });

  it("somebody who owns entries AND is gifted one gets a single mixed message", () => {
    const { built } = buildPickRequests(
      [
        {
          id: "o1",
          greetingName: "Kris",
          fullName: "Kris Tomasco",
          email: "kris@example.com",
          entries: [
            entry("Kris #1"),
            // Gifted to Ray, who is an owner in his own right.
            entry("Extra", { player: "ray@example.com" }),
          ],
        },
        {
          id: "o2",
          greetingName: "Ray",
          fullName: "Ray Vassallo",
          email: "ray@example.com",
          entries: [entry("Rayvas #1")],
        },
      ],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built).toHaveLength(2);
    const toRay = built.find((b) => b.to === "ray@example.com")!;
    expect(toRay.kind).toBe("mixed");
    expect(toRay.subject).toContain("(2 entries)");
    // Greeted as himself, not by his entry names: the roster knows who he is.
    expect(toRay.text).toContain("Ray —");
    expect(toRay.text).toContain("you have entries in Anthony's group");
    expect(toRay.text).toContain("Kris Tomasco put another in your name");
    expect(toRay.text).toContain("all yours to make");
  });

  it("keeps the buyer's own message first, in roster order", () => {
    const { built } = buildPickRequests([KRIS()], WEEK1, WEEK1_GAMES);
    expect(built.map((b) => b.kind)).toEqual(["owner", "player"]);
  });

  it("names the buyer on a giftee's message, and nobody on the owner's own", () => {
    const { built } = buildPickRequests([KRIS()], WEEK1, WEEK1_GAMES);
    const owner = built.find((b) => b.kind === "owner")!;
    const player = built.find((b) => b.kind === "player")!;
    // The owner bought their own: there is no third party to name.
    expect(owner.buyers).toEqual([]);
    expect(player.buyers).toEqual([
      { id: "o1", name: "Caroline Reichenback" },
    ]);
    // Keys are distinct, or the screen cannot tell the messages apart.
    expect(new Set(built.map((b) => b.key)).size).toBe(built.length);
  });

  // A gifted entry whose player address IS the owner's is the owner's to
  // play. Same rule sameAddress applies everywhere else.
  it("keeps an entry gifted back to the owner on the owner's message", () => {
    const { built } = buildPickRequests(
      [
        ownerRow(
          [entry("A #1"), entry("A #2", { player: "  Kris@Example.com " })],
          "kris@example.com",
        ),
      ],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built).toHaveLength(1);
    expect(built[0].kind).toBe("owner");
    expect(built[0].subject).toContain("(2 entries)");
  });
});

describe("the batch reports rather than guesses", () => {
  it("skips an owner with no email, and names the entries nobody can be asked for", () => {
    const { built, skippedNoEmail } = buildPickRequests(
      [ownerRow([entry("X #1")], null), ownerRow([entry("Y #1")], "   ")],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built).toHaveLength(0);
    expect(skippedNoEmail).toHaveLength(2);
    expect(skippedNoEmail[0].entryNames).toEqual(["X #1"]);
  });

  it("ignores an owner with no live entries entirely — not a skip", () => {
    const { built, skippedNoEmail } = buildPickRequests(
      [ownerRow([], null)],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built).toHaveLength(0);
    expect(skippedNoEmail).toHaveLength(0);
  });

  it("trims a padded address rather than mailing whitespace", () => {
    const { built } = buildPickRequests(
      [ownerRow([entry("A #1")], "  a@x.com  ")],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built[0].to).toBe("a@x.com");
  });

  // Lou Direnzo #1-#2: gifted, address unknown. The gap worth chasing, and
  // the reason is_gifted is its own column rather than derived from the
  // address being present.
  it("reports a gifted entry with no player address as a gap", () => {
    const { built, giftedWithoutEmail } = buildPickRequests(
      [
        ownerRow(
          [entry("Nick #1"), entry("Lou Direnzo #1", { gifted: true })],
          "nick@example.com",
        ),
      ],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(giftedWithoutEmail).toEqual([
      {
        entryId: "e-Lou Direnzo #1",
        entryName: "Lou Direnzo #1",
        ownerId: "o1",
        ownerName: "Caroline Reichenback",
      },
    ]);
    // It stays on the buyer's message meanwhile — the pick still has to be
    // asked for by somebody.
    expect(built).toHaveLength(1);
    expect(built[0].text).toContain("Lou Direnzo #1");
  });

  // A giftee is reachable on their own address whatever the buyer's state.
  it("still mails the giftee when the buyer has no address", () => {
    const { built, skippedNoEmail } = buildPickRequests(
      [
        ownerRow(
          [entry("A #1"), entry("B #1", { player: "player@example.com" })],
          null,
        ),
      ],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built).toHaveLength(1);
    expect(built[0].to).toBe("player@example.com");
    expect(skippedNoEmail[0].entryNames).toEqual(["A #1"]);
  });

  it("does not report an owner as unmailable when every entry is gifted away", () => {
    const { built, skippedNoEmail } = buildPickRequests(
      [ownerRow([entry("B #1", { player: "player@example.com" })], null)],
      WEEK1,
      WEEK1_GAMES,
    );
    expect(built).toHaveLength(1);
    expect(skippedNoEmail).toEqual([]);
  });
});

describe("recipientsForPicks is the one place the unit is decided", () => {
  it("returns nothing for an empty roster", () => {
    expect(recipientsForPicks([])).toEqual({
      recipients: [],
      ownersWithoutEmail: [],
      giftedWithoutEmail: [],
    });
  });

  it("greets a giftee by the entries they play, since no name is stored", () => {
    const { recipients } = recipientsForPicks([
      ownerRow(
        [
          entry("Chas Flaster #1", { player: "chas@example.com" }),
          entry("Chas Flaster #2", { player: "chas@example.com" }),
        ],
        "kris@example.com",
      ),
    ]);
    expect(recipients[0].greetingName).toBe(
      "Chas Flaster #1 and Chas Flaster #2",
    );
  });
});

// The group send is owner addresses. A person who only plays entries somebody
describe("a group send reaches the people who play, not just the buyers", () => {
  it("lists owner addresses, deduplicated, naming the row that repeated one", () => {
    const list = groupSendList([
      { id: "a", name: "A", email: "shared@example.com" },
      { id: "b", name: "B", email: "SHARED@example.com" },
      { id: "c", name: "C", email: "  c@example.com  " },
      { id: "d", name: "D", email: "   " },
    ]);
    expect(list.addresses).toEqual(["shared@example.com", "c@example.com"]);
    expect(list.duplicates).toEqual([
      { ownerId: "b", ownerName: "B", address: "SHARED@example.com" },
    ]);
    expect(list.missingEmail.map((o) => o.name)).toEqual(["D"]);
  });

  // The failure this guards is the one Anthony named: "if I send a batch and
  // the CC contacts are missing, Chas does not get his email and I would not
  // know." The source moved from owners.cc_email to entries.player_email; the
  // giftee still has to be on the announcement list.
  it("includes the people who play an owner's entries when asked", () => {
    const owners = [
      {
        id: "kris",
        name: "Kris Tomasco",
        email: "eaglesfor50@aol.com",
        // Two gifted entries, one person: one address on the list.
        players: ["chas.flaster@gmail.com", "chas.flaster@gmail.com"],
      },
    ];
    const all = groupSendList(owners, { includeGiftedPlayers: true });
    expect(all.addresses).toEqual([
      "eaglesfor50@aol.com",
      "chas.flaster@gmail.com",
    ]);
    expect(all.giftedPlayers).toEqual([
      {
        ownerId: "kris",
        ownerName: "Kris Tomasco",
        address: "chas.flaster@gmail.com",
      },
    ]);
    // ...and that repeat is NOT a collision. `duplicates` means one mailbox
    // on more than one ROW, which is an intake mistake worth chasing; a
    // giftee playing two of the same owner's entries is the ordinary case
    // and must not pollute it.
    expect(all.duplicates).toEqual([]);

    // ...and off by default, which is what the money filters use: a giftee is
    // not BCC'd on a note about the buyer's balance.
    const owed = groupSendList(owners);
    expect(owed.addresses).toEqual(["eaglesfor50@aol.com"]);
    expect(owed.giftedPlayers).toEqual([]);
  });

  it("reaches a giftee even when the buyer has no address of their own", () => {
    const list = groupSendList(
      [{ id: "o", name: "O", email: null, players: ["player@example.com"] }],
      { includeGiftedPlayers: true },
    );
    // Differs from a pick request on purpose: there a giftee is never a
    // stand-in for the owner. An announcement is not addressed to one person.
    expect(list.addresses).toEqual(["player@example.com"]);
    expect(list.missingEmail.map((o) => o.name)).toEqual(["O"]);
  });

  it("a gift back to the buyer's own address is one person, not two", () => {
    const list = groupSendList(
      [
        {
          id: "o",
          name: "O",
          email: "owner@example.com",
          players: ["  OWNER@Example.com  ", "   "],
        },
      ],
      { includeGiftedPlayers: true },
    );
    expect(list.addresses).toEqual(["owner@example.com"]);
    // Nothing was added, so nothing is annotated -- the row cannot claim a
    // second contact the BCC string denies.
    expect(list.giftedPlayers).toEqual([]);
    expect(list.duplicates).toEqual([]);
  });

  it("a player address already on the list is deduplicated, not repeated", () => {
    const list = groupSendList(
      [
        { id: "a", name: "A", email: "both@example.com" },
        { id: "b", name: "B", email: "b@example.com", players: ["BOTH@example.com"] },
      ],
      { includeGiftedPlayers: true },
    );
    expect(list.addresses).toEqual(["both@example.com", "b@example.com"]);
    expect(list.duplicates).toEqual([
      { ownerId: "b", ownerName: "B", address: "BOTH@example.com" },
    ]);
    // Not annotated on B's row either: it was not emitted for B.
    expect(list.giftedPlayers).toEqual([]);
  });
});

describe("one mailbox on two ROWS is still a collision worth showing", () => {
  it("reports a giftee shared by two different owners", () => {
    // The real intake mistake: the same address reached from two rows. This
    // has to survive the within-row deduplication above.
    const list = groupSendList(
      [
        { id: "a", name: "A", email: "a@example.com", players: ["x@example.com"] },
        { id: "b", name: "B", email: "b@example.com", players: ["X@example.com"] },
      ],
      { includeGiftedPlayers: true },
    );
    expect(list.addresses).toEqual([
      "a@example.com",
      "x@example.com",
      "b@example.com",
    ]);
    expect(list.duplicates).toEqual([
      { ownerId: "b", ownerName: "B", address: "X@example.com" },
    ]);
  });
});

describe("a mistyped player address is caught before it is saved", () => {
  it("blank is valid — gifted with no address yet is a real state", () => {
    // Lou Direnzo #1-#2 are exactly this. A blank field has to save, or the
    // gap can never be recorded and never chased.
    expect(isPlausibleAddress("")).toBe(true);
    expect(isPlausibleAddress("   ")).toBe(true);
    expect(isPlausibleAddress(null)).toBe(true);
  });

  it("rejects the shapes a typo actually produces", () => {
    expect(isPlausibleAddress("chas.flaster")).toBe(false);
    expect(isPlausibleAddress("chas.flaster@")).toBe(false);
    expect(isPlausibleAddress("@gmail.com")).toBe(false);
    expect(isPlausibleAddress("chas.flaster@gmail")).toBe(false);
    expect(isPlausibleAddress("chas flaster@gmail.com")).toBe(false);
    expect(isPlausibleAddress("a@b@gmail.com")).toBe(false);
  });

  it("accepts real addresses, including the awkward ones", () => {
    // Permissive on purpose: refusing a valid-but-unusual address blocks a
    // real arrangement, which is worse than letting one through.
    expect(isPlausibleAddress("chas.flaster@gmail.com")).toBe(true);
    expect(isPlausibleAddress("  jmvas731@msn.com  ")).toBe(true);
    expect(isPlausibleAddress("eaglesfor50@aol.com")).toBe(true);
    expect(isPlausibleAddress("first+tag@sub.domain.co.uk")).toBe(true);
    expect(isPlausibleAddress("O'Brien@example.com")).toBe(true);
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
