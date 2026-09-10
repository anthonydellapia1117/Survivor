import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { EntryRow, OwnerRow } from "../../scripts/lib/db";
import {
  assertNoRetiredAddresses,
  isRetiredAddress,
  retiredAddressesIn,
  RETIRED_ADDRESSES,
  RetiredAddressError,
  withoutRetiredAddresses,
} from "../../scripts/lib/roster";
import { reminderAddresses } from "../../scripts/remind/lib/recipients";

// On 2026-09-09 a Week 1 reminder went to a HAND-BUILT Bcc list that still
// carried ernie706@gmail.com. That mailbox does not exist and the message
// hard-bounced 550 5.1.1; the real address is dellapia706@gmail.com and the
// database was corrected the same day. The dead address is already gone from
// every table a send derives from and survives only in append-only history,
// so this file guards the one thing still possible: it being RE-INTRODUCED
// into a derived recipient list.

const DEAD = "ernie706@gmail.com";
const LIVE = "dellapia706@gmail.com";

const owner = (id: string, email: string | null, status = "confirmed"): OwnerRow => ({
  id,
  first_name: id,
  last_name: "X",
  email,
  participation_status: status,
});

const entry = (id: string, owner_id: string, player_email: string | null = null): EntryRow => ({
  id,
  owner_id,
  entry_name: id,
  player_email,
  is_gifted: player_email !== null,
  is_free_entry: false,
  lynne_number: null,
  lynne_label: null,
  voided_at: null,
});

// ------------------------------------------------------------- the list
describe("the retired list", () => {
  it("names the address that bounced", () => {
    const addresses = RETIRED_ADDRESSES.map((r) => r.address.trim().toLowerCase());
    expect(addresses).toContain(DEAD);
    expect(isRetiredAddress(DEAD)).toBe(true);
  });

  it("is the first entry, and carries the date and the reason it is retired", () => {
    const first = RETIRED_ADDRESSES[0];
    expect(first.address).toBe(DEAD);
    // The record has to say when and why, or the next reader cannot tell a
    // dead mailbox from a name somebody disliked.
    for (const r of RETIRED_ADDRESSES) {
      expect(r.retiredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.reason.trim().length).toBeGreaterThan(20);
    }
    expect(first.retiredOn).toBe("2026-09-09");
    expect(first.reason).toContain("550 5.1.1");
    // The replacement is named, so the correction is not lost with the bounce.
    expect(first.reason).toContain(LIVE);
  });

  it("does not retire the address that replaced it", () => {
    expect(isRetiredAddress(LIVE)).toBe(false);
  });
});

// ------------------------------------------------------- the guard throws
describe("a list about to be mailed", () => {
  const variants = [
    DEAD,
    "Ernie706@Gmail.com",
    "ERNIE706@GMAIL.COM",
    "  ernie706@gmail.com",
    "ernie706@gmail.com  ",
    "\t ErNiE706@GmAiL.CoM \n",
  ];

  for (const variant of variants) {
    it(`throws when it carries ${JSON.stringify(variant)}`, () => {
      const list = ["chas.flaster@gmail.com", variant, "jmvas731@msn.com"];
      expect(() => assertNoRetiredAddresses(list, "week reminder")).toThrow(RetiredAddressError);
      // Compared on a trimmed, lower-cased copy - and reported AS GIVEN, so the
      // stray space or the odd casing is visible in the failure.
      expect(retiredAddressesIn(list)).toEqual([variant]);
      expect(isRetiredAddress(variant)).toBe(true);
    });
  }

  it("passes a clean list through untouched", () => {
    const clean = ["Chas.Flaster@gmail.com", "jmvas731@msn.com", LIVE, "alexaragozzino@yahoo.com"];
    expect(() => assertNoRetiredAddresses(clean, "week reminder")).not.toThrow();
    expect(retiredAddressesIn(clean)).toEqual([]);
    // Same strings, same order, same casing: this filters, it does not normalize.
    expect(withoutRetiredAddresses(clean)).toEqual(clean);
  });

  it("filters the dead address out and leaves the rest alone", () => {
    const list = ["chas.flaster@gmail.com", "Ernie706@Gmail.com", LIVE];
    expect(withoutRetiredAddresses(list)).toEqual(["chas.flaster@gmail.com", LIVE]);
  });

  it("names the offending address in the error, so the message is actionable", () => {
    let caught: unknown;
    try {
      assertNoRetiredAddresses(["chas.flaster@gmail.com", "Ernie706@Gmail.com"], "week reminder");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RetiredAddressError);
    const err = caught as RetiredAddressError;
    expect(err.name).toBe("RetiredAddressError");
    // The address itself, verbatim, in the message a person reads.
    expect(err.message).toContain("Ernie706@Gmail.com");
    expect(err.message).toContain("week reminder");
    expect(err.offenders).toEqual(["Ernie706@Gmail.com"]);
    // A bystander is never named: the message is about what is wrong.
    expect(err.message).not.toContain("chas.flaster@gmail.com");
  });
});

// -------------------------------------------- the live roster derivation
describe("the live roster derivation in scripts/remind/lib/recipients.ts", () => {
  const recipientsSrc = readFileSync(
    path.join(__dirname, "../../scripts/remind/lib/recipients.ts"),
    "utf8",
  );

  it("hand-builds no address at all - every recipient is derived from the roster", () => {
    // The incident was a HAND-BUILT Bcc list. An address literal in the file
    // that decides recipients is that list coming back, whoever it belongs to.
    const literals = recipientsSrc.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    expect(literals).toEqual([]);
  });

  it("cannot produce a retired address from the corrected roster", () => {
    const owners = [
      owner("ernie", LIVE),
      owner("kris", "kris@example.com"),
      owner("declined", DEAD, "declined"),
    ];
    const entries = [entry("e1", "ernie"), entry("k1", "kris"), entry("d1", "declined")];
    const derived = reminderAddresses(owners, entries);
    expect(derived).toContain(LIVE);
    expect(retiredAddressesIn(derived)).toEqual([]);
    expect(() => assertNoRetiredAddresses(derived, "week reminder")).not.toThrow();
  });

  it("stops the run if the dead address is ever typed back onto the roster", () => {
    // The derivation reads whatever the roster holds - that is the point of
    // deriving - so the roster going wrong is the one way the address returns.
    // Then the send must fail, loudly, rather than quietly mail everyone else.
    const owners = [owner("ernie", "ERNIE706@gmail.com"), owner("kris", "kris@example.com")];
    const entries = [entry("e1", "ernie"), entry("k1", "kris", " Ernie706@Gmail.com ")];
    const derived = reminderAddresses(owners, entries);
    // The derivation lower-cases and de-duplicates, so both routes land as one.
    expect(derived).toContain(DEAD);
    expect(retiredAddressesIn(derived)).toEqual([DEAD]);
    expect(() => assertNoRetiredAddresses(derived, "week reminder")).toThrow(/ernie706@gmail\.com/);
  });
});
