// Terminal prompts. Approval is an explicit "y" or "yes"; anything else,
// including Enter, is a no. A prompt whose stdin closes before it is
// answered is an error, never a silent exit: a Routine or a piped run that
// forgot --yes or the password variable finds out on the first line.

import fs from "node:fs";
import readline from "node:readline";
import { Writable } from "node:stream";

const NO_ANSWER =
  "No answer: stdin closed before the prompt was answered. For a non-interactive run pass --yes and set the password in the environment.";
const NO_TERMINAL =
  "stdin was already read (pasted picks) and no terminal is available for the y/N prompt: run from a terminal, or use --file with the picks and answer on the keyboard.";

/** Set once readStdin() has drained stdin; a later prompt must read the terminal. */
let stdinConsumed = false;

/** The terminal device. SURVIVOR_TTY_PATH exists so a test can point at a path that cannot open. */
const TTY_PATH = process.env.SURVIVOR_TTY_PATH ?? "/dev/tty";

/**
 * Where a prompt reads from. Normally stdin; once readStdin() has drained
 * it (--paste), the terminal itself, so "y" can still be typed after the
 * pasted block. With no terminal (a container) the prompt is refused.
 */
function promptInput(): NodeJS.ReadableStream {
  if (!stdinConsumed) return process.stdin;
  return fs.createReadStream(TTY_PATH);
}

export function ask(question: string): Promise<string> {
  const input = promptInput();
  const rl = readline.createInterface({
    input,
    output: process.stdout,
  });
  return new Promise((resolve, reject) => {
    let answered = false;
    let failed = false;
    if (input !== process.stdin) {
      // readline re-emits the stream's error on itself; both need a handler
      // or an unopenable terminal is an uncaught exception, not a refusal.
      const onError = (e: Error) => {
        failed = true;
        rl.close();
        reject(new Error(`${NO_TERMINAL} (${e.message})`));
      };
      input.on("error", onError);
      rl.on("error", onError);
    }
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
    rl.on("close", () => {
      // The close that follows a stream error can land before the error
      // itself; give the error its turn so the message names the terminal.
      setImmediate(() => {
        if (!answered && !failed) reject(new Error(NO_ANSWER));
      });
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
  stdinConsumed = true;
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
