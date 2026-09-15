// BOUNCES. Anthony, 2026-09-15: "Watch for bounces. Lynne reports Comcast
// bouncing on her end and three of ours are Comcast." A delivery failure is
// the one message about a player that does not come from the player, so it
// gets a third read: from a mailer, in the window, not yet filed. The failed
// recipient is read out of the notice; a roster address stages ONE identity
// row naming the person's entries and posts a NEEDS ANTHONY line; a stranger's
// is filed and not staged.
//
// There was no real bounce on file when this was written. The three fixtures
// are the three forms the reader knows: Gmail's own notice, the older Google
// form, and the DSN's Final-Recipient line.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { InboundMessage } from "../../scripts/lib/gmail";
import { bouncePayload, bounceSweepQuery, classifyBounces, failedRecipient, isBounceSender } from "../../scripts/picks/lib/bounce";

const GMAIL_FORM = [
  "Address not found",
  "",
  "Your message wasn\u2019t delivered to jamesteti@comcast.net because the address couldn\u2019t be found, or is unable to receive mail.",
  "",
  "The response was:",
  "550 5.1.1 The email account that you tried to reach does not exist.",
].join("\n");

const OLDER_FORM = [
  "Delivery to the following recipient failed permanently:",
  "",
  "     JamesTeti@Comcast.net",
  "",
  "Technical details of permanent failure:",
].join("\n");

const DSN_FORM = [
  "Reporting-MTA: dns; googlemail.com",
  "",
  "Final-Recipient: rfc822; jamesteti@comcast.net",
  "Action: failed",
  "Status: 5.1.1",
].join("\n");

const msg = (id: string, body: string, from = "mailer-daemon@googlemail.com"): InboundMessage => ({
  id,
  threadId: "t",
  from: `Mail Delivery Subsystem <${from}>`,
  fromAddress: from,
  subject: "Delivery Status Notification (Failure)",
  date: "Tue, 15 Sep 2026 09:00:00 -0400",
  receivedAt: "2026-09-15T13:00:00Z",
  body,
});

const ROSTER = ["jamesteti@comcast.net", "kris@example.com"];
const entriesFor = (a: string) => (a === "jamesteti@comcast.net" ? [{ entryName: "Jim Teti #1" }, { entryName: "Jim Teti #2" }] : []);

describe("the three DSN forms", () => {
  it("read the failed recipient out of each, lowercased, whatever apostrophe Gmail used", () => {
    expect(failedRecipient(GMAIL_FORM)).toBe("jamesteti@comcast.net");
    expect(failedRecipient(GMAIL_FORM.replace(/\u2019/g, "'"))).toBe("jamesteti@comcast.net");
    expect(failedRecipient(OLDER_FORM)).toBe("jamesteti@comcast.net");
    expect(failedRecipient(DSN_FORM)).toBe("jamesteti@comcast.net");
  });

  it("read nothing out of a notice in no known form, rather than guessing an address", () => {
    expect(failedRecipient("Your message could not be delivered.")).toBeNull();
    expect(failedRecipient("")).toBeNull();
    // An address elsewhere in the notice is not the failed recipient.
    expect(failedRecipient("Reply to anthonydellapia@gmail.com if this persists.")).toBeNull();
  });
});

describe("who sent it, and who it was for", () => {
  it("takes a mailer as the sender and nobody else", () => {
    expect(isBounceSender("mailer-daemon@googlemail.com")).toBe(true);
    expect(isBounceSender("MAILER-DAEMON@mx.comcast.net")).toBe(true);
    expect(isBounceSender("postmaster@comcast.net")).toBe(true);
    expect(isBounceSender("kris@example.com")).toBe(false);
    expect(isBounceSender("notmailer-daemon@x.com")).toBe(false);
  });

  it("a roster bounce is ONE row naming the person's entries; a stranger's is not on the roster", () => {
    const rows = classifyBounces([msg("b1", GMAIL_FORM), msg("b2", OLDER_FORM.replace(/JamesTeti@Comcast\.net/, "nobody@elsewhere.org"))], ROSTER, entriesFor);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ messageId: "b1", bouncedAddress: "jamesteti@comcast.net", onRoster: true, entryNames: ["Jim Teti #1", "Jim Teti #2"] });
    expect(rows[1]).toMatchObject({ messageId: "b2", bouncedAddress: "nobody@elsewhere.org", onRoster: false, entryNames: [] });
  });

  it("matches the roster case-insensitively, the way every address here is compared", () => {
    const [row] = classifyBounces([msg("b3", OLDER_FORM)], ["JamesTeti@comcast.net"], entriesFor);
    expect(row.onRoster).toBe(true);
  });

  it("carries the address, the entries and the reason onto the queue row", () => {
    const [row] = classifyBounces([msg("b1", GMAIL_FORM)], ROSTER, entriesFor);
    expect(bouncePayload(row, 2)).toMatchObject({
      week: 2,
      from: "mailer-daemon@googlemail.com",
      bounced_address: "jamesteti@comcast.net",
      entries: ["Jim Teti #1", "Jim Teti #2"],
      reason: "delivery failed",
    });
  });

  it("asks Gmail for mailers only, inside the window, not yet filed", () => {
    expect(bounceSweepQuery(14, "Pool-Survivor-Done")).toBe('-in:draft newer_than:14d -label:"Pool-Survivor-Done" from:(mailer-daemon OR postmaster)');
    expect(() => bounceSweepQuery(0)).toThrow(/positive integer/);
  });
});

describe("what the sweep does with them", () => {
  const c = readFileSync(path.join(__dirname, "../..", "scripts/picks/cli.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

  it("reads them as the third read, through the same full reader, and keeps a DSN out of the strangers", () => {
    expect(c).toMatch(/bounces = classifyBounces\(await listSweepMatching\(gmail, bounceSweepQuery\(\), skip\), addresses, entriesFor\)/);
    expect(c).toMatch(/strangers = strangers\.filter\(\(m\) => !bounceIds\.has\(m\.id\)\)/);
  });

  it("stages a roster bounce as exactly one identity row with the bounce payload, and files a stranger's without staging", () => {
    const branch = c.match(/if \(b\.onRoster \|\| b\.bouncedAddress === null\) \{([\s\S]*?)\} else \{([\s\S]*?)\n      \}/);
    expect(branch, "the bounce branch").not.toBeNull();
    expect(branch![1]).toMatch(/bounceRows\.push\(\{ kind: "identity",[\s\S]*?bounce: bouncePayload\(b, item\.week\) \}\)/);
    expect(branch![2]).toMatch(/notOursBounces\.add\(b\.messageId\)/);
    expect(branch![2]).not.toMatch(/bounceRows\.push/);
    // The rows reach the queue through the one staging loop, payload intact...
    expect(c).toMatch(/unresolved\.push\(\.\.\.bounceRows\);/);
    expect(c).toMatch(/payload: u\.bounce\s*\? u\.bounce/);
    // ...the NEEDS ANTHONY line names the person and the address on the
    // terminal, and the push carries neither.
    expect(c).toMatch(/if \(u\.bounce\) console\.log\(`NEEDS ANTHONY: \$\{u\.reason\} - see \/admin\/queue`\);/);
    expect(c).toMatch(/needsAnthonyLine\("picks", u\.bounce \? "bounce" : u\.kind, stagedDetail\(u\.item\.week\)\)/);
    // A stranger's bounce is filed with the already-recorded messages.
    expect(c).toMatch(/const fileOnly = new Set<string>\(notOursBounces\);/);
  });
});
