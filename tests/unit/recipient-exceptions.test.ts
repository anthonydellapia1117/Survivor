// The two standing recipient exceptions, set by Anthony on 2026-09-11.
//
// Both depart from a rule this repo otherwise enforces hard, so both are
// checked in with their reason and both are held here. What is asserted is
// the BEHAVIOUR at the seam - the addresses a message actually carries and
// what the count gate counts - not the shape of the constant, because a
// constant can be right while nothing reads it.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COPY_TO,
  MULTI_ADDRESS_PEOPLE,
  ccFor,
  deliveryAddressesFor,
  expandDelivery,
  extraCopies,
} from "@/lib/emails/recipient-exceptions";
import { encodeRaw } from "../../scripts/lib/gmail";

const read = (p: string) => readFileSync(p, "utf8");
const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

const MARIO = "mariohockey97@yahoo.com";
const MARIO_ALL = [
  "mariohockey97@gmail.com",
  "mariohockey97@yahoo.com",
  "mariospectrum3@gmail.com",
];
const JOHN = "jmvas731@msn.com";
const RAY = "ray@economydelivers.com";

describe("Mario: one person, three mailboxes", () => {
  it("delivers every message for him to all three, the roster's address included", () => {
    expect(deliveryAddressesFor(MARIO).sort()).toEqual(MARIO_ALL);
    // The address on the owner row is never dropped in favour of the ones
    // Anthony remembered: he said he is unsure which is live, so replacing it
    // would be the guess this exists to avoid.
    expect(deliveryAddressesFor(MARIO)).toContain(MARIO);
  });

  it("counts him ONCE, not three times - the gate counts people and the send carries addresses", () => {
    // This is the whole point of the distinction. A 40-person roster stays a
    // 40-person roster; it is the delivered list that grows.
    const roster = ["a@example.com", MARIO, "b@example.com"];
    expect(roster.length, "what the count gate sees").toBe(3);
    expect(expandDelivery(roster).length, "what the Bcc carries").toBe(5);
    expect(extraCopies(roster)).toBe(2);
  });

  it("leaves everybody else exactly as they were", () => {
    expect(deliveryAddressesFor("somebody@example.com")).toEqual(["somebody@example.com"]);
    expect(extraCopies(["a@example.com", "b@example.com"])).toBe(0);
  });

  it("matches however the address is cased or padded, because a roster row is free text", () => {
    expect(deliveryAddressesFor("  MarioHockey97@Yahoo.COM ").sort()).toEqual(MARIO_ALL);
  });

  it("records WHY, so the next reader does not tidy it away as a duplicate", () => {
    const m = MULTI_ADDRESS_PEOPLE.find((p) => p.primary === MARIO)!;
    expect(m.addresses).toHaveLength(3);
    expect(m.reason).toMatch(/unsure which is live/i);
    // And the one thing that resolves it: a reply names the live address.
    expect(m.reason).toMatch(/REPLIES|reply/);
  });
});

describe("Johnvas: the owner is CC'd, deliberately", () => {
  it("puts Ray on CC of John's message and nowhere else", () => {
    expect(ccFor(JOHN)).toEqual([RAY]);
    // Ray's own message is untouched - he is not CC'd on himself, and no
    // other recipient picks up a CC.
    expect(ccFor(RAY)).toEqual([]);
    expect(ccFor("somebody@example.com")).toEqual([]);
  });

  it("does NOT make Ray a second recipient of John's entries", () => {
    // The failure this guards is two emails to Ray covering 1069-1070: one
    // his own and one because he was added as a recipient rather than a copy.
    expect(deliveryAddressesFor(JOHN)).toEqual([JOHN]);
    expect(deliveryAddressesFor(JOHN)).not.toContain(RAY);
    expect(expandDelivery([JOHN, RAY])).toEqual([JOHN, RAY].sort());
  });

  it("records that it is an exception to never-both, with the reason", () => {
    const c = COPY_TO.find((x) => x.recipient === JOHN)!;
    expect(c.cc).toEqual([RAY]);
    expect(c.reason).toMatch(/never receive a second email/i);
  });
});

describe("the seam, not the constant", () => {
  it("writes a real Cc header, so a CC is a thing the message carries", () => {
    const raw = decode(encodeRaw({ to: [JOHN], cc: [RAY], subject: "s", body: "b" }));
    expect(raw).toContain(`To: ${JOHN}`);
    expect(raw).toContain(`Cc: ${RAY}`);
    // Cc, not Bcc: John can see that Ray is reading it, which is the point.
    expect(raw).not.toContain(`Bcc: ${RAY}`);
  });

  it("leaves a message with no cc byte-identical to before", () => {
    const a = encodeRaw({ to: ["x@example.com"], subject: "s", body: "b" });
    const b = encodeRaw({ to: ["x@example.com"], cc: [], subject: "s", body: "b" });
    expect(a).toBe(b);
    expect(decode(a)).not.toContain("Cc:");
  });

  it("applies both exceptions at the ONE send seam, not in each caller", () => {
    const send = read("scripts/lib/send.ts");
    expect(send).toContain("to: deliveryAddressesFor(req.to)");
    expect(send).toContain("cc: ccFor(req.to)");
    const chase = read("scripts/chase/cli.ts");
    expect(chase).toContain("to: deliveryAddressesFor(c.recipient.email)");
    expect(chase).toContain("cc: ccFor(c.recipient.email)");
  });

  it("gates the week reminder on PEOPLE and expands afterwards, in that order", () => {
    // Order is the rule: gating the expanded list would turn every extra
    // mailbox into a reviewed change to EXPECTED_ROSTER_ADDRESSES, and that
    // number would stop meaning how many people are on the roster.
    const cli = read("scripts/remind/cli.ts");
    expect(cli).toContain("const people = reminderAddresses(owners, entries);");
    expect(cli).toContain("countGate(EXPECTED_ROSTER_ADDRESSES, people)");
    expect(cli).toContain("const bcc = expandDelivery(people);");
    expect(cli.indexOf("countGate(EXPECTED_ROSTER_ADDRESSES, people)"))
      .toBeLessThan(cli.indexOf("const bcc = expandDelivery(people);"));
    // And the retired check runs on the EXPANDED list too: an extra mailbox
    // is typed in by hand and has never been through the roster.
    expect(cli).toContain('assertNoRetiredAddresses(bcc, "week reminder Bcc")');
  });

  it("refuses a retired address arriving through an extra mailbox or a CC", () => {
    expect(() => encodeRaw({ to: ["x@example.com"], cc: ["ernie706@gmail.com"], subject: "s", body: "b" }))
      .toThrow(/ernie706@gmail\.com/);
  });
});
