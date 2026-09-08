// The codex-gate workflow is the merge gate, so its script is run here with
// a fake GitHub: the check it writes must refuse a lookalike summary comment
// from anyone but the Codex app, and must read every page of review threads.
// The script is lifted from the YAML as text (the block scalar under
// `script: |`), so the file under .github/workflows is the thing under test.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HEAD = "991201e372c97349ec93a51f0726ff3217605c66";
const SHORT = HEAD.slice(0, 7);
const MARKER = "<!-- codex-pull-request-review-summary -->";
const CODEX = { login: "chatgpt-codex-connector[bot]", type: "Bot" };

interface Comment {
  body: string;
  user: { login: string; type: string };
}
interface CheckCreate {
  conclusion: string;
  output: { title: string; summary: string };
}

function gateScript(): string {
  const path = fileURLToPath(new URL("../../.github/workflows/codex-gate.yml", import.meta.url));
  const lines = readFileSync(path, "utf8").split("\n");
  const start = lines.findIndex((l) => /^\s*script: \|\s*$/.test(l));
  if (start < 0) throw new Error("codex-gate.yml has no script block");
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

function summaryComment(row: string, user = CODEX): Comment {
  return { body: `${MARKER}\n\n| Review | Status | Commit | Review trigger |\n| --- | --- | --- | --- |\n${row}\n`, user };
}
const completedRow = (sha: string) => `| Code Review | **Completed** | \`${sha}\` | New commits |`;

type Script = (github: unknown, context: unknown, core: unknown) => Promise<void>;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => Script;

/** Run the gate; `pages` is each page of review threads as isResolved flags. */
async function runGate(comments: Comment[], pages: boolean[][]): Promise<CheckCreate> {
  const fn = new AsyncFunction("github", "context", "core", gateScript());
  let created: CheckCreate | null = null;
  const github = {
    rest: {
      pulls: { get: async () => ({ data: { state: "open", head: { sha: HEAD } } }) },
      issues: { listComments: () => undefined },
      checks: { create: async (c: CheckCreate) => { created = c; } },
    },
    paginate: async () => comments,
    graphql: async (_q: string, vars: { after: string | null }) => {
      const idx = vars.after === null || vars.after === undefined ? 0 : Number(vars.after);
      const page = pages[idx] ?? [];
      return {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: page.map((isResolved) => ({ isResolved })),
              pageInfo: { hasNextPage: idx < pages.length - 1, endCursor: String(idx + 1) },
            },
          },
        },
      };
    },
  };
  const context = { repo: { owner: "o", repo: "r" }, payload: { pull_request: { number: 19 } } };
  await fn(github, context, { info: () => undefined });
  if (!created) throw new Error("the gate wrote no check");
  return created;
}

describe("codex-gate", () => {
  it("names only the check it writes codex-gate, never its own job", () => {
    const path = fileURLToPath(new URL("../../.github/workflows/codex-gate.yml", import.meta.url));
    const yml = readFileSync(path, "utf8");
    const jobs = yml.slice(yml.indexOf("\njobs:"));
    // The job's check run and the written check come from the same app; if
    // both were "codex-gate", the job's success (completed last) would be
    // the one a ruleset requiring that name reads.
    expect(jobs).not.toMatch(/^\s+name: codex-gate\s*$/m);
    expect(jobs).toMatch(/name: "codex-gate"/);
  });
  it("passes only when the Codex bot concluded on the head and every thread is resolved", async () => {
    const c = await runGate([summaryComment(completedRow(SHORT))], [[true, true]]);
    expect(c.conclusion).toBe("success");
    expect(c.output.summary).toContain(`Codex completed on ${SHORT}`);
  });
  it("ignores a lookalike summary from any author but the Codex app", async () => {
    const c = await runGate([summaryComment(completedRow(SHORT), { login: "someone", type: "User" })], [[true]]);
    expect(c.conclusion).toBe("failure");
    expect(c.output.summary).toContain("no Codex summary comment yet");
  });
  it("does not take a Codex row for another commit as this one's", async () => {
    const c = await runGate([summaryComment(completedRow("0000000"))], [[true]]);
    expect(c.conclusion).toBe("failure");
    expect(c.output.summary).toContain(`Codex has not reviewed ${SHORT} yet`);
  });
  it("counts an unresolved thread on a later page", async () => {
    const c = await runGate([summaryComment(completedRow(SHORT))], [[true, true], [true, false]]);
    expect(c.conclusion).toBe("failure");
    expect(c.output.summary).toContain("Unresolved review threads: 1.");
  });
});
