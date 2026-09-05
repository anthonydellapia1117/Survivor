import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KIND_DISPATCH,
  appliesAutomatically,
  dispatchRpcFor,
  kindLabel,
  summarizePayload,
} from "@/lib/queue";

// The NEEDS ANTHONY queue: rows staged by the sweep through
// admin_stage_pending, resolved by Anthony at /admin/queue. Two pieces of
// pure logic live in src/lib/queue.ts and are guarded here: the summary a
// row shows before Anthony decides, and the kind -> RPC dispatch table the
// page uses to say whether Approve applies the row or only records the
// decision. The SQL side of that table is in the migration, and the seam
// test at the bottom holds the two together.

describe("summarizePayload", () => {
  it("reads a payment the way the sweep stages it", () => {
    expect(
      summarizePayload("payment", {
        amount_cents: 10000,
        paid_on: "2026-09-03",
        method: "venmo",
        venmo_txn_id: "4321",
        sender: "Nicholas Teti",
      }),
    ).toBe("$100 from Nicholas Teti on 2026-09-03, venmo 4321");
  });

  it("says when a payment has no owner match yet", () => {
    expect(
      summarizePayload("payment", {
        amount_cents: 5000,
        paid_on: "2026-09-04",
        method: "venmo",
      }),
    ).toBe("$50 from unmatched on 2026-09-04, venmo");
  });

  it("reads a pick", () => {
    expect(
      summarizePayload("pick", {
        entry_id: "cdee64a2-5c94-4308-b114-e3458eb06ba7",
        entry_name: "Pumpy321",
        week: 3,
        team: "PHI",
      }),
    ).toBe("Week 3: PHI for Pumpy321");
    expect(
      summarizePayload("pick", {
        entry_id: "cdee64a2-5c94-4308-b114-e3458eb06ba7",
        week: 1,
        team: "SKIP_WEEK",
      }),
    ).toBe("Week 1: SKIP_WEEK for cdee64a2…");
  });

  it("reads an entries top-up", () => {
    expect(
      summarizePayload("entries", {
        owner_id: "cdee64a2-5c94-4308-b114-e3458eb06ba7",
        owner_name: "Kris Tomasco",
        entry_names: ["Kris Tomasco #3", "Kris Tomasco #4"],
      }),
    ).toBe("2 entries for Kris Tomasco: Kris Tomasco #3, Kris Tomasco #4");
  });

  it("falls back to key: value pairs for a kind it does not know", () => {
    expect(
      summarizePayload("identity", { email: "x@example.com", note: "two Marios" }),
    ).toBe("email: x@example.com; note: two Marios");
  });

  it("never returns an empty string, and caps the length", () => {
    expect(summarizePayload("other", {})).toBe("(no detail)");
    const long = summarizePayload("other", { note: "x".repeat(500) });
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("kind dispatch", () => {
  it("routes the three kinds the database applies by itself", () => {
    expect(dispatchRpcFor("payment")).toBe("admin_record_payment");
    expect(dispatchRpcFor("pick")).toBe("admin_submit_pick");
    expect(dispatchRpcFor("entries")).toBe("admin_add_entries");
  });

  it("leaves everything else to Anthony", () => {
    expect(dispatchRpcFor("new_owner")).toBeNull();
    expect(dispatchRpcFor("identity")).toBeNull();
    expect(dispatchRpcFor("")).toBeNull();
    expect(appliesAutomatically("payment")).toBe(true);
    expect(appliesAutomatically("new_owner")).toBe(false);
  });

  it("labels kinds for the screen", () => {
    expect(kindLabel("payment")).toBe("Payment");
    expect(kindLabel("new_owner")).toBe("New owner");
    expect(kindLabel("some_future_thing")).toBe("Some future thing");
  });
});

describe("the TS dispatch table matches the SQL one", () => {
  // The migration carries the real dispatch: a plpgsql CASE on kind that
  // calls an existing admin_* RPC. The page reads KIND_DISPATCH to tell
  // Anthony whether Approve will apply the row or only record his decision.
  // If the two drift, the screen promises one thing and the database does
  // another, so they are read from the same file and compared here.
  const dir = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f.includes("pending_actions"))
    .sort()
    .at(-1);
  const sql = file ? readFileSync(join(dir, file), "utf8") : "";

  /** The body of each `when '<kind>' then` branch, cut at the next branch or
   *  at the CASE's else. Bounded on purpose: the first version matched from
   *  the branch head to the first occurrence of the RPC name ANYWHERE later
   *  in the file, so pointing payment at admin_submit_pick still passed
   *  because the pick branch calls it. Confirmed to FAIL when broken only
   *  after the cut was added. */
  function sqlBranches(src: string): Record<string, string> {
    const heads = [...src.matchAll(/when '([a-z_]+)' then/g)].map((m) => ({
      kind: m[1],
      start: (m.index ?? 0) + m[0].length,
    }));
    const out: Record<string, string> = {};
    heads.forEach((h, i) => {
      const ends = [heads[i + 1]?.start ?? src.length];
      const elseAt = src.indexOf("\n    else\n", h.start);
      if (elseAt >= 0) ends.push(elseAt);
      out[h.kind] = src.slice(h.start, Math.min(...ends));
    });
    return out;
  }
  const branches = sqlBranches(sql);

  it("finds the queue migration", () => {
    expect(file, "no pending_actions migration").toBeDefined();
    expect(sql).toContain("create or replace function admin_approve_pending(");
  });

  it("every TS kind that applies has a SQL branch calling that RPC and no other", () => {
    for (const [kind, rpc] of Object.entries(KIND_DISPATCH)) {
      const body = branches[kind];
      expect(body, `no SQL branch for ${kind}`).toBeDefined();
      const calls = [...(body ?? "").matchAll(/admin_[a-z_]+\(/g)].map(
        (m) => m[0],
      );
      expect(calls, `${kind} branch must call exactly ${rpc}`).toEqual([
        `${rpc}(`,
      ]);
    }
  });

  it("every SQL branch is a TS kind", () => {
    const kinds = Object.keys(branches);
    expect(kinds.length).toBe(Object.keys(KIND_DISPATCH).length);
    for (const kind of kinds) {
      expect(KIND_DISPATCH, `SQL applies ${kind}, TS does not know it`)
        .toHaveProperty(kind);
    }
  });

  it("every dispatched RPC is defined by some migration", () => {
    const all = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    for (const rpc of Object.values(KIND_DISPATCH)) {
      expect(all, `${rpc} is not an existing RPC`).toMatch(
        new RegExp(`create (or replace )?function (public\\.)?${rpc}\\(`),
      );
    }
  });
});
