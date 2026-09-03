import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  FREE_ENTRY_OWNER_EMAIL,
  FREE_ENTRY_NAME_PREFIX,
  freeEntitlement,
} from "@/lib/free-entries";
import { DEFAULT_PRICING } from "@/lib/pool";

// Minting free entries is the DATABASE's job. tests/sql/12_free_entries.sql
// proves the trigger behaves; what it cannot check is that the constants
// baked into the SQL still match the ones the app reads back. Those two
// representations are the seam this file watches.
//
// Everything the trigger keys on is a literal inside the migration, because a
// trigger function cannot import from TypeScript. So the drift is silent by
// construction: change FREE_ENTRY_OWNER_EMAIL and the app keeps flagging the
// right owner while the trigger quietly mints for nobody, forever.

const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260904000043_free_entries_enforced_in_db.sql",
  ),
  "utf8",
);

describe("the trigger and the app agree on the free-entry constants", () => {
  it("keys on the same owner address the app flags as the runner", () => {
    // If this ever fails, the trigger is minting for an owner that does not
    // exist: it returns silently and the entitlement is never met again.
    expect(MIGRATION).toContain(`'${FREE_ENTRY_OWNER_EMAIL}'`);
  });

  it("mints under the same name prefix", () => {
    expect(MIGRATION).toContain(`'${FREE_ENTRY_NAME_PREFIX}'`);
  });

  it("falls back to the same ratio the app defaults to", () => {
    // The trigger reads config.free_entry_ratio and coalesces; the fallback
    // has to be the app's default or an empty config table would silently
    // change the rule.
    expect(MIGRATION).toMatch(
      new RegExp(`coalesce\\(v_ratio,\\s*${DEFAULT_PRICING.freeEntryRatio}\\)`),
    );
  });

  it("reads both separator forms, so it never restarts at AAA #1", () => {
    // The seven that predate the numbering convention went to Lynne as
    // "AAA 1".."AAA 7". A pattern that demanded the hash would parse the
    // highest as 0 and mint a duplicate against a number she holds.
    // tests/sql/12_free_entries.sql exercises this end to end; this asserts
    // the pattern itself never tightens.
    expect(MIGRATION).toContain(String.raw`'^AAA #?(\d+)$'`);
  });

  it("only ever mints — no delete or void of a free entry", () => {
    const body = MIGRATION.slice(
      MIGRATION.indexOf("create or replace function mint_free_entries"),
      MIGRATION.indexOf("drop trigger if exists"),
    );
    // A downward crossing leaves a surplus that /admin surfaces. Removing an
    // entry Lynne may already hold a number against is Anthony's call, never
    // a trigger's.
    expect(body).not.toMatch(/delete\s+from\s+entries/i);
    expect(body).not.toMatch(/set\s+voided_at/i);
  });

  it("guards against re-entry, since its own insert re-fires it", () => {
    expect(MIGRATION).toContain("pg_trigger_depth()");
  });

  it("audits in the same transaction as the write", () => {
    expect(MIGRATION).toContain("insert into audit_log");
  });
});

describe("the app side stays read-only", () => {
  it("exposes no mint — the entitlement is a number to display", async () => {
    const mod = await import("@/lib/free-entries");
    // nextFreeNames used to live here and was called from six server actions.
    // Reintroducing it recreates the split that under-minted AAA #9.
    expect(Object.keys(mod)).not.toContain("nextFreeNames");
    expect(freeEntitlement(94)).toBe(9);
  });

  it("no server action mints free entries any more", () => {
    const actions = readFileSync(
      join(process.cwd(), "src/app/admin/actions.ts"),
      "utf8",
    );
    expect(actions).not.toContain("syncFreeEntries");
    expect(actions).not.toContain("isFree: true");
  });
});
