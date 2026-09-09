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
  /** "ran" with the command's exit code, "skipped" with the reason, or "planned" on a dry run. */
  kind: "ran" | "skipped" | "planned";
  detail: string;
  exitCode?: number;
}

/** The arguments a job runs with, beyond the config's: the week for the post-lock jobs, the file for the roster load. */
async function extraArgs(job: JobName, dryRun: boolean): Promise<{ args: string[]; skip?: string }> {
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
    if (dryRun) return { args: ["--file", `<${attachment.filename} from message ${selection.message.id}>`, "--message-id", selection.message.id] };
    const buf = await getAttachment(gmail, selection.message.id, attachment.attachmentId);
    const file = path.join(os.tmpdir(), `survivor-roster-${selection.message.id}-${attachment.filename}`);
    fs.writeFileSync(file, buf);
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
      outcomes.push({ job, kind: "skipped", detail: `failed before starting: ${why}` });
    }
  }

  console.log("");
  let failed = 0;
  for (const o of outcomes) {
    const status = o.kind === "ran" ? (o.exitCode === 0 ? "ok" : `exit ${o.exitCode}`) : o.kind;
    console.log(`${o.job}: ${status} - ${o.detail}`);
    if (o.kind === "ran" && o.exitCode !== 0) failed += 1;
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
