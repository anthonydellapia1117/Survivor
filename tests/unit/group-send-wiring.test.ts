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

  it("still keys messages on the mailbox, or the premise is stale", () => {
    // If keys stopped being addresses, the assertion above guards nothing.
    expect(PICKS_CLIENT).toContain("b.key === selected");
  });
});
