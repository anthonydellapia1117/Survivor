import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

// The prompts run in a child process: readline on the test runner's own
// stdin would hang or answer from the wrong stream.
function runPrompt(snippet: string, input: string) {
  const script = `import { ask, confirm, promptHidden } from "./scripts/lib/prompt"; (async () => { ${snippet} })().then((v) => { console.log("RESULT " + JSON.stringify(v)); }).catch((e) => { console.log("ERROR " + e.message); process.exit(2); });`;
  return spawnSync("npx", ["tsx", "-e", script], {
    cwd: path.resolve(__dirname, "../.."),
    input,
    encoding: "utf8",
    timeout: 60000,
  });
}

describe("prompts with a closed stdin", () => {
  it("confirm answers no on Enter and yes only on y or yes", () => {
    expect(runPrompt("return await confirm('go? ')", "\n").stdout).toContain("RESULT false");
    expect(runPrompt("return await confirm('go? ')", "y\n").stdout).toContain("RESULT true");
    expect(runPrompt("return await confirm('go? ')", "YES\n").stdout).toContain("RESULT true");
    expect(runPrompt("return await confirm('go? ')", "sure\n").stdout).toContain("RESULT false");
  });

  it("ask rejects instead of hanging or resolving when stdin closes unanswered", () => {
    const r = runPrompt("return await ask('name? ')", "");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("ERROR No answer: stdin closed");
  });

  it("promptHidden rejects without a terminal, naming the password variable", () => {
    const r = runPrompt("return await promptHidden('password: ')", "secret\n");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("SURVIVOR_ADMIN_PASSWORD");
  });
});

describe("a prompt after readStdin", () => {
  it("does not read the drained stdin; it asks the terminal, and says so when there is none", () => {
    // SURVIVOR_TTY_PATH points the terminal read at a path that cannot open,
    // the same shape as a container with no terminal, so on any machine the
    // prompt must refuse with the terminal message rather than resolve "no"
    // from the pasted text, block on the keyboard, or hang.
    const script = `import { confirm, readStdin } from "./scripts/lib/prompt"; (async () => { const t = await readStdin(); return [t.trim(), await confirm("go? ")]; })().then((v) => { console.log("RESULT " + JSON.stringify(v)); }).catch((e) => { console.log("ERROR " + e.message); process.exit(2); });`;
    const r = spawnSync("npx", ["tsx", "-e", script], {
      cwd: path.resolve(__dirname, "../.."),
      input: "Pumpy321 Eagles\ny\n",
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, SURVIVOR_TTY_PATH: "/nonexistent/survivor-tty" },
    });
    expect(r.stdout).not.toContain("RESULT");
    expect(r.stdout).toContain("ERROR");
    expect(r.stdout).toContain("terminal");
  });
});
