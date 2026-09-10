// The picks command cannot be run against Gmail or the database in CI, so
// one wiring rule is guarded by reading the source: the push notification
// for a staged row must never carry the row's reason or line, both of which
// can name a team, and a pick is not public before kickoff.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const CLI = fs.readFileSync(path.join(ROOT, "scripts/picks/cli.ts"), "utf8");

/** Source with comments removed, so a guard matches code and never the comment describing it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("picks wiring", () => {
  it("reads a pasted block's week from its unquoted text, the same way as a Gmail message", () => {
    const c = code(CLI);
    expect(c).not.toMatch(/weekNamedIn\(leadingLines\(text\)\)/);
    expect(c).toMatch(/weekFor\(weekOfMessage\("",\s*text\)\)/);
  });

  it("builds every push detail from a named helper, never from message content", () => {
    // The invariant is not "stagedDetail" by name - it is that no push is
    // built by interpolating anything from the message. stagedDetail carries
    // a week; ceilingDetail (2026-09-10) carries two integers. Both are
    // functions of numbers, which is what makes them safe before kickoff.
    const c = code(CLI);
    const calls = [...c.matchAll(/needsAnthonyLine\(([^;]*)\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      expect(args).toMatch(/(stagedDetail|ceilingDetail)\(/);
      expect(args).not.toMatch(/\.(reason|line|team|pick|text|candidates)\b/);
    }
  });
});
