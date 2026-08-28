import { describe, expect, it } from "vitest";
import {
  actionLabel,
  auditSearchText,
  diffPayloads,
  formatAuditValue,
  humanizeKey,
  summarizeChanges,
} from "@/lib/audit-format";

describe("humanizeKey", () => {
  it("uses the pool's own words for known columns", () => {
    expect(humanizeKey("amount_cents")).toBe("Amount");
    expect(humanizeKey("submitted_as_name")).toBe("Name Lynne has");
    expect(humanizeKey("name_is_default")).toBe("Default name");
  });

  it("falls back to readable words for anything new", () => {
    expect(humanizeKey("some_new_column")).toBe("Some new column");
    expect(humanizeKey("lynne_widget")).toBe("Lynne widget");
    expect(humanizeKey("confirmed_at")).toBe("Confirmed");
  });
});

describe("formatAuditValue", () => {
  it("renders money, booleans, nulls and uuids for people", () => {
    expect(formatAuditValue("amount_cents", 10000)).toBe("$100");
    expect(formatAuditValue("is_free_entry", true)).toBe("Yes");
    expect(formatAuditValue("is_free_entry", false)).toBe("No");
    expect(formatAuditValue("lynne_number", null)).toBe("—");
    expect(formatAuditValue("entry_name", "")).toBe("—");
    expect(
      formatAuditValue("owner_id", "cdee64a2-5c94-4308-b114-e3458eb06ba7"),
    ).toBe("cdee64a2…");
  });

  it("keeps plain numbers plain and joins arrays", () => {
    expect(formatAuditValue("entry_index", 4)).toBe("4");
    expect(formatAuditValue("txn_ids", ["a", "b"])).toBe("a, b");
    expect(formatAuditValue("txn_ids", [])).toBe("—");
  });
});

describe("diffPayloads", () => {
  // The real shape of an update_entry row: the whole record, twice.
  const before = {
    id: "3db0e795-6555-4610-b9a1-76236a27573d",
    owner_id: "cdee64a2-5c94-4308-b114-e3458eb06ba7",
    entry_name: "Ray Vassallo 4",
    entry_index: 4,
    name_is_default: true,
    is_free_entry: false,
    lynne_number: null,
    created_at: "2026-08-27T10:00:00Z",
  };
  const after = {
    ...before,
    entry_name: "Johnvas 2",
    name_is_default: false,
    created_at: "2026-08-27T10:00:00Z",
  };

  it("returns only the fields that actually changed", () => {
    const changes = diffPayloads(before, after);
    expect(changes.map((c) => c.key)).toEqual([
      "entry_name",
      "name_is_default",
    ]);
    expect(changes[0]).toMatchObject({
      label: "Entry name",
      kind: "changed",
      from: "Ray Vassallo 4",
      to: "Johnvas 2",
    });
  });

  it("never surfaces id or timestamps as changes", () => {
    const changes = diffPayloads(
      { id: "a", created_at: "x", updated_at: "y", entry_name: "One" },
      { id: "a", created_at: "x", updated_at: "z", entry_name: "Two" },
    );
    expect(changes.map((c) => c.key)).toEqual(["entry_name"]);
  });

  it("treats an after-only payload as values set, before-only as cleared", () => {
    const created = diffPayloads(null, { first_name: "Ray", entries: 4 });
    expect(created.map((c) => [c.key, c.kind, c.to])).toEqual([
      ["entries", "set", "4"],
      ["first_name", "set", "Ray"],
    ]);
    const removed = diffPayloads({ entry_name: "Maria Mary 4" }, null);
    expect(removed[0]).toMatchObject({ kind: "cleared", from: "Maria Mary 4" });
  });

  it("is empty when a row carries no payload at all", () => {
    expect(diffPayloads(null, null)).toEqual([]);
    expect(diffPayloads(undefined, undefined)).toEqual([]);
  });

  it("does not mistake an unchanged null for a change", () => {
    expect(
      diffPayloads({ lynne_number: null }, { lynne_number: null }),
    ).toEqual([]);
  });
});

describe("summarize and search", () => {
  it("writes a one-line summary of what changed", () => {
    expect(
      summarizeChanges(diffPayloads({ entry_name: "A" }, { entry_name: "B" })),
    ).toBe("Entry name: A → B");
  });

  it("matches on the note, the actor and the payload contents", () => {
    const text = auditSearchText({
      actor: "anthonydellapia@gmail.com",
      action: "payment_sweep_exclude",
      targetTable: "payments",
      targetId: null,
      note: "three $500 Venmo receipts are TNF block pool",
      before: null,
      after: { txn_ids: ["4665850241799398643"] },
    });
    expect(text).toContain("payment sweep resolution"); // humanized action
    expect(text).toContain("tnf block pool"); // note
    expect(text).toContain("4665850241799398643"); // payload
  });
});

describe("actionLabel", () => {
  it("names known actions and degrades gracefully", () => {
    expect(actionLabel("update_entry")).toBe("Entry updated");
    expect(actionLabel("payment_sweep_exclude")).toBe(
      "Payment sweep resolution",
    );
    expect(actionLabel("some_future_action")).toBe("Some future action");
  });
});
