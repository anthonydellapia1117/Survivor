// Terminal prompts. Approval is an explicit "y" or "yes"; anything else,
// including Enter, is a no. A prompt whose stdin closes before it is
// answered is an error, never a silent exit: a Routine or a piped run that
// forgot --yes or the password variable finds out on the first line.

import readline from "node:readline";
import { Writable } from "node:stream";

const NO_ANSWER =
  "No answer: stdin closed before the prompt was answered. For a non-interactive run pass --yes and set the password in the environment.";

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve, reject) => {
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
    rl.on("close", () => {
      if (!answered) reject(new Error(NO_ANSWER));
    });
  });
}

export async function confirm(question: string): Promise<boolean> {
  const a = (await ask(question)).toLowerCase();
  return a === "y" || a === "yes";
}

/** Ask without echoing the keystrokes. Needs a terminal. */
export function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(
      new Error(
        "A hidden prompt needs a terminal. Set SURVIVOR_ADMIN_PASSWORD in the environment for a non-interactive run.",
      ),
    );
  }
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
  return new Promise((resolve, reject) => {
    let answered = false;
    rl.question("", (answer) => {
      answered = true;
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    rl.on("close", () => {
      if (!answered) {
        process.stdout.write("\n");
        reject(new Error(NO_ANSWER));
      }
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
