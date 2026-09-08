import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { gmail_v1 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../../scripts/lib/db", () => ({
  recordAudit: vi.fn(),
  loadAuditByAction: vi.fn(),
}));

import { loadAuditByAction, recordAudit } from "../../scripts/lib/db";
import { SEND_AUDIT_ACTION, SEND_CLAIM_ACTION, sendAllowlisted, type PriorSend, type SendRequest } from "../../scripts/lib/send";

const audit = vi.mocked(recordAudit);
const loadAudit = vi.mocked(loadAuditByAction);

function fakeGmail() {
  const send = vi.fn(async () => ({ data: { id: "gmail-msg-1" } }));
  return { gmail: { users: { messages: { send } } } as unknown as gmail_v1.Gmail, send };
}
const client = {} as SupabaseClient;

const req: SendRequest = {
  template: "pick_reminder",
  to: "Chas.Flaster@gmail.com",
  subject: "Survivor - Week 1 picks needed",
  body: "Chas,\n\nI do not have a Week 1 pick yet for:\n  Chas Flaster #1\n",
  week: 1,
  deadlineIso: "2026-09-11T16:00:00+00:00",
  entryNames: ["Chas Flaster #1"],
  actor: "anthonydellapia@gmail.com",
};

describe("sendAllowlisted", () => {
  const original = process.env.REMINDER_AUTOSEND;
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

  it("refuses a template that is not on the allowlist", async () => {
    const { gmail, send } = fakeGmail();
    await expect(sendAllowlisted(gmail, client, [], { ...req, template: "pick_request" as never })).rejects.toThrow("not on the send allowlist");
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses unless REMINDER_AUTOSEND is exactly true", async () => {
    const { gmail, send } = fakeGmail();
    for (const v of [undefined, "1", "TRUE", "yes"]) {
      if (v === undefined) delete process.env.REMINDER_AUTOSEND;
      else process.env.REMINDER_AUTOSEND = v;
      await expect(sendAllowlisted(gmail, client, [], req)).rejects.toThrow("drafts only");
    }
    expect(send).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses a recipient with nothing to ask for", async () => {
    const { gmail, send } = fakeGmail();
    await expect(sendAllowlisted(gmail, client, [], { ...req, entryNames: [] })).rejects.toThrow("no unpicked entries");
    expect(send).not.toHaveBeenCalled();
  });

  it("skips a recipient already mailed on that lock day, whatever the case of the address", async () => {
    const { gmail, send } = fakeGmail();
    const prior: PriorSend[] = [{ recipient: "chas.flaster@gmail.com", lockDay: "2026-09-11", messageId: "m0", at: "" }];
    const out = await sendAllowlisted(gmail, client, prior, req);
    expect(out.kind).toBe("already_sent");
    expect(send).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("re-reads the audit log before sending and honours a claim written since the snapshot", async () => {
    const { gmail, send } = fakeGmail();
    loadAudit.mockImplementation(async (_client, action) =>
      action === SEND_CLAIM_ACTION
        ? [{ id: 9, at: "2026-09-11T14:00:00Z", actor: "x", action, target_id: "chas.flaster@gmail.com:2026-09-11", after: { recipient: "chas.flaster@gmail.com", lock_day: "2026-09-11" } }]
        : [],
    );
    const prior: PriorSend[] = [];
    const out = await sendAllowlisted(gmail, client, prior, req);
    expect(out.kind).toBe("already_sent");
    expect(send).not.toHaveBeenCalled();
    expect(prior).toHaveLength(1);
  });

  it("writes the claim before the Gmail call and the sent row with the message id after it", async () => {
    const { gmail, send } = fakeGmail();
    const order: string[] = [];
    audit.mockImplementation(async (_c, a) => {
      order.push(a.action);
      return order.length;
    });
    send.mockImplementation(async () => {
      order.push("gmail");
      return { data: { id: "gmail-msg-1" } };
    });
    const prior: PriorSend[] = [];
    const out = await sendAllowlisted(gmail, client, prior, req);
    expect(order).toEqual([SEND_CLAIM_ACTION, "gmail", SEND_AUDIT_ACTION]);
    expect(out).toEqual({ kind: "sent", messageId: "gmail-msg-1", auditId: 3, lockDay: "2026-09-11" });
    const sentRow = audit.mock.calls[1][1];
    expect(sentRow.after).toMatchObject({ recipient: "chas.flaster@gmail.com", lock_day: "2026-09-11", message_id: "gmail-msg-1", week: 1, template: "pick_reminder" });
    expect(sentRow.targetId).toBe("gmail-msg-1");
    expect(prior[0]).toMatchObject({ recipient: "chas.flaster@gmail.com", lockDay: "2026-09-11" });
  });

  it("names the message id and the standing claim when the sent row cannot be written", async () => {
    const { gmail, send } = fakeGmail();
    audit.mockImplementationOnce(async () => 1).mockImplementationOnce(async () => {
      throw new Error("audit_log insert: permission denied");
    });
    await expect(sendAllowlisted(gmail, client, [], req)).rejects.toThrow(/gmail-msg-1[\s\S]*claim row stands/);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
