// Terminal prompts. Approval is an explicit "y" or "yes"; anything else,
// including Enter, is a no.

import readline from "node:readline";
import { Writable } from "node:stream";

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function confirm(question: string): Promise<boolean> {
  const a = (await ask(question)).toLowerCase();
  return a === "y" || a === "yes";
}

/** Ask without echoing the keystrokes. */
export function promptHidden(question: string): Promise<string> {
  const muted = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });
  process.stdout.write(question);
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
