// The post-merge migration job opens a public issue with the log tail when
// it fails. The money totals are admin-only (CLAUDE.md), so the smoke check
// never prints them and the job withholds any line that carries one. Both
// are guarded here: the smoke SQL by reading it, the workflow script by
// lifting it out of the YAML and running it against a fake GitHub.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function scriptOf(yml: string): string {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => /^\s*script: \|\s*$/.test(l));
  if (start < 0) throw new Error("no script block");
  const indent = (lines[start + 1].match(/^\s*/) ?? [""])[0].length;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") {
      body.push("");
      continue;
    }
    if ((l.match(/^\s*/) ?? [""])[0].length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join("\n");
}

type Script = (github: unknown, context: unknown, core: unknown, require: unknown) => Promise<void>;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => Script;

async function issueBodyFor(log: string): Promise<string> {
  const fn = new AsyncFunction("github", "context", "core", "require", scriptOf(readFileSync(here("../../.github/workflows/migrate.yml"), "utf8")));
  let body = "";
  const github = { rest: { issues: { create: async (i: { body: string }) => { body = i.body; } } } };
  const context = { sha: "d234756fdb75b08f875d822b9c8e7d39f2be2519", serverUrl: "https://github.com", repo: { owner: "o", repo: "r" }, runId: 1 };
  const fakeRequire = (name: string) => {
    if (name !== "fs") throw new Error(`unexpected require ${name}`);
    return { readFileSync: () => log };
  };
  await fn(github, context, { info: () => undefined }, fakeRequire);
  return body;
}

describe("migration failure issue", () => {
  it("withholds any log line that carries a money figure", async () => {
    const body = await issueBodyFor("== applying x\nNOTICE: smoke: due 284000 cents, paid 183000 cents\npsql:<stdin>:9: ERROR: boom\n");
    expect(body).not.toContain("284000");
    expect(body).not.toContain("183000");
    expect(body).toContain("[line withheld: it carried a money figure]");
    expect(body).toContain("ERROR: boom");
  });
});

describe("smoke check", () => {
  it("never prints a money total in a notice or an exception", () => {
    const sql = readFileSync(here("../../scripts/db/smoke.sql"), "utf8");
    const raises = sql.match(/raise (notice|exception)[^;]*;/g) ?? [];
    expect(raises.length).toBeGreaterThan(0);
    // Only the booleans v_due_moved and v_paid_moved may reach a raise; the
    // totals themselves never do.
    for (const r of raises) expect(r).not.toMatch(/\bv_(due|paid)(_after)?\b/);
  });
});
