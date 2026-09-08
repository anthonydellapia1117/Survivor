// Argument parsing shared by the commands: a flag that takes a value must
// have one, and a week must be a week. A missing value used to fall through
// silently (--file with no path scanned Gmail; --week with no number became
// NaN), which is how a command does something other than what was typed.

export function takeValue(argv: string[], i: number, flag: string): string {
  const v = argv[i];
  if (v === undefined || v.startsWith("--")) {
    throw new Error(`${flag} needs a value.`);
  }
  return v;
}

export function weekArg(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 18) {
    throw new Error(`--week must be a whole number from 1 to 18, not "${raw}".`);
  }
  return n;
}
