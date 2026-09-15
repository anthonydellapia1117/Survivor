// READ STATE IS NOT THE MARKER. Set by Anthony on 2026-09-15: a message he
// read on his phone before the sweep ran was never swept, because both Gmail
// queries asked for is:unread. Processed now means the DONE label, or an id
// already on file; the label is resolved or created before anything is read,
// and a run that cannot have it stops with nothing read.
//
// These DRIVE the readers with a fake Gmail and watch what they ask for and
// what they return - the search clause is a prefilter, and only the labelIds
// on the message and the on-file set decide, so a source assertion on the
// query string could pass with the decision wrong.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { gmail_v1 } from "googleapis";
import { ensureLabel, listSweepFrom, markProcessed, notDoneClause, readNamedMessages, sweepFromQueries } from "../../scripts/lib/gmail";
import { ADMIN_MAILBOX, DONE_LABEL } from "../../scripts/lib/constants";
import { bounceSweepQuery } from "../../scripts/picks/lib/bounce";

const DONE_ID = "Label_77";

interface FakeMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
  labelIds: string[];
}

/** A mailbox whose search returns every message it holds (the prefilter is not what is under test). */
function fakeGmail(messages: FakeMessage[], opts: { labels?: { name: string; id: string }[]; createFails?: boolean } = {}) {
  const calls: { op: string; id?: string; format?: string; q?: string; add?: string[]; remove?: string[] }[] = [];
  const labels = opts.labels ?? [{ name: DONE_LABEL, id: DONE_ID }];
  const encode = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  const gmail = {
    users: {
      labels: {
        list: async () => {
          calls.push({ op: "labels.list" });
          return { data: { labels } };
        },
        create: async (p: { requestBody: { name: string } }) => {
          calls.push({ op: "labels.create", id: p.requestBody.name });
          if (opts.createFails) throw new Error("insufficient scope");
          return { data: { id: "Label_new" } };
        },
      },
      messages: {
        list: async (p: { q: string }) => {
          calls.push({ op: "messages.list", q: p.q });
          // A search result carries a snippet: the preview that must never be a body.
          return { data: { messages: messages.map((m) => ({ id: m.id, threadId: "t", snippet: m.body.slice(0, 5) })) } };
        },
        modify: async (p: { id: string; requestBody: { addLabelIds?: string[]; removeLabelIds?: string[] } }) => {
          calls.push({ op: "messages.modify", id: p.id, add: p.requestBody.addLabelIds ?? [], remove: p.requestBody.removeLabelIds ?? [] });
          return { data: { id: p.id } };
        },
        get: async (p: { id: string; format: string }) => {
          calls.push({ op: "messages.get", id: p.id, format: p.format });
          const m = messages.find((x) => x.id === p.id)!;
          if (p.format === "metadata") return { data: { id: m.id, labelIds: m.labelIds, payload: { headers: [] } } };
          return {
            data: {
              id: m.id,
              threadId: "t",
              internalDate: "1789000000000",
              labelIds: m.labelIds,
              payload: {
                mimeType: "text/plain",
                headers: [
                  { name: "From", value: `${m.from} <${m.from}>` },
                  { name: "Subject", value: m.subject },
                  { name: "Date", value: "Tue, 15 Sep 2026 09:00:00 -0400" },
                ],
                body: { data: encode(m.body) },
              },
            },
          };
        },
      },
      threads: {
        list: async () => {
          calls.push({ op: "threads.list" });
          throw new Error("the sweep must never list threads");
        },
      },
    },
  } as unknown as gmail_v1.Gmail;
  return { gmail, calls };
}

const skipWith = (onFile: string[] = []) => ({ doneLabelId: DONE_ID, onFileIds: new Set(onFile) });

describe("what the sweep reads", () => {
  it("sweeps a message that is READ and carries no label", async () => {
    // The whole reason for the change: read on his phone, still a pick.
    const { gmail } = fakeGmail([{ id: "m1", from: "ashley@example.com", subject: "Re: Week 2", body: "Waggs3-Tampa", labelIds: ["INBOX"] }]);
    const got = await listSweepFrom(gmail, ["ashley@example.com"], skipWith());
    expect(got.map((m) => m.id)).toEqual(["m1"]);
    expect(got[0].body).toBe("Waggs3-Tampa");
  });

  it("skips a message that is UNREAD but carries the DONE label", async () => {
    const { gmail } = fakeGmail([{ id: "m2", from: "ashley@example.com", subject: "x", body: "Waggs3-Tampa", labelIds: ["INBOX", "UNREAD", DONE_ID] }]);
    expect(await listSweepFrom(gmail, ["ashley@example.com"], skipWith())).toEqual([]);
  });

  it("skips a message with no label whose id is already on file", async () => {
    const { gmail, calls } = fakeGmail([{ id: "m3", from: "ashley@example.com", subject: "x", body: "Waggs3-Tampa", labelIds: ["INBOX", "UNREAD"] }]);
    expect(await listSweepFrom(gmail, ["ashley@example.com"], skipWith(["m3"]))).toEqual([]);
    // Not even its metadata is fetched: the id is enough.
    expect(calls.filter((c) => c.op === "messages.get")).toEqual([]);
  });

  it("decides on the message's own labelIds, not the search clause, and reads the body in FULL", async () => {
    const { gmail, calls } = fakeGmail([
      { id: "a", from: "p@x.com", subject: "x", body: "Waggs3-Tampa and more words", labelIds: ["INBOX"] },
      { id: "b", from: "p@x.com", subject: "x", body: "filed", labelIds: [DONE_ID] },
    ]);
    const got = await listSweepFrom(gmail, ["p@x.com"], skipWith());
    expect(got.map((m) => m.id)).toEqual(["a"]);
    // The body is what messages.get format full returned, never the snippet.
    expect(got[0].body).toBe("Waggs3-Tampa and more words");
    const gets = calls.filter((c) => c.op === "messages.get");
    expect(gets).toEqual([
      { op: "messages.get", id: "a", format: "metadata" },
      { op: "messages.get", id: "a", format: "full" },
      { op: "messages.get", id: "b", format: "metadata" },
    ]);
    expect(calls.some((c) => c.op === "threads.list")).toBe(false);
  });

  it("refuses to read at all without a label id", async () => {
    const { gmail, calls } = fakeGmail([{ id: "m", from: "p@x.com", subject: "x", body: "y", labelIds: [] }]);
    await expect(listSweepFrom(gmail, ["p@x.com"], { doneLabelId: "", onFileIds: new Set() })).rejects.toThrow(/label id is empty/);
    expect(calls).toEqual([]);
  });
});

describe("the DONE label exists before any read", () => {
  it("resolves the id when the label exists, and creates it when it does not", async () => {
    const have = fakeGmail([], { labels: [{ name: DONE_LABEL, id: DONE_ID }] });
    expect(await ensureLabel(have.gmail, DONE_LABEL)).toBe(DONE_ID);
    expect(have.calls.some((c) => c.op === "labels.create")).toBe(false);
  });

  it("stops the run, with nothing read, when the label is missing and cannot be created", async () => {
    // A fresh module-level cache is needed for the missing case: the label
    // cache is filled on first list, so a missing label is proved through a
    // name the earlier tests never asked for.
    const missing = fakeGmail([{ id: "m", from: "p@x.com", subject: "x", body: "y", labelIds: [] }], { labels: [], createFails: true });
    await expect(ensureLabel(missing.gmail, "Pool-Survivor-Missing")).rejects.toThrow(/could not be created.*Nothing was read/);
    expect(missing.calls.map((c) => c.op)).toContain("labels.create");
    expect(missing.calls.some((c) => c.op === "messages.list" || c.op === "messages.get")).toBe(false);
  });

  it("creates it under gmail.modify and returns the new id", async () => {
    const created = fakeGmail([], { labels: [] });
    expect(await ensureLabel(created.gmail, "Pool-Survivor-Fresh")).toBe("Label_new");
    expect(created.calls.filter((c) => c.op === "labels.create").map((c) => c.id)).toEqual(["Pool-Survivor-Fresh"]);
  });

  it("is resolved in the CLI before the roster mail, the strangers or the bounces are read, and before the on-file ids", () => {
    const c = readFileSync(path.join(__dirname, "../..", "scripts/picks/cli.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const label = c.indexOf("await ensureLabel(gmail, DONE_LABEL)");
    expect(label).toBeGreaterThan(-1);
    for (const reader of ["await loadFiledMessageIds(client)", "await listSweepFrom(", "await listSweepMatching(", "await readNamedMessages("]) {
      const at = c.indexOf(reader);
      expect(at, reader).toBeGreaterThan(label);
    }
  });
});

describe("the queries", () => {
  it("carry no is:unread and exclude the DONE label, on the roster read, the subject read and the bounce read", () => {
    for (const q of sweepFromQueries(["a@b.com"])) {
      expect(q).not.toContain("is:unread");
      expect(q).toContain(notDoneClause(DONE_LABEL));
    }
    expect(bounceSweepQuery()).not.toContain("is:unread");
    expect(bounceSweepQuery()).toContain(notDoneClause(DONE_LABEL));
    expect(bounceSweepQuery()).toContain("from:(mailer-daemon OR postmaster)");
    expect(notDoneClause("Pool-Survivor-Done")).toBe('-label:"Pool-Survivor-Done"');
    expect(() => notDoneClause(" ")).toThrow(/empty/);
  });
});

describe("--message-id", () => {
  it("reads a DONE-labelled message by id where the sweep would skip it, in full, with no metadata get and no label list", async () => {
    // The named reader is DRIVEN here (review, 2026-09-15): the source
    // assertion below held the branch to "no on-file or label check" only by
    // the absence of the word "skip", so a label check under another name
    // slipped through it. This fake records every call; a metadata get or a
    // labels.list on the named path is the check the reader must not make.
    const { gmail, calls } = fakeGmail([
      { id: "m9", from: "maria@example.com", subject: "Re: Week 2", body: "1042 \u2192 49ers*", labelIds: ["INBOX", DONE_ID] },
      { id: "m10", from: "ashley@example.com", subject: "Re: Week 2", body: "Waggs3-Tampa", labelIds: ["INBOX"] },
    ]);
    // The sweep skips m9 (labelled DONE, and on file besides) and takes m10.
    expect((await listSweepFrom(gmail, ["maria@example.com", "ashley@example.com"], skipWith(["m9"]))).map((m) => m.id)).toEqual(["m10"]);
    calls.length = 0;
    const named = await readNamedMessages(gmail, ["m9", "m10"], ADMIN_MAILBOX);
    expect(named.map((m) => [m.id, m.body])).toEqual([
      ["m9", "1042 \u2192 49ers*"],
      ["m10", "Waggs3-Tampa"],
    ]);
    expect(calls).toEqual([
      { op: "messages.get", id: "m9", format: "full" },
      { op: "messages.get", id: "m10", format: "full" },
    ]);
  });

  it("refuses a named message from the admin mailbox before returning anything", async () => {
    const { gmail } = fakeGmail([{ id: "self", from: ADMIN_MAILBOX, subject: "Survivor picks", body: "1042 SF", labelIds: ["INBOX"] }]);
    await expect(readNamedMessages(gmail, ["self"], ADMIN_MAILBOX)).rejects.toThrow(/admin mailbox.*picks:self/);
  });

  it("in the CLI takes exactly the named ids, through readNamedMessages, with no skip set, label id or label check of its own", () => {
    const c = readFileSync(path.join(__dirname, "../..", "scripts/picks/cli.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const branch = c.match(/if \(args\.messageIds\.length\) \{([\s\S]*?)\n    \} else \{/);
    expect(branch, "the --message-id branch").not.toBeNull();
    expect(branch![1]).toMatch(/for \(const m of await readNamedMessages\(gmail, args\.messageIds, ADMIN_MAILBOX\)\) \{/);
    for (const forbidden of [/\bskip\b/, /labelIds/, /doneLabelId/, /\bcontinue\b/, /messages\.get/, /getMessageFull/, /hasLabel/]) {
      expect(branch![1], String(forbidden)).not.toMatch(forbidden);
    }
    // The refusal lives in the reader, once, and nowhere in the branch.
    const gm = readFileSync(path.join(__dirname, "../..", "scripts/lib/gmail.ts"), "utf8");
    expect(gm).toMatch(/export async function readNamedMessages\(gmail: gmail_v1\.Gmail, ids: string\[\], refuse: string\)/);
    expect(gm).toMatch(/if \(m\.fromAddress === refuse\) \{\s*throw new Error/);
    // Repeatable: every occurrence is collected, not the last one kept.
    expect(c).toMatch(/x === "--message-id"\) a\.messageIds\.push\(takeValue\(argv, \+\+i, x\)\)/);
    // The old flag spelling is accepted once and prints the new name.
    expect(c).toMatch(/x === "--keep-unfiled"\) a\.keepUnfiled = true/);
    expect(c).toMatch(/x === "--keep-unread"\) \{[\s\S]{0,400}?--keep-unfiled[\s\S]{0,200}?a\.keepUnfiled = true/);
    expect(c).not.toMatch(/keepUnread\b/);
  });
});

describe("filing a message: the WRITE half of the marker", () => {
  // markProcessed is the only place the DONE label is ever added, and until
  // this was driven (review, 2026-09-15) a version that never added it passed
  // every test: the read side was proved on labelIds the fake already held.
  // With the label never written, a message filed ONLY by label - an
  // "already current" reply, a not-ours bounce - would be re-read and
  // re-reported every hourly tick, the loop ensureLabel exists to prevent.
  it("adds the DONE label id and removes UNREAD in one modify, and says it filed", async () => {
    const { gmail, calls } = fakeGmail([{ id: "m1", from: "p@x.com", subject: "x", body: "y", labelIds: ["INBOX", "UNREAD"] }]);
    expect(await markProcessed(gmail, "m1", DONE_LABEL)).toBe(true);
    expect(calls.filter((c) => c.op === "messages.modify")).toEqual([{ op: "messages.modify", id: "m1", add: [DONE_ID], remove: ["UNREAD"] }]);
  });

  it("with no such label adds nothing, still marks read, and says it did NOT file", async () => {
    // A name the cache has never seen: the label list is filled once per
    // module and every earlier fake in this file carried the real name.
    const { gmail, calls } = fakeGmail([{ id: "m2", from: "p@x.com", subject: "x", body: "y", labelIds: ["INBOX", "UNREAD"] }]);
    expect(await markProcessed(gmail, "m2", "Pool-Survivor-Nowhere")).toBe(false);
    expect(calls.filter((c) => c.op === "messages.modify")).toEqual([{ op: "messages.modify", id: "m2", add: [], remove: ["UNREAD"] }]);
  });
});

describe("what a written pick leaves behind", () => {
  it("records the Gmail message id beside every pick the sweep writes, so the id alone marks the message processed", () => {
    const c = readFileSync(path.join(__dirname, "../..", "scripts/picks/cli.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    expect(c).toMatch(/const id = await submitPick\(client, \{[\s\S]*?\}\);[\s\S]{0,400}?await recordPickMessage\(client, \{ actor, pickId: id, messageId: p\.messageId,/);
    const db = readFileSync(path.join(__dirname, "../..", "scripts/lib/db.ts"), "utf8");
    // The on-file set reads both places an id can be: the queue and the audit row.
    expect(db).toMatch(/from\("pending_actions"\)[\s\S]{0,120}?select\("source_message_id"\)/);
    expect(db).toMatch(/from\("audit_log"\)[\s\S]{0,120}?eq\("action", PICK_FROM_MESSAGE_ACTION\)/);
    // Paged: the flood left more than a thousand pending rows.
    expect(db).toMatch(/fetchAllPages<\{ source_message_id/);
  });
});
