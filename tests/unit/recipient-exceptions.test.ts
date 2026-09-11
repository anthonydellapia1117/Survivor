// The two standing recipient exceptions, set by Anthony on 2026-09-11.
//
// Both depart from a rule this repo otherwise enforces hard, so both are
// checked in with their reason and both are held here. What is asserted is
// the BEHAVIOUR at the seam - the addresses a message actually carries and
// what the count gate counts - not the shape of the constant, because a
// constant can be right while nothing reads it.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { gmail_v1 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../../scripts/lib/db", () => ({
  recordAudit: vi.fn(),
  loadAuditByAction: vi.fn(),
}));
import {
  COPY_TO,
  MULTI_ADDRESS_PEOPLE,
  ccFor,
  deliveryAddressesFor,
  expandDelivery,
  extraCopies,
} from "@/lib/emails/recipient-exceptions";
import { encodeRaw } from "../../scripts/lib/gmail";
import { loadAuditByAction, recordAudit } from "../../scripts/lib/db";
import {
  sendAllowlisted,
  sendWeekReminder,
  type SendRequest,
  type WeekReminderRequest,
} from "../../scripts/lib/send";

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
    expect(send).toContain("const to = deliveryAddressesFor(req.to);");
    expect(send).toContain("const cc = ccFor(req.to);");
    const chase = read("scripts/chase/cli.ts");
    expect(chase).toContain("to: deliveryAddressesFor(c.recipient.email)");
    expect(chase).toContain("cc: ccFor(c.recipient.email)");
  });

  it("builds and CHECKS the full pick_reminder address set BEFORE the claim row", () => {
    // The claim consumes the recipient's lock day. A retired extra mailbox or
    // CC that only encodeRaw notices throws after the claim is written, so
    // every later run that day skips a person who was never sent anything.
    // Both reviewers found this on #84.
    const send = read("scripts/lib/send.ts");
    const built = send.indexOf("const to = deliveryAddressesFor(req.to);");
    const checked = send.indexOf("assertNoRetiredAddresses([...to, ...cc]");
    const claim = send.indexOf("action: SEND_CLAIM_ACTION");
    expect(built, "the delivery set is built").toBeGreaterThan(-1);
    expect(checked, "and read, not only counted").toBeGreaterThan(-1);
    expect(claim, "the claim row").toBeGreaterThan(-1);
    expect(built).toBeLessThan(claim);
    expect(checked).toBeLessThan(claim);
  });

  it("expands the week reminder AT THE SEAM, after its own people gate", () => {
    // The gate counts PEOPLE and the Bcc carries MAILBOXES. Handing the seam
    // an already-expanded list made it compare 42 against an expected 40 and
    // the week reminder could not send at all.
    const send = read("scripts/lib/send.ts");
    expect(send).toContain("const bcc = expandDelivery(req.recipients);");
    const gate = send.indexOf("req.recipients.length !== req.expectedRecipients");
    const expand = send.indexOf("const bcc = expandDelivery(req.recipients);");
    const claim = send.indexOf("action: WEEK_REMINDER_CLAIM_ACTION");
    expect(gate).toBeGreaterThan(-1);
    expect(gate, "gate the people first").toBeLessThan(expand);
    expect(expand, "expand before the claim").toBeLessThan(claim);
    expect(
      send.indexOf("assertNoRetiredAddresses([req.to, ...bcc]"),
      "and read the expanded list before the claim too",
    ).toBeLessThan(claim);
    // The CLI hands over PEOPLE, never a pre-expanded list.
    expect(read("scripts/remind/cli.ts")).toContain("recipients: people,");
  });

  it("expands EVERY whole-roster Bcc, not just the one that was wired first", () => {
    // chase --bcc and distribute each build one aggregate Bcc and never touch
    // the per-recipient seam, so without this a multi-address person gets
    // only the one uncertain roster mailbox on those messages.
    expect(read("scripts/chase/cli.ts")).toContain("const bcc = expandDelivery(people);");
    expect(read("scripts/distribute/cli.ts")).toContain("bcc: expandDelivery(list.addresses),");
  });

  it("puts the exceptions on the pick-email screen's headers too", () => {
    // That screen is where a header is copied and pasted into Gmail by hand.
    // A header that omits them sends somewhere different from every command.
    const built = read("src/lib/emails/pick-request.ts");
    expect(built).toContain("toAddresses: deliveryAddressesFor(recipient.email)");
    expect(built).toContain("cc: ccFor(recipient.email)");
    const client = read("src/components/admin/emails/pick-emails-client.tsx");
    expect(client).toContain('{ label: "To", value: b.toAddresses.join(", ") }');
    expect(client).toContain('lines.push({ label: "Cc", value: b.cc.join(", ") })');
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

// ---------------------------------------------------------------- the behaviour
//
// Everything above reads the source. These send, through the real seam with a
// fake Gmail, and look at the message that came out - which is the only thing
// that proves the gate and the header disagree about Mario on purpose.

describe("what the send seam actually puts on the wire", () => {
  const audit = vi.mocked(recordAudit);
  const loadAudit = vi.mocked(loadAuditByAction);
  const client = {} as SupabaseClient;
  const original = process.env.REMINDER_AUTOSEND;

  // Typed with the one argument the seam passes, so the raw message can be
  // read back off the call without casting through undefined.
  type SendArgs = { userId: string; requestBody: { raw: string } };
  function fakeGmail() {
    const send = vi.fn(async (_a: SendArgs) => ({ data: { id: "gmail-msg-1" } }));
    return { gmail: { users: { messages: { send } } } as unknown as gmail_v1.Gmail, send };
  }
  const rawOf = (send: ReturnType<typeof fakeGmail>["send"]) =>
    decode(send.mock.calls[0][0].requestBody.raw);

  beforeEach(() => {
    process.env.REMINDER_AUTOSEND = "true";
    audit.mockReset();
    loadAudit.mockReset();
    loadAudit.mockResolvedValue([]);
    let n = 0;
    audit.mockImplementation(async () => ++n);
  });
  afterEach(() => {
    if (original === undefined) delete process.env.REMINDER_AUTOSEND;
    else process.env.REMINDER_AUTOSEND = original;
  });

  const weekReq: WeekReminderRequest = {
    template: "week_reminder",
    to: "anthonydellapia@gmail.com",
    // THREE PEOPLE, one of them Mario. The gate expects three.
    recipients: ["chas.flaster@gmail.com", MARIO, JOHN],
    subject: "Survivor Week 1 - picks due tomorrow at 2 PM",
    body: "Week 1 is here.",
    week: 1,
    boundary: "late",
    slot: "thu",
    deadlineIso: "2026-09-11T18:00:00+00:00",
    expectedRecipients: 3,
    actor: "anthonydellapia@gmail.com",
  };

  it("SENDS with a multi-address person on the list - the gate counts 3, the Bcc carries 5", async () => {
    // This is the regression. The first version passed the expanded list in
    // as the Bcc, so this same call threw "Count gate: 5 recipients, 3
    // expected" and the week reminder could not go out at all.
    const { gmail, send } = fakeGmail();
    const out = await sendWeekReminder(gmail, client, weekReq);
    expect(out.kind).toBe("sent");
    const raw = rawOf(send);
    for (const a of MARIO_ALL) expect(raw, `${a} on the Bcc`).toContain(a);
    const bcc = raw.split("\n").find((l) => l.startsWith("Bcc: "))!;
    expect(bcc.split(",").length, "5 addresses for 3 people").toBe(5);
  });

  it("still refuses a people count that is not the expected one", async () => {
    const { gmail, send } = fakeGmail();
    await expect(
      sendWeekReminder(gmail, client, { ...weekReq, expectedRecipients: 4 }),
    ).rejects.toThrow(/Count gate: 3 recipients, 4 expected/);
    expect(send).not.toHaveBeenCalled();
    expect(audit, "nothing claimed either").not.toHaveBeenCalled();
  });

  const pickReq: SendRequest = {
    template: "pick_reminder",
    to: MARIO,
    subject: "Survivor - Week 1 picks needed",
    body: "Mario,",
    week: 1,
    deadlineIso: "2026-09-11T18:00:00+00:00",
    entryNames: ["Mario 3rd #1"],
    actor: "anthonydellapia@gmail.com",
  };

  it("puts all three of Mario's mailboxes on his pick reminder", async () => {
    const { gmail, send } = fakeGmail();
    await sendAllowlisted(gmail, client, [], pickReq);
    const raw = rawOf(send);
    for (const a of MARIO_ALL) expect(raw).toContain(a);
  });

  it("puts Ray on Cc of John's pick reminder and never on its To", async () => {
    const { gmail, send } = fakeGmail();
    await sendAllowlisted(gmail, client, [], { ...pickReq, to: JOHN, body: "John," });
    const raw = rawOf(send);
    expect(raw).toContain(`To: ${JOHN}`);
    expect(raw).toContain(`Cc: ${RAY}`);
    expect(raw).not.toContain(`To: ${JOHN}, ${RAY}`);
  });
});
