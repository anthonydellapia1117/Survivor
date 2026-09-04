import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The seam a unit test on groupSendList() cannot see.
//
// groupSendList only includes the people who play an owner's entries when the
// caller asks for them AND supplies them. Both halves live outside the
// library: the page reads entries.player_email off the roster, the client
// decides which filters ask for it. So the library can be perfectly correct
// while the screen quietly sends an announcement that misses every giftee --
// which is precisely the regression that shipped when owners.cc_email was
// retired, and precisely the failure Anthony named: "if I send a batch and the
// CC contacts are missing, Chas does not get his email and I would not know."
//
// Reading the source is the only way to check a wiring nobody can unit test.
// Same approach as tests/unit/rpc-positional-args.test.ts.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const CLIENT = read("src/components/admin/emails-client.tsx");
const PAGE = read("src/app/admin/(protected)/emails/page.tsx");

/**
 * Source with comments removed. These files explain the rules they follow in
 * prose, so a naive substring search finds the explanation of a mistake and
 * reads it as the mistake itself.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const CLIENT_CODE = code(CLIENT);

const PICKS_CLIENT = code(
  read("src/components/admin/emails/pick-emails-client.tsx"),
);

describe("the emails screen actually asks for the people who play", () => {
  it("premise: both files still use the pieces this test reasons about", () => {
    // If groupSendList is no longer what the screen calls, every assertion
    // below is checking a dead shape and would pass by vacuum.
    expect(CLIENT).toContain("groupSendList");
    expect(PAGE).toContain("EmailsClient");
  });

  it("turns giftees ON for the announcement view and only that view", () => {
    // Keyed off the ALL filter, not hardcoded either way. `false` would drop
    // every giftee; `true` would BCC them on the money filters, which is a
    // note about the balance of the owner who pays for their entries.
    expect(CLIENT).toMatch(
      /includeGiftedPlayers\s*=\s*filter\s*===\s*["']all["']/,
    );
    expect(CLIENT).toContain("includeGiftedPlayers }");
  });

  it("supplies the addresses, or there is nothing to include", () => {
    // A list that is asked for but never populated is the same outage with a
    // different cause.
    expect(PAGE).toContain("isGifted");
    expect(PAGE).toContain("playerEmail");
    expect(PAGE).toMatch(/players:/);
  });

  it("leaves out entries nobody is playing", () => {
    // A voided entry's giftee is not on the roster for this.
    expect(PAGE).toMatch(/voidedAt !== null/);
  });

  it("annotates rows from the LIST, never from the raw row", () => {
    // Reading the row directly would claim a contact for an address the list
    // deliberately left off -- a self-address, a blank, or a duplicate -- so
    // the row would contradict the BCC string and the count beside it.
    expect(CLIENT_CODE).toContain("list.giftedPlayers");
    expect(CLIENT_CODE).not.toContain("o.players");
  });
});

describe("a message key is an email address, so nothing may prefix-match it", () => {
  // The pick-emails screen keys each message on the recipient's mailbox. It
  // used to key on the owner's UUID, where prefix matching was harmless
  // because every key was the same length -- no UUID can be a prefix of
  // another. An address can: a@x.com is a prefix of a@x.com.au, so a
  // startsWith check flashed "Copied" on the wrong recipient's message.
  //
  // This guards the class, not the one call site: any prefix test against a
  // key is unsafe now, and the next one added would be a fresh instance of
  // the same bug.
  it("uses no startsWith or prefix test against a key", () => {
    expect(PICKS_CLIENT).not.toMatch(/startsWith\(\s*(current|b|current\.key|b\.key)/);
    expect(PICKS_CLIENT).not.toContain("startsWith(current.key)");
    expect(PICKS_CLIENT).not.toContain("key.startsWith");
  });

  it("gives every flash id a suffix, so the render can enumerate them", () => {
    // Narrowing the render condition to the suffixed ids fixed the prefix
    // collision and broke the main "Copy email" button, whose id was the BARE
    // key -- so its Copied banner never appeared. Both halves have to agree,
    // and the way to keep them agreeing is that no id is ever a bare key.
    expect(PICKS_CLIENT).not.toMatch(/note\(\s*current\.key\s*,/);
    // Every per-message id is `${current.key}-<letter>`; the render condition
    // lists the same letters. If a button adds a new one, this catches the
    // render condition that was not updated with it.
    const emitted = [
      ...PICKS_CLIENT.matchAll(/note\(\s*`\$\{current\.key\}-([a-z])`/g),
    ].map((m) => m[1]);
    expect(emitted.length).toBeGreaterThan(0);
    const rendered = /\[((?:\s*"[a-z]",?)+)\]\.some/.exec(PICKS_CLIENT);
    expect(rendered, "render condition not found").not.toBeNull();
    const listed = [...rendered![1].matchAll(/"([a-z])"/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...new Set(emitted)].sort());
  });

  it("still keys messages on the mailbox, or the premise is stale", () => {
    // If keys stopped being addresses, the assertion above guards nothing.
    expect(PICKS_CLIENT).toContain("b.key === selected");
  });
});

describe("the addressless-gift banner says what is actually true", () => {
  // recipientsForPicks puts an addressless gift on NOBODY's message. The
  // banner announcing those entries used to say they stay on the buyer's --
  // true until the fall-through was removed, and false after. A banner that
  // reassures the admin somebody was asked, when nobody was, is worse than no
  // banner at all: the entry goes into the week with no pick and the screen
  // said it was handled.
  //
  // Copy is not usually worth a test. This copy is the only thing standing
  // between a known gap and a silently missed pick.
  it("does not claim the entry stays on the buyer's message", () => {
    // Whitespace-collapsed, and matched on the phrase the false version has
    // to contain. An earlier form of this assertion tested /stays? on the/,
    // which never matched: the source reads `"they stay"} on the`, with the
    // ternary's closing quote and brace between the two words. It passed
    // against the real regression -- a guard that looks like coverage and is
    // not, which is the same trap this PR has now hit four times.
    const copy = PICKS_CLIENT.replace(/\s+/g, " ");
    expect(copy).not.toContain("on the buyer");
  });

  it("says nobody was asked, and names the deadline as the thing to beat", () => {
    // Whitespace-collapsed: JSX wraps this copy across several lines, so the
    // sentences are not contiguous in the source.
    const copy = PICKS_CLIENT.replace(/\s+/g, " ");
    expect(copy).toContain("NOBODY was asked");
    expect(copy).toContain("on no message above");
    expect(copy).toContain("before the late deadline");
  });
});
