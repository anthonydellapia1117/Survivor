import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { InboundMessage } from "../../scripts/lib/gmail";
import type { EntryRow, OwnerRow } from "../../scripts/lib/db";
import { isSweptSubject, strangerMessages } from "../../scripts/picks/lib/subject-sweep";
import { intakeAddresses } from "../../scripts/lib/roster";
import { ADMIN_MAILBOX } from "../../scripts/lib/constants";

// The status email Anthony gets after a code run is subject
// "Survivor CODE STATUS - v2", self-sent from his own mailbox. The word
// Survivor is in it deliberately - his filter matches on it - so the SUBJECT
// cannot be what keeps it out of the intake. The ADDRESS is: the sweep reads
// the roster and every path drops the admin's own mailbox.
//
// His rule, set 2026-09-10: if any intake path ever stages a row from a CODE
// STATUS message, that is a defect in the intake, and the subject is never
// what gets changed to fix it.

const SUBJECT = "Survivor CODE STATUS - v2";
const TERMS = (JSON.parse(readFileSync("scripts/ops/config.json", "utf8")) as { sweepSubjectTerms: string[] }).sweepSubjectTerms;

const msg = (from: string, subject: string): InboundMessage => ({
  id: `m-${from}`,
  threadId: "t",
  from,
  fromAddress: from,
  subject,
  date: "Thu, 10 Sep 2026 14:00:00 -0400",
  receivedAt: "2026-09-10T18:00:00Z",
  body: "SESSION: v2\nRAN: a run\nNEXT: nothing",
});

describe("the CODE STATUS self-email", () => {
  it("does carry a swept word, so only the address can keep it out", () => {
    // If this ever goes false the guard below stops proving anything: the
    // message would be dropped by the subject and the address rule could
    // rot unnoticed.
    expect(isSweptSubject(SUBJECT, TERMS)).toBe(true);
  });

  it("is dropped by the subject sweep, because the admin mailbox is excluded", () => {
    const msgs = [msg(ADMIN_MAILBOX, SUBJECT), msg("ANTHONYDELLAPIA@gmail.com", SUBJECT), msg("stranger@example.com", SUBJECT)];
    const out = strangerMessages(msgs, [], [ADMIN_MAILBOX, "lynnepiazza10@gmail.com"], TERMS);
    expect(out.map((m) => m.fromAddress)).toEqual(["stranger@example.com"]);
  });

  it("is dropped by the address sweep, even though Anthony is a confirmed owner with entries", () => {
    const owners: OwnerRow[] = [
      { id: "adm", first_name: "Anthony", last_name: "DellaPia", email: ADMIN_MAILBOX, participation_status: "confirmed" },
      { id: "o1", first_name: "Kris", last_name: "Tomasco", email: "kris@x.com", participation_status: "confirmed" },
    ];
    const entry = (id: string, owner: string, player: string | null = null): EntryRow => ({
      id, owner_id: owner, entry_name: id, player_email: player, is_gifted: player !== null, is_free_entry: false,
      lynne_number: null, lynne_label: null, voided_at: null,
    });
    const entries = [entry("AAA #1", "adm"), entry("AAA #3", "adm", "alexaragozzino@yahoo.com"), entry("Kris Tomasco #1", "o1")];
    const addresses = intakeAddresses(owners, entries, ADMIN_MAILBOX);
    expect(addresses).not.toContain(ADMIN_MAILBOX);
    expect(addresses).toEqual(["kris@x.com", "alexaragozzino@yahoo.com"]);
  });

  it("is excluded by the sweep itself, on both paths, not only by these helpers", () => {
    // Comments stripped first: a source assertion that matches the comment
    // explaining a rule instead of the code keeping it is the 2026-09-04 trap.
    const src = readFileSync("scripts/picks/cli.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(src).toMatch(/intakeAddresses\(owners, entries, ADMIN_MAILBOX\)/);
    // The admin reaches strangerMessages through `excluded`, which is built
    // from ADMIN_MAILBOX first. Both halves are asserted, so neither can be
    // dropped: the list must be built with the admin in it, and it must be
    // the list that is handed to the sweep.
    expect(src).toMatch(/const excluded = \[ADMIN_MAILBOX, LYNNE_EMAIL, \.\.\.ops\.sweepExcludeSenders\]/);
    expect(src).toMatch(/strangerMessages\([\s\S]{0,220}?, addresses, excluded, terms\)/);
  });
});
