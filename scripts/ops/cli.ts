// npm run ops -- <job> [--dry-run]        run one job now
// npm run ops -- tick [--dry-run]         run every job whose schedule fell in the last window
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
// The claude.ai Routine that drives this is one line: run `npm run ops --
// tick` and report the output. Nothing else.

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
import { JOB_NAMES, loadOpsConfig, type JobConfig, type JobName } from "./lib/config";
import { dueInWindow } from "./lib/cron";
import { latestLockedWeek } from "./lib/weeks";

interface Args {
  target: JobName | "tick";
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let target: Args["target"] | null = null;
  let dryRun = false;
  for (const x of argv) {
    if (x === "--dry-run") dryRun = true;
    else if (x === "tick" || (JOB_NAMES as readonly string[]).includes(x)) target = x as Args["target"];
    else throw new Error(`Unknown argument ${x}. Jobs: ${JOB_NAMES.join(", ")}, or tick.`);
  }
  if (!target) throw new Error(`Name a job (${JOB_NAMES.join(", ")}) or tick.`);
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
    // The path is ours, never hers. Her filename is metadata on the message:
    // a slash in it targets a directory that does not exist and "../" lands
    // outside the temporary directory (issue #40). The message id, which
    // Gmail gives as hex, is the name, and it is sanitised anyway; her
    // filename travels only as the label on the log line below.
    const safeId = selection.message.id.replace(/[^A-Za-z0-9_-]/g, "");
    if (!safeId) return { args: [], skip: `message id ${JSON.stringify(selection.message.id)} is not a usable file name` };
    const file = path.join(os.tmpdir(), `survivor-roster-${safeId}.xlsx`);
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadOpsConfig();
  const now = new Date();

  const targets: JobName[] =
    args.target === "tick"
      ? JOB_NAMES.filter((j) => dueInWindow(config.jobs[j].schedule, now, config.tickWindowMinutes))
      : [args.target];

  if (args.target === "tick") {
    console.log(`tick at ${now.toISOString()}, window ${config.tickWindowMinutes} min: ${targets.length ? targets.join(", ") : "nothing due"}`);
    if (targets.length === 0) {
      await notify(finishedLine("ops", "tick: nothing due"));
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
