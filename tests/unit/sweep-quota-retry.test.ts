// THE SWEEP WAITS OUT GMAIL'S QUOTA INSTEAD OF DYING. Found 2026-09-15 on the
// first dry run of the read-state sweep: the subject read listed 190
// candidates in the fortnight - nearly all Anthony's own sent mail and
// Lynne's, dropped only after the fetch - and Gmail answered "Quota exceeded
// for quota metric 'Total Query Cost' and limit 'Units per minute per user'"
// part way through, so an hourly run 43 people's picks depend on read
// nothing. Two guards, each broken before trusted:
//   - withQuotaRetry waits 1, 2, 4, 8, 16, 32 seconds and tries again on a
//     quota error, six times, and throws anything else straight through;
//   - every read and file call the sweep makes goes through it, and the
//     admin mailbox and Lynne are excluded in the subject SEARCH, not only
//     after the fetch (25 candidates instead of 190).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isQuotaError, QUOTA_RETRY_DELAYS_MS, withQuotaRetry } from "../../scripts/lib/gmail";

const ROOT = path.join(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

/** The text of a top-level function, from its `function name(` to the matching close brace. */
function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`(?:export )?(?:async )?function ${name}\\b`));
  if (start < 0) throw new Error(`${name} not found`);
  let depth = 0;
  let seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") {
      depth++;
      seen = true;
    } else if (src[i] === "}") {
      depth--;
      if (seen && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${name}: unbalanced`);
}

const QUOTA = new Error(
  "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com' for consumer 'project_number:1'",
);

describe("withQuotaRetry", () => {
  it("recognises Gmail's quota error and nothing else", () => {
    expect(isQuotaError(QUOTA)).toBe(true);
    expect(isQuotaError(Object.assign(new Error("Too Many Requests"), { code: 429 }))).toBe(true);
    expect(isQuotaError(new Error("userRateLimitExceeded"))).toBe(true);
    expect(isQuotaError(new Error("Requested entity was not found."))).toBe(false);
    expect(isQuotaError(new Error("invalid_grant"))).toBe(false);
  });

  it("waits and tries again on a quota error, with the delays doubling", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const out = await withQuotaRetry(
      async () => {
        calls += 1;
        if (calls <= 2) throw QUOTA;
        return "ok";
      },
      async (ms) => {
        sleeps.push(ms);
      },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("throws any other error straight through, without a wait", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await expect(
      withQuotaRetry(
        async () => {
          calls += 1;
          throw new Error("Requested entity was not found.");
        },
        async (ms) => {
          sleeps.push(ms);
        },
      ),
    ).rejects.toThrow(/not found/);
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("gives up after the sixth wait and throws the quota error", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await expect(
      withQuotaRetry(
        async () => {
          calls += 1;
          throw QUOTA;
        },
        async (ms) => {
          sleeps.push(ms);
        },
      ),
    ).rejects.toThrow(/Quota exceeded/);
    expect(calls).toBe(QUOTA_RETRY_DELAYS_MS.length + 1);
    expect(sleeps).toEqual([...QUOTA_RETRY_DELAYS_MS]);
  });
});

describe("every sweep read and file call is under the retry", () => {
  const GMAIL = strip(readFileSync(path.join(ROOT, "scripts/lib/gmail.ts"), "utf8"));
  const CLI = strip(readFileSync(path.join(ROOT, "scripts/picks/cli.ts"), "utf8"));

  it("the search walker's list and metadata get, the full reader, and the filer", () => {
    const walker = functionBody(GMAIL, "listSweepByQueries");
    expect(walker).toMatch(/withQuotaRetry\(\(\) => gmail\.users\.messages\.list\(/);
    expect(walker).toMatch(/withQuotaRetry\(\(\) => gmail\.users\.messages\.get\(\{ userId: "me", id, format: "metadata" \}\)\)/);
    expect(functionBody(GMAIL, "getMessageFull")).toMatch(/withQuotaRetry\(\(\) => gmail\.users\.messages\.get\(\{ userId: "me", id, format: "full" \}\)\)/);
    expect(functionBody(GMAIL, "markProcessed")).toMatch(/withQuotaRetry\(\(\) =>\s*gmail\.users\.messages\.modify\(/);
  });

  it("the subject search itself excludes the admin mailbox and Lynne, not only the fetch", () => {
    // `excluded` is [ADMIN_MAILBOX, LYNNE_EMAIL, ...ops.sweepExcludeSenders]
    // (tests/unit/code-status-not-swept.test.ts pins that). The query has to
    // take the same list, or 190 of his own and her messages are fetched in
    // full every hour and dropped after.
    expect(CLI).toMatch(/subjectSweepQuery\(terms, excluded\)/);
    expect(CLI).not.toMatch(/subjectSweepQuery\(terms, ops\.sweepExcludeSenders\)/);
  });
});
