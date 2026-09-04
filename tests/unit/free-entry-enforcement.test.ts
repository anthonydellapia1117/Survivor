import { readdirSync, readFileSync } from "node:fs";
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
//
// Assertions run against the LAST migration that defines the function, since
// migrations are append-only and a later one can replace it.

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
const DEFINES = "create or replace function mint_free_entries";

/**
 * The LIVE function body, not the first one that ever shipped.
 *
 * Migrations are append-only, so a later file can `create or replace` the
 * function -- 20260904000044 does exactly that, to serialize the mint. Reading
 * a fixed filename would leave this suite guarding a superseded body: someone
 * could change the owner address in the newest migration and every assertion
 * below would still pass against the old one. So resolve the last migration
 * that defines it, the same way PostgreSQL does when the files are replayed
 * in order.
 */
function liveMigration(): { file: string; sql: string; body: string } {
  const defining = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }))
    .filter((m) => m.sql.includes(DEFINES));
  expect(
    defining.length,
    "no migration defines mint_free_entries",
  ).toBeGreaterThan(0);
  const last = defining[defining.length - 1];
  // Just the function, so an assertion cannot be satisfied by prose in the
  // file's header comments...
  const from = last.sql.indexOf(DEFINES);
  const end = last.sql.indexOf("end $$;", from);
  expect(end, "could not find the end of the function body").toBeGreaterThan(from);
  const body = last.sql.slice(from, end + "end $$;".length);
  // ...and with the function's OWN comments stripped, because the assertions
  // below are positional. The comment explaining the advisory lock names it
  // several lines above the `perform` that takes it, so an unstripped body
  // anchors "where is the lock" on the prose and every ordering check passes
  // no matter where the real call sits. Caught by deliberately moving the lock
  // after the reads and watching this file stay green while the SQL suite
  // failed.
  return { ...last, body, code: body.replace(/--[^\n]*/g, "") };
}

const LIVE = liveMigration();
/** The function body with comments stripped — what actually executes. */
const MIGRATION = LIVE.code;

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
    // A downward crossing leaves a surplus that /admin surfaces. Removing an
    // entry Lynne may already hold a number against is Anthony's call, never
    // a trigger's.
    expect(MIGRATION).not.toMatch(/delete\s+from\s+entries/i);
    expect(MIGRATION).not.toMatch(/set\s+voided_at/i);
  });

  it("locks before it reads, with no unlocked fast path", () => {
    // Two failures, both reproduced against a real database:
    //
    //  - Two transactions crossing the same threshold both read "held N, owed
    //    N+1" and both inserted the same AAA number at the same entry_index;
    //    the second died on (owner_id, entry_index), losing a legitimate owner.
    //  - Worse: two transactions each adding one recruit to a roster of 8 both
    //    read 9 under READ COMMITTED, both concluded nothing was owed, and
    //    committed 10 recruits with ZERO free entries -- a SILENT under-mint,
    //    which is the exact failure this rule was moved into the database to
    //    eliminate.
    //
    // The second is why there is no fast path: deciding "nothing is owed" from
    // an unlocked read is itself the bug. So the lock comes first, and EVERY
    // count is taken under it.
    expect(MIGRATION).toContain("pg_advisory_xact_lock");
    // Transaction-scoped specifically: a session-level pg_advisory_lock has an
    // unlock path to forget and leaks straight through PgBouncer's transaction
    // pooling, which is how Supabase serves the pooled port.
    expect(MIGRATION).not.toMatch(/pg_advisory_lock\s*\(/);

    const lockAt = MIGRATION.indexOf("pg_advisory_xact_lock");
    const before = MIGRATION.slice(0, lockAt);
    const after = MIGRATION.slice(lockAt);

    // Nothing is read before the lock -- not the counts, not the runner, not
    // the ratio. Only the re-entrancy guard may precede it.
    expect(before).not.toMatch(/\binto v_target\b/);
    expect(before).not.toMatch(/\binto v_have\b/);
    expect(before).not.toMatch(/\binto v_owner\b/);
    expect(before).not.toMatch(/\binto v_ratio\b/);
    expect(before).not.toMatch(/\binto v_idx\b/);
    // ...and no early return that would skip the lock on a "nothing owed" read.
    expect(before).not.toMatch(/return null;[\s\S]*return null;/);

    for (const read of ["v_owner", "v_ratio", "v_target", "v_have", "v_idx", "v_max"]) {
      expect(after, `${read} must be read under the lock`).toMatch(
        new RegExp(`into\\s+${read}\\b`),
      );
    }
  });

  it("takes the lock before the statement's row locks, on every input table", () => {
    // Acquired in an AFTER trigger, a transaction is already holding row locks
    // when it asks for the advisory lock, so two transactions can take the
    // same two resources in opposite orders. Reproduced: a merge-shaped
    // transaction (entries then owners) deadlocked against a concurrent owner
    // edit and PostgreSQL aborted one legitimate admin action. A BEFORE
    // STATEMENT trigger runs before the statement takes any lock, which makes
    // the order the same for everyone.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
      .join("\n");
    expect(files).toMatch(
      /create or replace function lock_free_entry_rule[\s\S]{0,600}?pg_advisory_xact_lock/,
    );
    for (const table of ["entries", "owners", "config"]) {
      expect(
        files,
        `no BEFORE STATEMENT lock trigger on ${table}`,
      ).toMatch(
        new RegExp(
          `create trigger \\w+\\s+before[\\s\\S]{0,120}?on ${table}\\b[\\s\\S]{0,120}?for each statement[\\s\\S]{0,120}?lock_free_entry_rule`,
        ),
      );
    }
  });

  it("counts the runner's held entries, but numbers against every AAA ever", () => {
    // The two reads answer different questions and are scoped differently on
    // purpose. Getting either wrong produced a real bug on this branch:
    //
    //   * v_have pool-wide: one tick of the "free" checkbox on another owner
    //     silently cost the runner an entry — 60 recruited, owed 6, holding 5,
    //     and /admin (also pool-wide then) compared 6 against 6 and raised
    //     nothing. The entitlement is HIS: "Anthony's only", "Nobody else ever
    //     gets one".
    //   * v_max scoped to the runner: a merge that emptied his row restarted
    //     the numbering at AAA #1, duplicating four numbers Lynne holds. A
    //     number that has ever existed must never come back, whoever holds it.
    const haveAt = MIGRATION.indexOf("into v_have");
    const haveClause = MIGRATION.slice(haveAt, MIGRATION.indexOf(";", haveAt));
    expect(haveClause, "the held count is the runner's own rows").toMatch(
      /owner_id = v_owner/,
    );

    const maxAt = MIGRATION.indexOf("into v_max");
    const maxClause = MIGRATION.slice(maxAt, MIGRATION.indexOf(";", maxAt));
    expect(maxClause, "the numbering spans every owner").not.toMatch(
      /owner_id = v_owner/,
    );

    // Both are read under the lock, and the mint still lands on the runner.
    expect(haveAt).toBeGreaterThan(MIGRATION.indexOf("pg_advisory_xact_lock"));
    expect(maxAt).toBeGreaterThan(MIGRATION.indexOf("pg_advisory_xact_lock"));
    expect(MIGRATION).toMatch(/insert into entries[\s\S]{0,200}?values \(v_owner/);
  });

  it("refuses the runner as a merge source", () => {
    // admin_merge_owner moves the source's entries to the target and then
    // archives the source; with the runner as source the rule fires in the gap
    // and sees an empty entitlement. Closed at the source rather than by
    // teaching the counting to tolerate the transient — which only worked by
    // making an ordinary checkbox dangerous.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    const defining = files.filter((f) =>
      f.includes("create or replace function admin_merge_owner("),
    );
    expect(defining.length).toBeGreaterThan(0);
    const live = defining[defining.length - 1];
    const body = live.slice(
      live.indexOf("create or replace function admin_merge_owner("),
    );
    expect(body).toMatch(
      new RegExp(`p_source[\\s\\S]{0,300}?${FREE_ENTRY_OWNER_EMAIL.replace(".", "\\.")}`),
    );
    // ...and only as SOURCE. Merging a duplicate INTO the runner is the
    // direction that makes sense and must stay available.
    expect(body).not.toMatch(/p_target[\s\S]{0,120}?anthonydellapia@gmail\.com/);
  });

  it("watches every input to the entitlement, not just entries", () => {
    // FLOOR(recruited / ratio) held against the runner's row reads from
    // exactly three tables. A trigger on only `entries` let the other two
    // drift, both reproduced: creating the runner AFTER importing the roster
    // left 47 recruited with 0 free (only `owners` was written), and lowering
    // config.free_entry_ratio from 10 to 5 left 4 held against an entitlement
    // of 9. These three are the complete set of inputs, so there is no fourth
    // gap of this shape -- which is why this asserts on the whole set.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
      .join("\n");
    for (const table of ["entries", "owners", "config"]) {
      expect(
        files,
        `no statement trigger on ${table} runs mint_free_entries`,
      ).toMatch(
        new RegExp(
          `create trigger \\w+[\\s\\S]{0,200}?on ${table}\\b[\\s\\S]{0,120}?for each statement[\\s\\S]{0,120}?mint_free_entries`,
        ),
      );
    }
  });

  it("guards against re-entry, since its own insert re-fires it", () => {
    expect(MIGRATION).toContain("pg_trigger_depth()");
  });

  it("audits in the same transaction as the write", () => {
    expect(MIGRATION).toContain("insert into audit_log");
  });
});

describe("the two admin backends agree on what the roster is", () => {
  // The free-entry trigger's recruited count excludes entries whose owner is
  // archived. /admin computes its entitlement from listEntries(), so a backend
  // that includes them makes the screen disagree with the database and report
  // the rule as behind when it is not. That is a cross-backend contract no
  // runtime test in this suite can see — neither implementation is reachable
  // without its database — so it is guarded at the source, like the migration
  // constants above.
  it("both exclude entries whose owner is archived", () => {
    const localPg = readFileSync(
      join(process.cwd(), "src/lib/data/admin-localpg.ts"),
      "utf8",
    );
    const supabase = readFileSync(
      join(process.cwd(), "src/lib/data/admin-supabase.ts"),
      "utf8",
    );
    // local-PG joins the live owners directly.
    expect(localPg).toMatch(
      /from entries e join owners o on o\.id = e\.owner_id and o\.deleted_at is null/,
    );
    // Supabase fetches owners with `.is("deleted_at", null)` and must filter
    // entries against that set rather than returning every row.
    const listEntries = supabase.slice(
      supabase.indexOf("async listEntries()"),
      supabase.indexOf("async listEntrySummaries("),
    );
    expect(listEntries).toMatch(/\.is\("deleted_at", null\)/);
    expect(
      listEntries,
      "listEntries must drop entries whose owner is not in the live set",
    ).toMatch(/\.filter\(\(r: any\) => names\.has\(r\.owner_id\)\)/);
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
