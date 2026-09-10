// The checked-in operations config, loaded and checked once. Every schedule
// and parameter the jobs read comes from scripts/ops/config.json, so changing
// one is a reviewed change and never a pasted prompt. Set by Anthony on
// 2026-09-09.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { missedSlots, parseCron } from "./cron";

export const JOB_NAMES = ["sweep", "pick-reminder", "lynne-import", "chase", "results", "distribute"] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** The only jobs that may send mail, and only through scripts/lib/send.ts. */
export const SEND_JOBS: readonly JobName[] = ["pick-reminder", "chase"];

export interface JobConfig {
  /** 5-field cron, UTC. */
  schedule: string;
  /** The npm script the job runs. */
  command: string;
  args: string[];
  sends: boolean;
  template?: string;
  what: string;
}

export interface OpsConfig {
  timezone: string;
  tickWindowMinutes: number;
  /**
   * The cron the Routine that runs `npm run ops -- tick` fires on, UTC, the
   * same expression docs/ROUTINES.md section 10 records. Checked in because a
   * job schedule means nothing on its own: a slot between two ticks is never
   * observed, and the validator below refuses a config where one is.
   */
  tickSchedule: string;
  /**
   * The cron the "Survivor Daily" Routine fires on, UTC: `npm run ops --
   * daily`, the six reporters. Checked in for the same reason tickSchedule is
   * - a schedule that lives only in a Routine's UI is a setting nobody can
   * review, and docs/ROUTINES.md would drift from what actually runs.
   *
   * It is deliberately NOT compared against the jobs' schedules the way
   * tickSchedule is: the reporters have no slots of their own to lose. They
   * read the whole roster on every run and report what they find, so a daily
   * run misses nothing whenever it lands.
   */
  dailySchedule: string;
  expectedRosterAddresses: number;
  /**
   * The MINIMUM notice a reminder must give, in hours. Nothing reads this at
   * run time any more: the three-slot model (2026-09-10) sends on a slot's ET
   * date rather than a fixed lead before its deadline, so the instant a
   * reminder goes is the `pick-reminder` cron and nothing else.
   *
   * It is kept because it is now the reviewable FLOOR that cron is checked
   * against - tests/unit/ops.test.ts and tests/unit/remind-slots.test.ts
   * assert the Wednesday and Friday slots clear a 2:00 PM ET deadline by at
   * least this many hours, in EDT and in EST. Moving the cron later without
   * moving this number fails those tests, which is the point. Deleting it
   * would delete the only statement of how much warning a player is owed.
   */
  reminderLeadHours: number;
  sweepSubjectTerms: string[];
  jobs: Record<JobName, JobConfig>;
}

export const CONFIG_PATH = fileURLToPath(new URL("../config.json", import.meta.url));

function fail(msg: string): never {
  throw new Error(`scripts/ops/config.json: ${msg}`);
}

/**
 * Runs a cron check and reports its message through fail(), so a bad
 * expression is attributed to the file it came from like every other breach
 * here. `loadOpsConfig` is called at module scope by scripts/lib/constants.ts,
 * so this message is what a person sees when any command refuses to start.
 */
function checkCron<T>(what: string, f: () => T): T {
  try {
    return f();
  } catch (e: unknown) {
    fail(`${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Checks the shape and the rules a config must keep; throws on the first breach. */
export function validateOpsConfig(raw: unknown): OpsConfig {
  if (typeof raw !== "object" || raw === null) fail("not an object");
  const c = raw as Record<string, unknown>;
  if (typeof c.timezone !== "string" || !c.timezone) fail("timezone missing");
  if (!Number.isInteger(c.tickWindowMinutes) || (c.tickWindowMinutes as number) < 1 || (c.tickWindowMinutes as number) > 1440) fail("tickWindowMinutes must be 1-1440");
  if (typeof c.tickSchedule !== "string" || c.tickSchedule.trim().split(/\s+/).length !== 5) fail("tickSchedule must be 5 cron fields");
  checkCron("tickSchedule", () => parseCron(c.tickSchedule as string));
  if (typeof c.dailySchedule !== "string" || c.dailySchedule.trim().split(/\s+/).length !== 5) fail("dailySchedule must be 5 cron fields");
  checkCron("dailySchedule", () => parseCron(c.dailySchedule as string));
  // Once a day, not more: the reporters are for a person to read, and a
  // schedule naming several hours would send several identical reports.
  if (parseCron(c.dailySchedule as string).hour.size !== 1 || parseCron(c.dailySchedule as string).minute.size !== 1) {
    fail("dailySchedule must name one minute of one hour - the daily report is read by a person");
  }
  if (!Number.isInteger(c.expectedRosterAddresses) || (c.expectedRosterAddresses as number) < 1) fail("expectedRosterAddresses must be a positive integer");
  if (!Number.isInteger(c.reminderLeadHours) || (c.reminderLeadHours as number) < 1) fail("reminderLeadHours must be a positive integer");
  if (!Array.isArray(c.sweepSubjectTerms) || c.sweepSubjectTerms.length === 0 || !c.sweepSubjectTerms.every((t) => typeof t === "string" && t.trim())) fail("sweepSubjectTerms must be a non-empty list of words");
  if (typeof c.jobs !== "object" || c.jobs === null) fail("jobs missing");
  const jobs = c.jobs as Record<string, unknown>;
  for (const name of JOB_NAMES) if (!(name in jobs)) fail(`job ${name} missing`);
  for (const name of Object.keys(jobs)) if (!(JOB_NAMES as readonly string[]).includes(name)) fail(`unknown job ${name}`);
  for (const name of JOB_NAMES) {
    const j = jobs[name] as Record<string, unknown>;
    if (typeof j.schedule !== "string" || j.schedule.trim().split(/\s+/).length !== 5) fail(`${name}: schedule must be 5 cron fields`);
    checkCron(`${name}: schedule`, () => parseCron(j.schedule as string));
    if (typeof j.command !== "string" || !j.command) fail(`${name}: command missing`);
    if (!Array.isArray(j.args) || !j.args.every((a) => typeof a === "string")) fail(`${name}: args must be strings`);
    if (typeof j.sends !== "boolean") fail(`${name}: sends must be true or false`);
    if (typeof j.what !== "string" || !j.what) fail(`${name}: what missing`);
    const args = j.args as string[];
    // The allowlist, enforced twice: here on the config, and in send.ts on
    // the template. A job outside SEND_JOBS can neither be marked as sending
    // nor be handed --send.
    if (j.sends && !SEND_JOBS.includes(name)) fail(`${name}: sends is true but only ${SEND_JOBS.join(" and ")} may send`);
    if (!j.sends && args.includes("--send")) fail(`${name}: --send on a job that does not send`);
    if (j.sends && typeof j.template !== "string") fail(`${name}: a sending job names its template`);
  }
  return raw as OpsConfig;
}

/**
 * The jobs that would lose a run to the tick that observes them, named, or an
 * empty list when none would: either every slot a job names falls inside a
 * tick's look-back window, or it is due at every tick anyway (missedSlots
 * decides which). The pick-reminder's 10:00 UTC slot sat in the gap before
 * the first tick of the day, so the EDT early reminder would have gone four
 * hours late (issue #41).
 *
 * This is deliberately NOT part of validateOpsConfig. scripts/lib/constants.ts
 * calls loadOpsConfig() at module scope for EXPECTED_ROSTER_ADDRESSES, so
 * every command - the Week 1 picks intake included - dies at import on
 * anything the loader refuses. The shape of the file has to hold for all of
 * them; how a schedule lines up against the tick only matters to the tick, so
 * `npm run ops` is where it is checked and where it refuses.
 */
export function slotBreaches(c: OpsConfig): string[] {
  const out: string[] = [];
  for (const name of JOB_NAMES) {
    const missed = checkCron(`${name}: schedule`, () => missedSlots(c.jobs[name].schedule, c.tickSchedule, c.tickWindowMinutes));
    if (missed.length) out.push(`${name}: ${missed.join(", ")} falls outside every ${c.tickWindowMinutes}-minute tick window of "${c.tickSchedule}"`);
  }
  return out;
}

let cached: OpsConfig | null = null;

export function loadOpsConfig(): OpsConfig {
  if (cached) return cached;
  cached = validateOpsConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
  return cached;
}
