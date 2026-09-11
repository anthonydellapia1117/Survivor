import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { gmail_v1 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";

// send.ts writes its claim row through recordAudit and reads prior sends
// through loadAuditByAction; both are faked so the guard is exercised without
// a database. roster.ts imports db.ts for TYPES only, so this mock does not
// reach the derivation under test.
vi.mock("../../scripts/lib/db", () => ({
  recordAudit: vi.fn(),
  loadAuditByAction: vi.fn(),
}));

import { loadAuditByAction, recordAudit } from "../../scripts/lib/db";
import type { EntryRow, OwnerRow } from "../../scripts/lib/db";
import { createDraft, createDraftReply, encodeRaw } from "../../scripts/lib/gmail";
import { sendAllowlisted, sendWeekReminder, type SendRequest, type WeekReminderRequest } from "../../scripts/lib/send";
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

// ------------------------------------------------- the send path itself
//
// Everything above proves the GUARD works. None of it proves the guard is
// CALLED, which is the whole of the finding Copilot raised on #54: the derived
// list was clean, the assert existed, and nothing on the way to Gmail ran it.
// These exercise the real functions, with a poisoned list, and check three
// things every time - it throws, Gmail is never called, and NO audit row is
// written. The last one matters most: a claim row written before the throw
// would consume the slot or the recipient's lock day for good, and the
// reminder that never went would never be sent by any later run either.

describe("the send path refuses a retired address", () => {
  const audit = vi.mocked(recordAudit);
  const loadAudit = vi.mocked(loadAuditByAction);
  const client = {} as SupabaseClient;
  const original = process.env.REMINDER_AUTOSEND;

  function fakeGmail() {
    const send = vi.fn(async () => ({ data: { id: "gmail-msg-1" } }));
    const create = vi.fn(async () => ({ data: { id: "draft-1", message: { id: "m1" } } }));
    return {
      gmail: { users: { messages: { send }, drafts: { create } } } as unknown as gmail_v1.Gmail,
      send,
      create,
    };
  }

  const weekReq: WeekReminderRequest = {
    template: "week_reminder",
    to: "anthonydellapia@gmail.com",
    recipients: ["chas.flaster@gmail.com", LIVE, "jmvas731@msn.com"],
    subject: "Survivor Week 1 - picks due tomorrow at 2 PM",
    body: "Week 1 is here.",
    week: 1,
    boundary: "late",
    slot: "thu",
    deadlineIso: "2026-09-11T18:00:00+00:00",
    expectedRecipients: 3,
    actor: "anthonydellapia@gmail.com",
  };

  const pickReq: SendRequest = {
    template: "pick_reminder",
    to: "chas.flaster@gmail.com",
    subject: "Survivor - Week 1 picks needed",
    body: "Chas,",
    week: 1,
    deadlineIso: "2026-09-11T18:00:00+00:00",
    entryNames: ["Chas Flaster #1"],
    actor: "anthonydellapia@gmail.com",
  };

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

  it("sendWeekReminder throws on a poisoned Bcc, sends nothing and claims nothing", async () => {
    const { gmail, send } = fakeGmail();
    const poisoned = { ...weekReq, recipients: [...weekReq.recipients, DEAD], expectedRecipients: 4 };
    await expect(sendWeekReminder(gmail, client, poisoned)).rejects.toThrow(RetiredAddressError);
    await expect(sendWeekReminder(gmail, client, poisoned)).rejects.toThrow(/ernie706@gmail\.com/);
    expect(send).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("sendWeekReminder throws even when the count gate is satisfied", async () => {
    // The list is EXACTLY the expected length and still wrong: the dead
    // address replaced a live one, which is what a mistyped roster row does.
    const { gmail, send } = fakeGmail();
    const swapped = { ...weekReq, recipients: ["chas.flaster@gmail.com", DEAD, "jmvas731@msn.com"] };
    expect(swapped.recipients.length).toBe(swapped.expectedRecipients);
    await expect(sendWeekReminder(gmail, client, swapped)).rejects.toThrow(RetiredAddressError);
    expect(send).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("sendWeekReminder throws when the dead address is the To", async () => {
    const { gmail, send } = fakeGmail();
    await expect(sendWeekReminder(gmail, client, { ...weekReq, to: DEAD })).rejects.toThrow(RetiredAddressError);
    expect(send).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("sendWeekReminder still sends a clean list", async () => {
    const { gmail, send } = fakeGmail();
    const out = await sendWeekReminder(gmail, client, weekReq);
    expect(out.kind).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sendAllowlisted throws on a retired recipient, sends nothing and claims nothing", async () => {
    const { gmail, send } = fakeGmail();
    await expect(sendAllowlisted(gmail, client, [], { ...pickReq, to: "Ernie706@Gmail.com" })).rejects.toThrow(RetiredAddressError);
    expect(send).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  // The backstop. send.ts checks first and fails with better words; these
  // prove a caller that never went near send.ts cannot get a message out
  // either - which is the exact shape of the hand-built list that bounced.
  it("encodeRaw refuses to build a message carrying a retired address", () => {
    expect(() => encodeRaw({ to: [DEAD], subject: "Survivor", body: "x" })).toThrow(RetiredAddressError);
    expect(() => encodeRaw({ to: ["a@b.com"], bcc: [LIVE, "  ERNIE706@gmail.com "], subject: "Survivor", body: "x" })).toThrow(RetiredAddressError);
    expect(() => encodeRaw({ to: ["a@b.com"], bcc: [LIVE], subject: "Survivor", body: "x" })).not.toThrow();
  });

  it("createDraft refuses one too - a Bcc draft is one click from a send", async () => {
    const { gmail, create } = fakeGmail();
    await expect(createDraft(gmail, { to: ["a@b.com"], bcc: [DEAD], subject: "Survivor", body: "x" })).rejects.toThrow(RetiredAddressError);
    expect(create).not.toHaveBeenCalled();
  });

  it("createDraftReply refuses one, and it builds its own MIME so it needs its own check", async () => {
    const { gmail, create } = fakeGmail();
    const tail = { threadId: "t1", messageIdHeader: "<m@x>", references: "", from: DEAD, subject: "Survivor" };
    await expect(
      createDraftReply(gmail, { tail: tail as never, to: DEAD, subject: "Survivor - re", body: "x" }),
    ).rejects.toThrow(RetiredAddressError);
    expect(create).not.toHaveBeenCalled();
  });
});

// ------------------------------------------- the command, in the right order
//
// The count gate and the retired check answer different questions, and the
// order matters. Counting cannot see a SWAP: a dead address typed onto an
// owner replaces that owner's live one, so the derived list is still exactly
// 40 and the count gate passes while the person it was corrected for hears
// nothing. So the read runs first, and a source scan is what holds it there -
// there is no way to unit-test a CLI's statement order from the outside.

describe("scripts/remind/cli.ts wires the guard in ahead of the gate", () => {
  const src = readFileSync(path.join(__dirname, "../../scripts/remind/cli.ts"), "utf8");

  it("calls assertNoRetiredAddresses TWICE - on the people and on the expanded Bcc", () => {
    // Two lists since 2026-09-11, because a multi-address person's extra
    // mailboxes are checked in by hand and have never been through the
    // roster: they are exactly the kind of address that can be dead, and the
    // gated people list does not contain them
    // (src/lib/emails/recipient-exceptions.ts).
    expect(src).toContain('assertNoRetiredAddresses(people, "week reminder recipients")');
    expect(src).toContain('assertNoRetiredAddresses(bcc, "week reminder Bcc")');
  });

  it("guards the people BEFORE the count gate and the Bcc before anything is drafted or sent", () => {
    const peopleGuard = src.indexOf("assertNoRetiredAddresses(people");
    const bccGuard = src.indexOf("assertNoRetiredAddresses(bcc");
    const gate = src.indexOf("countGate(EXPECTED_ROSTER_ADDRESSES");
    const send = src.indexOf("sendWeekReminder(");
    const draft = src.indexOf("await createDraft(");
    expect(peopleGuard, "the people guard is missing").toBeGreaterThan(-1);
    expect(bccGuard, "the Bcc guard is missing").toBeGreaterThan(-1);
    // The gated list is checked first, so a dead address that REPLACED a live
    // one is caught while the count still adds up - counting is not reading.
    expect(peopleGuard, "the people guard must run before the count gate").toBeLessThan(gate);
    // And nothing reaches Gmail before the expanded list has been checked.
    for (const [what, at] of [["send", send], ["draft", draft]] as const) {
      expect(at, `${what} not found in the CLI`).toBeGreaterThan(-1);
      expect(bccGuard, `the Bcc guard must run before the ${what}`).toBeLessThan(at);
    }
  });

  it("derives the list rather than naming anyone: no address literal in the CLI", () => {
    // The same rule recipients.ts is held to. A literal here is the hand-built
    // list coming back one file over.
    const literals = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    expect(literals).toEqual([]);
  });
});
