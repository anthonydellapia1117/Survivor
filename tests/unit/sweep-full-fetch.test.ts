// EVERY MESSAGE IN FULL. Anthony, 2026-09-15: "Every thread fetched in full.
// Five picks were lost in Week 1 to a search preview cutting at five
// messages." That loss was by hand, through the claude.ai Gmail connector's
// search_threads preview (CLAUDE.md, Gmail); the code never read a preview.
// This holds it there: the sweep's readers fetch each message by id with
// format full and take the body from the message, never from a search
// result's snippet and never from a thread listing.
//
// Written so it FAILS if the sweep reader stops fetching in full: the
// function that walks the search results is extracted by name and its body
// has to reach messages.get with format "full", and no reader may touch a
// snippet or threads.list.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

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

const GMAIL = strip(readFileSync(path.join(ROOT, "scripts/lib/gmail.ts"), "utf8"));
const PICKS = walk(path.join(ROOT, "scripts/picks")).map((p) => ({ file: path.relative(ROOT, p), src: strip(readFileSync(p, "utf8")) }));

describe("the sweep reads bodies from messages.get format full", () => {
  it("the search walker fetches every kept message in full, by id, through the one full reader", () => {
    const walker = functionBody(GMAIL, "listSweepByQueries");
    // The candidates come from messages.list, ids only...
    expect(walker).toMatch(/gmail\.users\.messages\.list\(/);
    // ...their labels from a metadata get...
    expect(walker).toMatch(/messages\.get\(\{ userId: "me", id, format: "metadata" \}\)/);
    // ...and the body from the full reader, which asks for format full.
    expect(walker).toMatch(/await getMessageFull\(gmail, id\)/);
    const full = functionBody(GMAIL, "getMessageFull");
    expect(full).toMatch(/messages\.get\(\{ userId: "me", id, format: "full" \}\)/);
    expect(full).toMatch(/body: bodyOf\(res\.data\.payload\)/);
    // Both sweep readers go through the walker and nothing else.
    expect(functionBody(GMAIL, "listSweepFrom")).toMatch(/return listSweepByQueries\(/);
    expect(functionBody(GMAIL, "listSweepMatching")).toMatch(/return listSweepByQueries\(/);
  });

  it("the thread reader fetches the thread in full too", () => {
    expect(functionBody(GMAIL, "getThreadFull")).toMatch(/threads\.get\(\{ userId: "me", id: threadId, format: "full" \}\)/);
  });

  it("no reader takes a search snippet as a body, in gmail.ts or anywhere under scripts/picks", () => {
    expect(GMAIL).not.toMatch(/\.snippet\b/);
    for (const f of PICKS) expect(f.src, f.file).not.toMatch(/\bsnippet\b/);
  });

  it("threads.list is used by the subject lookup alone, and never by the picks commands", () => {
    // findThreadBySubject lists threads to find the one whose subject matches
    // exactly - and then reads its messages through threads.get. That is the
    // only listing of threads in the module.
    const lookups = GMAIL.match(/threads\.list\(/g) ?? [];
    expect(lookups).toHaveLength(1);
    expect(functionBody(GMAIL, "findThreadBySubject")).toMatch(/threads\.list\(/);
    for (const f of PICKS) expect(f.src, f.file).not.toMatch(/threads\.list/);
  });

  it("the picks commands read mail only through the full readers", () => {
    const cli = PICKS.find((f) => f.file === "scripts/picks/cli.ts")!.src;
    const self = PICKS.find((f) => f.file === "scripts/picks/self.ts")!.src;
    expect(cli).toMatch(/listSweepFrom\(gmail, addresses, skip\)/);
    expect(cli).toMatch(/getMessageFull\(gmail, id\)/);
    expect(self).toMatch(/listSweepMatching\(gmail, selfQuery\(\)/);
    for (const f of PICKS) expect(f.src, f.file).not.toMatch(/gmail\.users\.messages\.(list|get)\(/);
  });
});
