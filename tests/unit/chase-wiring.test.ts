// The chase command cannot be run against Gmail or the database in CI, so
// its wiring is guarded by reading the source: the one thing that must never
// drift is that nothing in scripts/chase can send except through
// sendAllowlisted, and that the send gate is checked before any sign-in.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const CLI = fs.readFileSync(path.join(ROOT, "scripts/chase/cli.ts"), "utf8");
const MESSAGE = fs.readFileSync(path.join(ROOT, "scripts/chase/lib/message.ts"), "utf8");

/** Source with comments removed, so a guard matches code and never the comment describing it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("chase wiring", () => {
  it("sends only through sendAllowlisted and never calls Gmail's send itself", () => {
    const c = code(CLI);
    expect(c).toContain("sendAllowlisted(");
    expect(c).not.toMatch(/messages\.send\b/);
    expect(c).not.toMatch(/\.send\(/);
    expect(c).toMatch(/template:\s*"pick_reminder"/);
  });

  it("checks the autosend gate before signing in anywhere", () => {
    const c = code(CLI);
    const gate = c.indexOf("autosendEnabled()");
    const signIn = c.indexOf("adminClient()");
    const gmail = c.indexOf("gmailClient()");
    expect(gate).toBeGreaterThan(-1);
    expect(signIn).toBeGreaterThan(gate);
    expect(gmail).toBeGreaterThan(gate);
  });

  it("refuses --send together with --bcc by throwing, not by logging", () => {
    expect(code(CLI)).toMatch(/args\.send\s*&&\s*args\.bcc[\s\S]{0,120}throw new Error\(/);
  });

  it("decides who is unpicked from the roster, not from Gmail", () => {
    const c = code(CLI);
    expect(c).toContain("unpickedEntries(");
    expect(c).not.toMatch(/listUnreadFrom|searchMessages|findThreadBySubject/);
  });

  it("pushes no address and no error text when a send fails", () => {
    const c = code(CLI);
    const m = c.match(/needsAnthonyLine\(\s*"chase",\s*"send failed",([^;]*)\)/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/\.email|\bwhy\b|\.message|String\(e\)/);
  });

  it("rebuilds every chase on a fresh clock immediately before each send", () => {
    const c = code(CLI);
    const loop = c.indexOf("for (const c of chases)");
    const send = c.indexOf("sendAllowlisted(", loop);
    expect(loop).toBeGreaterThan(-1);
    const between = c.slice(loop, send);
    expect(between).toMatch(/buildChase\([^;]*now:\s*new Date\(\)/);
    expect(c.slice(loop, c.indexOf("console.log(`\\nDone.", loop))).toMatch(/subject:\s*fresh\.subject/);
  });

  it("carries no em dash, en dash or emoji anywhere a human might read, comments included", () => {
    for (const src of [CLI, MESSAGE]) {
      expect(src).not.toMatch(/[–—]/);
      expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
