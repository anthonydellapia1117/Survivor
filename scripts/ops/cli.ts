// npm run ops -- <job> [--dry-run]        run one job now
// npm run ops -- hourly [--dry-run]       every job whose schedule fell in the last window
// npm run ops -- tick [--dry-run]         the old name for hourly, still accepted
// npm run ops -- daily                    the six reporters, once a day
//
// TWO ENTRY POINTS, and the split is about what is hour-sensitive. `hourly`
// carries the picks intake (a reply at 1:15 has to be recorded before a 2:00
// deadline) and the two boundary-tied sending jobs. `daily` carries the six
// reporters that replaced the claude.ai Routines of docs/ROUTINES.md sections
// 3-7: reporting is not hour-sensitive, and running it once a day is the
// difference between a report someone reads and twenty-four nobody does.
//
// Operations for the Survivor sub-pool, from the repo, driven by
// scripts/ops/config.json (Anthony, 2026-09-09). One entry point per job:
// sweep, pick-reminder, lynne-import, chase, results, distribute. Each job
// runs the existing command with the arguments the config gives it, so the
// same code path a hand run takes is what the schedule takes; every write
// stays an audited RPC as the admin, every recipient list is derived on the
// run, and every count gate is exact.
//
// Sending: only the jobs config.json marks `sends` (pick-reminder and chase,
// checked at load) may carry --send, and even then the command itself sends
// only through scripts/lib/send.ts, only with REMINDER_AUTOSEND=true. When
// that switch is off this dispatcher does not start a sending job at all: it
// prints the one line the Routine reports.
//
// The claude.ai Routines that drive this are one line each: "Survivor Sweep"
// runs `npm run ops -- hourly`, "Survivor Daily" runs `npm run ops -- daily`,
// and both report the output. Nothing else. Two Routines, because those are
// the two cadences the work actually has.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adminClient, loadWeeks } from "../lib/db";
import { LYNNE_EMAIL } from "../lib/constants";
import { getAttachment, getMessageMeta, gmailClient, searchMessages, type MessageMeta } from "../lib/gmail";
import { finishedLine, needsAnthonyLine, notify } from "../lib/notify";
import { autosendEnabled } from "../lib/send";
import { footballAttachment, selectFootballMessage } from "../results/lib/select";
import { JOB_NAMES, loadOpsConfig, slotBreaches, type JobConfig, type JobName, jobSchedule} from "./lib/config";
import { tempSheetName } from "./lib/attachment";
import { dueInWindow, dueInWindowEt } from "./lib/cron";
import { latestLockedWeek } from "./lib/weeks";
import { REPORTERS, runDaily } from "./daily";

interface Args {
  target: JobName | "hourly" | "daily";
  dryRun: boolean;
}

/** `tick` is what `hourly` was called until 2026-09-10; the old name still runs. */
const TICK_ALIAS = "tick";

function parseArgs(argv: string[]): Args {
  let target: Args["target"] | null = null;
  let dryRun = false;
  for (const x of argv) {
    if (x === "--dry-run") dryRun = true;
    else if (x === TICK_ALIAS) target = "hourly";
    else if (x === "hourly" || x === "daily" || (JOB_NAMES as readonly string[]).includes(x)) target = x as Args["target"];
    else throw new Error(`Unknown argument ${x}. Jobs: ${JOB_NAMES.join(", ")}, or hourly, or daily.`);
  }
  if (!target) throw new Error(`Name a job (${JOB_NAMES.join(", ")}), or hourly, or daily.`);
  return { target, dryRun };
}

export interface JobOutcome {
  job: JobName;
  /**
   * "ran" with the command's exit code, "skipped" with the reason a due job
   * was deliberately not started, "failed" when it could not be started at
   * all, or "planned" on a dry run.
   *
   * "failed" is separate from "skipped" because they read opposite ways: a
   * skip is the tick working (nothing to do, autosend off), a failure is a
   * due job that never ran. Counting a sign-in or a Gmail outage as a skip
   * exited 0 and reported "ops finished" (issue #40).
   */
  kind: "ran" | "skipped" | "failed" | "planned";
  detail: string;
  exitCode?: number;
}

/** The arguments a job runs with, beyond the config's: the week for the post-lock jobs, the file for the roster load. */
async function extraArgs(job: JobName, dryRun: boolean): Promise<{ args: string[]; skip?: string }> {
  // A dry run prints what would run and reaches nothing: no database sign-in,
  // no Gmail. Deriving the real argument first meant --dry-run failed without
  // credentials instead of printing, and "starts nothing" was true only of the
  // child process (issue #40).
  if (dryRun) {
    if (job === "results" || job === "distribute") return { args: ["--week", "<latest locked week>"] };
    if (job === "lynne-import") return { args: ["--file", "<her newest Football xlsx>", "--message-id", "<its message id>"] };
    return { args: [] };
  }
  if (job === "results" || job === "distribute") {
    const { client } = await adminClient();
    const week = latestLockedWeek(await loadWeeks(client), new Date());
    if (week === null) return { args: [], skip: "no week has locked yet" };
    return { args: ["--week", String(week)] };
  }
  if (job === "lynne-import") {
    // Her newest Football xlsx, fetched once to a temp file for lynne:roster,
    // which refuses a sha256 it has loaded before.
    const gmail = gmailClient();
    const refs = await searchMessages(gmail, `from:${LYNNE_EMAIL} has:attachment filename:xlsx`, 50);
    const metas: MessageMeta[] = [];
    for (const r of refs) metas.push(await getMessageMeta(gmail, r.id));
    const selection = selectFootballMessage(metas);
    if (!selection) return { args: [], skip: `no message from the master pool's runner carries a Football .xlsx (${refs.length} checked)` };
    const attachment = footballAttachment(selection.message);
    if (!attachment) return { args: [], skip: "the newest message carries no Football .xlsx" };
    const buf = await getAttachment(gmail, selection.message.id, attachment.attachmentId);
    // The path is ours; her basename survives, sanitised, because
    // scripts/lynne/roster.ts records it as p_source_file (issue #40).
    const stem = tempSheetName(selection.message.id, attachment.filename);
    if (!stem) return { args: [], skip: `message id ${JSON.stringify(selection.message.id)} is not a usable file name` };
    const file = path.join(os.tmpdir(), stem);
    fs.writeFileSync(file, buf);
    console.log(`lynne-import: ${attachment.filename} (${buf.length} bytes) written to ${file}`);
    return { args: ["--file", file, "--message-id", selection.message.id] };
  }
  return { args: [] };
}

async function runJob(job: JobName, cfg: JobConfig, dryRun: boolean): Promise<JobOutcome> {
  if (cfg.sends && !autosendEnabled()) {
    return { job, kind: "skipped", detail: "REMINDER_AUTOSEND is not true: drafts only, nothing started" };
  }
  const extra = await extraArgs(job, dryRun);
  if (extra.skip) return { job, kind: "skipped", detail: extra.skip };
  const args = [...cfg.args, ...extra.args];
  const line = `npm run ${cfg.command} -- ${args.join(" ")}`.trim();
  if (dryRun) return { job, kind: "planned", detail: line };
  console.log(`\n==> ${job}: ${line}`);
  const res = spawnSync("npm", ["run", cfg.command, "--", ...args], { stdio: "inherit", env: process.env });
  const code = res.status ?? 1;
  return { job, kind: "ran", detail: line, exitCode: code };
}

/**
 * The six reporters against one read of the roster.
 *
 * Gmail is optional here and its absence is REPORTED rather than swallowed:
 * without it the sheet watch cannot see whether a newer sheet of hers is
 * waiting, and a run that quietly said nothing would read as "nothing is
 * waiting" (ops issue #40, the same shape).
 */
async function runDailyReport(now: Date, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(`daily at ${now.toISOString()}: would run ${REPORTERS.map((r) => r.name).join(", ")}. Nothing read, nothing written.`);
    return;
  }
  const { client } = await adminClient();
  let gmail: ReturnType<typeof gmailClient> | null = null;
  try {
    gmail = gmailClient();
  } catch (e: unknown) {
    console.log(`daily: Gmail is not configured for this run (${e instanceof Error ? e.message : String(e)}); the sheet watch will say so.`);
  }
  const result = await runDaily({ client, gmail, now });
  for (const line of result.lines) console.log(line);
  const summary = result.outcomes.map((o) => o.summary).join("; ");
  if (result.failed > 0) {
    await notify(needsAnthonyLine("ops daily", "a reporter failure", summary), { tags: "warning" });
    process.exitCode = 1;
    return;
  }
  if (result.needsAnthony > 0) {
    await notify(needsAnthonyLine("ops daily", "items to decide", summary), { tags: "warning" });
    return;
  }
  await notify(finishedLine("ops daily", summary));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadOpsConfig();
  // A schedule is only as good as the tick that observes it, and this is the
  // tick: refuse here rather than in the shared loader, which every command
  // imports (issue #41).
  const breaches = slotBreaches(config);
  if (breaches.length) throw new Error(`scripts/ops/config.json: a job would lose a run to the tick\n  ${breaches.join("\n  ")}`);
  const now = new Date();

  if (args.target === "daily") {
    await runDailyReport(now, args.dryRun);
    return;
  }

  const targets: JobName[] =
    args.target === "hourly"
      ? JOB_NAMES.filter((j) => {
          // Read against the clock the job was written on. An ET schedule is
          // converted on THIS run, so nothing has to be re-pinned in November.
          const { exprs, zone } = jobSchedule(config.jobs[j]);
          return exprs.some((expr) =>
            zone === "et"
              ? dueInWindowEt(expr, now, config.tickWindowMinutes)
              : dueInWindow(expr, now, config.tickWindowMinutes),
          );
        })
      : [args.target];

  if (args.target === "hourly") {
    console.log(`hourly at ${now.toISOString()}, window ${config.tickWindowMinutes} min: ${targets.length ? targets.join(", ") : "nothing due"}`);
    if (targets.length === 0) {
      await notify(finishedLine("ops", "hourly: nothing due"));
      return;
    }
  }

  const outcomes: JobOutcome[] = [];
  for (const job of targets) {
    try {
      outcomes.push(await runJob(job, config.jobs[job], args.dryRun));
    } catch (e: unknown) {
      const why = e instanceof Error ? e.message : String(e);
      outcomes.push({ job, kind: "failed", detail: `failed before starting: ${why}` });
    }
  }

  console.log("");
  let failed = 0;
  for (const o of outcomes) {
    const status = o.kind === "ran" ? (o.exitCode === 0 ? "ok" : `exit ${o.exitCode}`) : o.kind;
    console.log(`${o.job}: ${status} - ${o.detail}`);
    if (o.kind === "failed" || (o.kind === "ran" && o.exitCode !== 0)) failed += 1;
  }
  const summary = outcomes.map((o) => `${o.job} ${o.kind === "ran" ? (o.exitCode === 0 ? "ok" : "failed") : o.kind}`).join(", ");
  if (failed > 0) {
    await notify(needsAnthonyLine("ops", "job failure", `${failed} of ${outcomes.length} failed - ${summary} - output on the terminal`), { tags: "warning" });
    process.exitCode = 1;
    return;
  }
  await notify(finishedLine("ops", summary));
}

main().catch(async (e: unknown) => {
  const why = e instanceof Error ? e.message : String(e);
  console.error(why);
  process.exitCode = 1;
});
