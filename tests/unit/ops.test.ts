import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXPECTED_ROSTER_ADDRESSES } from "../../scripts/lib/constants";
import { CONFIG_PATH, JOB_NAMES, loadOpsConfig, SEND_JOBS, slotBreaches, validateOpsConfig } from "../../scripts/ops/lib/config";
import { cronMatches, describeSlot, dueAtEveryTick, dueInWindow, missedSlots, parseCron, unobservedSlots } from "../../scripts/ops/lib/cron";
import { dueSlot } from "../../scripts/remind/lib/due";
import { tempSheetName } from "../../scripts/ops/lib/attachment";
import { latestLockedWeek } from "../../scripts/ops/lib/weeks";
import { draftedWeekOf, priorDraftFor } from "../../scripts/distribute/lib/drafted";

// Operations run from the repo, driven by scripts/ops/config.json. The config
// is the contract: which jobs exist, when they run, which may send. Every
// rule here is one Anthony set on 2026-09-09.

const raw = () => JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
const withJob = (name: string, patch: Record<string, unknown>) => {
  const c = raw();
  const jobs = c.jobs as Record<string, Record<string, unknown>>;
  jobs[name] = { ...jobs[name], ...patch };
  return c;
};

describe("the ops config", () => {
  it("loads, names the six jobs and nothing else, and every command is an npm script", () => {
    const c = loadOpsConfig();
    expect(Object.keys(c.jobs).sort()).toEqual([...JOB_NAMES].sort());
    const scripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
    for (const j of JOB_NAMES) {
      expect({ job: j, script: c.jobs[j].command, known: c.jobs[j].command in scripts }).toEqual({ job: j, script: c.jobs[j].command, known: true });
      expect(() => parseCron(c.jobs[j].schedule)).not.toThrow();
    }
    expect("ops" in scripts).toBe(true);
  });

  it("lets exactly pick-reminder and chase send, and refuses --send anywhere else", () => {
    const c = loadOpsConfig();
    expect([...SEND_JOBS].sort()).toEqual(["chase", "pick-reminder"]);
    for (const j of JOB_NAMES) {
      expect({ job: j, sends: c.jobs[j].sends }).toEqual({ job: j, sends: SEND_JOBS.includes(j) });
      expect({ job: j, sendFlag: c.jobs[j].args.includes("--send") }).toEqual({ job: j, sendFlag: SEND_JOBS.includes(j) });
    }
    expect(c.jobs["pick-reminder"].template).toBe("week_reminder");
    expect(c.jobs.chase.template).toBe("pick_reminder");
    // The loader refuses a config that widens the allowlist, either way round.
    expect(() => validateOpsConfig(withJob("sweep", { sends: true, template: "x" }))).toThrow(/only pick-reminder and chase may send/);
    expect(() => validateOpsConfig(withJob("distribute", { args: ["--yes", "--send"] }))).toThrow(/--send on a job that does not send/);
    expect(() => validateOpsConfig(withJob("chase", { template: undefined }))).toThrow(/names its template/);
  });

  it("refuses an unknown job, a missing job and a malformed schedule", () => {
    const extra = raw();
    (extra.jobs as Record<string, unknown>).mystery = { schedule: "* * * * *", command: "picks", args: [], sends: false, what: "?" };
    expect(() => validateOpsConfig(extra)).toThrow(/unknown job mystery/);
    const missing = raw();
    delete (missing.jobs as Record<string, unknown>).results;
    expect(() => validateOpsConfig(missing)).toThrow(/job results missing/);
    expect(() => validateOpsConfig(withJob("sweep", { schedule: "43 * * *" }))).toThrow(/5 cron fields/);
  });

  it("carries the exact roster count the whole-roster messages gate on", () => {
    expect(loadOpsConfig().expectedRosterAddresses).toBe(40);
    expect(EXPECTED_ROSTER_ADDRESSES).toBe(40);
    expect(loadOpsConfig().reminderLeadHours).toBe(6);
    expect(loadOpsConfig().sweepSubjectTerms).toEqual(["survivor", "picks"]);
  });
});

describe("the cron matcher", () => {
  it("reads lists, ranges and steps", () => {
    const c = parseCron("0 10,11,12 * * 3,5");
    expect([...c.hour]).toEqual([10, 11, 12]);
    expect([...c.dow]).toEqual([3, 5]);
    expect([...parseCron("*/15 11-23,0-2 * * *").minute]).toEqual([0, 15, 30, 45]);
    expect([...parseCron("43 11-23,0-2 * * *").hour]).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2]);
    expect(() => parseCron("60 * * * *")).toThrow(/outside/);
    expect(() => parseCron("* * * *")).toThrow(/5 fields/);
  });

  it("matches a minute in UTC by every field", () => {
    // 2026-09-11 is a Friday.
    expect(cronMatches("0 10,11,12 * * 3,5", new Date("2026-09-11T10:00:00Z"))).toBe(true);
    expect(cronMatches("0 10,11,12 * * 3,5", new Date("2026-09-11T10:01:00Z"))).toBe(false);
    expect(cronMatches("0 10,11,12 * * 3,5", new Date("2026-09-10T10:00:00Z"))).toBe(false); // Thursday
    expect(cronMatches("43 * * * *", new Date("2026-09-09T15:43:20Z"))).toBe(true);
    expect(cronMatches("43 * * * *", new Date("2026-09-09T15:44:00Z"))).toBe(false);
  });

  it("calls a schedule due when it fell inside the window, not only on the exact minute", () => {
    const reminder = "0 10,11,12 * * 3,5";
    // The hourly tick at :43 on a Friday sees the 10:00 slot 43 minutes back.
    expect(dueInWindow(reminder, new Date("2026-09-11T10:43:00Z"), 60)).toBe(true);
    // A window of one minute is the exact-minute check.
    expect(dueInWindow(reminder, new Date("2026-09-11T10:43:00Z"), 1)).toBe(false);
    // Just before the slot, nothing is due.
    expect(dueInWindow(reminder, new Date("2026-09-11T09:59:00Z"), 60)).toBe(false);
    // Thursday: never.
    expect(dueInWindow(reminder, new Date("2026-09-10T10:43:00Z"), 60)).toBe(false);
  });

  it("puts the reminder on the Wednesday, Thursday and Friday mornings and no other day", () => {
    // Anthony's three slots, set 2026-09-10: one message each morning, the
    // Friday one the final call. The cron is the minute they go; which slot a
    // run belongs to is the ET calendar (scripts/remind/lib/due.ts).
    const { schedule } = loadOpsConfig().jobs["pick-reminder"];
    expect(dueInWindow(schedule, new Date("2026-09-09T12:43:00Z"), 60)).toBe(true); // Wednesday
    expect(dueInWindow(schedule, new Date("2026-09-10T12:43:00Z"), 60)).toBe(true); // Thursday
    expect(dueInWindow(schedule, new Date("2026-09-11T12:43:00Z"), 60)).toBe(true); // Friday
    expect(dueInWindow(schedule, new Date("2026-09-08T12:43:00Z"), 60)).toBe(false); // Tuesday
    expect(dueInWindow(schedule, new Date("2026-09-12T12:43:00Z"), 60)).toBe(false); // Saturday
    expect(dueInWindow(schedule, new Date("2026-09-14T12:43:00Z"), 60)).toBe(false); // Monday
  });
});

describe("the post-lock week", () => {
  const weeks = [
    { week: 1, early_deadline_at: "2026-09-09T18:00:00Z", late_deadline_at: "2026-09-11T18:00:00Z" },
    { week: 2, early_deadline_at: "2026-09-16T16:00:00Z", late_deadline_at: "2026-09-18T16:00:00Z" },
  ];
  it("is the most recent week whose late deadline has passed, and null before Week 1 locks", () => {
    expect(latestLockedWeek(weeks, new Date("2026-09-11T17:59:00Z"))).toBeNull();
    expect(latestLockedWeek(weeks, new Date("2026-09-11T18:00:00Z"))).toBe(1);
    expect(latestLockedWeek(weeks, new Date("2026-09-17T12:00:00Z"))).toBe(1);
    expect(latestLockedWeek(weeks, new Date("2026-09-18T16:00:00Z"))).toBe(2);
  });
});

describe("the wiring the dispatcher and the commands keep", () => {
  const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  it("does not start a sending job while REMINDER_AUTOSEND is off, and only ever spawns npm scripts", () => {
    const src = code("scripts/ops/cli.ts");
    // The exact guard line, so a short-circuited `if (false && ...)` cannot
    // pass on the substring: the first proof of this guard did exactly that.
    expect(src).toMatch(/\n  if \(cfg\.sends && !autosendEnabled\(\)\) \{\n/);
    expect(src).toMatch(/spawnSync\("npm", \["run", cfg\.command, "--"/);
    expect(src).not.toMatch(/messages\.send/);
  });
  it("sweep can run unattended (--yes) and reads strangers by subject as well as players by address", () => {
    const src = code("scripts/picks/cli.ts");
    expect(src).toMatch(/args\.yes \|\| \(await confirm\(/);
    expect(src).toMatch(/x === "--yes"/);
    expect(src).toMatch(/listUnreadFrom\(gmail, addresses\)/);
    expect(src).toMatch(/strangerMessages\(await listUnreadMatching\(gmail, subjectSweepQuery\(terms\)\), addresses, \[ADMIN_MAILBOX, LYNNE_EMAIL\], terms\)/);
  });
  it("distribute keeps the same exact count gate as the reminder", () => {
    const src = code("scripts/distribute/cli.ts");
    expect(src).toMatch(/countGate\(EXPECTED_ROSTER_ADDRESSES, list\.addresses\)/);
    expect(src).toMatch(/throw new Error\(`Count gate:/);
  });
});

describe("the tick that observes the schedules", () => {
  const TICK = "43 9-23,0-2 * * *";

  it("is checked in beside the jobs, because a schedule means nothing without it", () => {
    const c = loadOpsConfig();
    expect(c.tickSchedule).toBe(TICK);
    expect(() => parseCron(c.tickSchedule)).not.toThrow();
    expect(() => validateOpsConfig({ ...raw(), tickSchedule: "43 9-23" })).toThrow(/tickSchedule must be 5 cron fields/);
  });

  it("is the same cron docs/ROUTINES.md records, job for job", () => {
    // The doc is a copy for reading and the config is the source, so they
    // drift silently unless something holds them together (issue #41).
    const c = loadOpsConfig();
    const doc = readFileSync("docs/ROUTINES.md", "utf8");
    expect(doc).toMatch(new RegExp(`Cron stored \\(UTC\\): \`${c.tickSchedule.replace(/\*/g, "\\*")}\``));
    for (const j of JOB_NAMES) {
      const row = new RegExp(`\\|\\s${j}\\s*\\|\\s*\`${c.jobs[j].schedule.replace(/\*/g, "\\*")}\``);
      expect({ job: j, inDoc: row.test(doc) }).toEqual({ job: j, inDoc: true });
    }
  });

  it("names the slot a job would lose, which is how the 10:00 UTC reminder was found", () => {
    // The Routine used to start at 11:43 UTC, so the 60-minute window reached
    // back only to 10:44 and the reminder's 10:00 slot never ran. In EDT a
    // noon-ET deadline is 16:00 UTC and six hours before it is exactly 10:00
    // (issue #41).
    expect(missedSlots("0 10,11,12 * * 3,5", "43 11-23,0-2 * * *", 60)).toEqual(["Wed 10:00 UTC", "Fri 10:00 UTC"]);
    // Starting an hour and a half earlier covers it.
    expect(missedSlots("0 10,11,12 * * 3,5", TICK, 60)).toEqual([]);
    expect(describeSlot(3 * 1440 + 10 * 60)).toBe("Wed 10:00 UTC");
  });

  it("counts a job due at every tick as losing nothing, which is what the hourly sweep is", () => {
    // The sweep names every hour on purpose. The hours the Routine sleeps
    // through are not lost runs, so the rule is "loses no run", not "every
    // slot is observed" - which the raw check would fail it on.
    expect(dueAtEveryTick("43 * * * *", TICK, 60)).toBe(true);
    expect(missedSlots("43 * * * *", TICK, 60)).toEqual([]);
    expect(unobservedSlots("43 * * * *", TICK, 60).length).toBe(42);
    expect(dueAtEveryTick("0 10,11,12 * * 3,5", TICK, 60)).toBe(false);
  });

  it("loses nothing on any job as the config stands, and refuses a config that would", () => {
    const c = loadOpsConfig();
    for (const j of JOB_NAMES) {
      expect({ job: j, missed: missedSlots(c.jobs[j].schedule, c.tickSchedule, c.tickWindowMinutes) }).toEqual({ job: j, missed: [] });
    }
    // A schedule an hour before the first tick of the day is named.
    expect(slotBreaches(validateOpsConfig(withJob("distribute", { schedule: "20 8 * * 5" })))).toEqual([
      expect.stringMatching(/^distribute: Fri 08:20 UTC falls outside/),
    ]);
    // So is a tick that stops observing a schedule that used to be fine: a
    // Routine starting at 13:43 UTC would never see the three morning slots.
    expect(slotBreaches(validateOpsConfig({ ...raw(), tickSchedule: "43 13-23,0-2 * * *" }))).toEqual([
      expect.stringMatching(/^pick-reminder: Wed 12:00 UTC, Thu 12:00 UTC, Fri 12:00 UTC falls outside/),
    ]);
  });

  it("is checked by the tick and NOT by the shared loader, so a bad schedule cannot stop the picks intake", () => {
    // scripts/lib/constants.ts calls loadOpsConfig() at module scope for
    // EXPECTED_ROSTER_ADDRESSES, and picks, chase, remind, distribute, lynne
    // and results all import it. If the loader refused a job/tick mismatch,
    // one bad cron would kill the Week 1 mail intake, not just the tick.
    const bad = withJob("distribute", { schedule: "20 8 * * 5" });
    expect(() => validateOpsConfig(bad)).not.toThrow();
    expect(slotBreaches(validateOpsConfig(bad)).length).toBe(1);
    // The dispatcher is where it refuses, and it names the job.
    const cli = readFileSync("scripts/ops/cli.ts", "utf8");
    expect(cli).toMatch(/const breaches = slotBreaches\(config\);/);
    expect(cli).toMatch(/if \(breaches\.length\) throw new Error\(/);
    expect(readFileSync("scripts/ops/lib/config.ts", "utf8")).not.toMatch(/missedSlots\([^)]*\)[\s\S]{0,80}?fail\(/);
  });

  it("keeps the reminder's cron and the schedule it fires in step, so neither can silently stop the mail", () => {
    // The cron is the minute the mail goes; the slot a run belongs to is the
    // ET calendar day. If they disagree - a cron on a day that names no slot,
    // or a slot on a day the cron never fires - the run finds nothing due and
    // says so quietly, which is the silent failure #41 was about. So: the
    // cron's days and the slots' days are the same three, and at the tick
    // that follows each firing the right slot is due.
    const c = loadOpsConfig();
    const cron = c.jobs["pick-reminder"].schedule;
    expect([...parseCron(cron).dow].sort((a, b) => a - b)).toEqual([3, 4, 5]);
    const weeks = [{ week: 1, early_deadline_at: "2026-09-09T18:00:00Z", late_deadline_at: "2026-09-11T18:00:00Z" }];
    const fired = ["2026-09-09T12:43:00Z", "2026-09-10T12:43:00Z", "2026-09-11T12:43:00Z"].map((t) =>
      dueInWindow(cron, new Date(t), c.tickWindowMinutes) ? (dueSlot(weeks, new Date(t))?.slot ?? null) : null,
    );
    expect(fired).toEqual(["wed", "thu", "fri"]);
    // The lead is no longer the trigger, so what holds it honest is the notice
    // the two same-day slots give: wed names that Wednesday's early deadline
    // and fri names that Friday's late one, and the cron must be at least
    // reminderLeadHours before a 2 PM ET deadline in EDT (18:00Z) and EST
    // (19:00Z). Moving the cron later, or the lead higher, fails here.
    const [hour] = [...parseCron(cron).hour];
    expect(18 - hour).toBeGreaterThanOrEqual(c.reminderLeadHours);
    expect(19 - hour).toBeGreaterThanOrEqual(c.reminderLeadHours);
  });

  it("attributes a bad cron to the file it came from, like every other breach", () => {
    // loadOpsConfig() runs at module scope in scripts/lib/constants.ts, so
    // this message is what a person sees when any command refuses to start.
    // A cron that is five fields but not readable used to escape the wrapper.
    expect(() => validateOpsConfig(withJob("sweep", { schedule: "43 9-23,0-2 * * ?" }))).toThrow(
      /^scripts\/ops\/config\.json: sweep: schedule: cron day-of-week/,
    );
    expect(() => validateOpsConfig({ ...raw(), tickSchedule: "43 9-23,0-2 * * ?" })).toThrow(
      /^scripts\/ops\/config\.json: tickSchedule: cron day-of-week/,
    );
    // The slot comparison's own refusals are attributed too, where it now
    // lives: on the tick's side, not in the loader every command imports.
    expect(() => slotBreaches(validateOpsConfig(withJob("chase", { schedule: "5 13 1 * *" })))).toThrow(
      /^scripts\/ops\/config\.json: chase: schedule: cron job: day-of-month and month/,
    );
  });

  it("refuses to compare schedules that restrict day-of-month or month, rather than guessing", () => {
    expect(() => missedSlots("0 12 1 * *", TICK, 60)).toThrow(/day-of-month and month must both be \*/);
    expect(() => unobservedSlots("0 12 * * 1", "0 12 * 6 *", 60)).toThrow(/day-of-month and month must both be \*/);
    expect(() => unobservedSlots("0 12 * * 1", TICK, 0)).toThrow(/windowMinutes must be a positive integer/);
  });
});

describe("the tick's report", () => {
  const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("calls a job that could not be started failed, not skipped, and counts it as a failure", () => {
    // extraArgs signs in for results and distribute and reaches Gmail for
    // lynne-import. A throw there used to be reported as "skipped" and the
    // tick exited 0 saying "ops finished" with a due job never run (issue #40).
    const src = code("scripts/ops/cli.ts");
    expect(src).toMatch(/kind: "ran" \| "skipped" \| "failed" \| "planned"/);
    expect(src).toMatch(/outcomes\.push\(\{ job, kind: "failed", detail: `failed before starting: \$\{why\}` \}\)/);
    expect(src).toMatch(/if \(o\.kind === "failed" \|\| \(o\.kind === "ran" && o\.exitCode !== 0\)\) failed \+= 1;/);
    expect(src).not.toMatch(/kind: "skipped", detail: `failed before starting/);
  });

  it("makes no external call on a dry run: it prints a placeholder for the derived argument", () => {
    // A dry run used to read the weeks table and fetch her sheet before
    // printing, so it failed without credentials instead of printing (#40).
    const src = code("scripts/ops/cli.ts");
    const dry = /if \(dryRun\) \{[\s\S]*?\n  \}/.exec(src)?.[0] ?? "";
    expect(dry).toMatch(/latest locked week/);
    expect(dry).toMatch(/her newest Football xlsx/);
    expect(dry).not.toMatch(/await/);
    // The guard comes before anything that reaches out.
    expect(src.indexOf("if (dryRun) {")).toBeLessThan(src.indexOf("await adminClient()"));
    expect(src.indexOf("if (dryRun) {")).toBeLessThan(src.indexOf("gmailClient()"));
  });

  it("writes her attachment under a name it generates, keeping her filename as a sanitised basename", () => {
    // The filename is metadata on the message: a slash targets a directory
    // that does not exist and "../" lands outside the temp directory (#40).
    // But scripts/lynne/roster.ts records path.basename(--file) as
    // p_source_file on every lynne_roster row, so dropping her name puts a
    // generated temp name in the database where her sheet's name belongs.
    expect(tempSheetName("19abc0de", "Football 2026-4.xlsx")).toBe("survivor-roster-19abc0de-Football 2026-4.xlsx");
    // Traversal and separators cannot escape the temp directory or name one.
    for (const hostile of ["../../etc/passwd", "a/b/Football.xlsx", "..\\..\\x.xlsx", "..", ".", "", "Foot;rm -rf.xlsx"]) {
      const n = tempSheetName("19abc0de", hostile);
      expect({ hostile, name: n }).toEqual({ hostile, name: expect.stringMatching(/^survivor-roster-19abc0de[-.]/) });
      expect({ hostile, escapes: n!.includes("/") || n!.includes("\\") || n!.includes("..") }).toEqual({ hostile, escapes: false });
      expect(join("/tmp", n!).startsWith("/tmp/survivor-roster-")).toBe(true);
    }
    // A message id with nothing usable in it names no file at all.
    expect(tempSheetName("///", "Football.xlsx")).toBeNull();
    // And the dispatcher uses it rather than building a path of its own.
    const src = code("scripts/ops/cli.ts");
    expect(src).toMatch(/const stem = tempSheetName\(selection\.message\.id, attachment\.filename\);/);
    expect(src).toMatch(/path\.join\(os\.tmpdir\(\), stem\)/);
    expect(src).not.toMatch(/tmpdir\(\)[^)]*attachment\.filename/);
  });

  it("keeps distribute to one draft a week, recorded in audit_log and read back before the next", () => {
    // Two ticks in one window - or a hand run beside a scheduled one - left
    // two whole-roster Bcc drafts in Gmail (issue #40).
    expect(code("scripts/distribute/lib/drafted.ts")).toMatch(/const DRAFTED_ACTION = "distribute_drafted";/);
    const src = code("scripts/distribute/cli.ts");
    expect(src).toMatch(/loadAuditByAction\(client, DRAFTED_ACTION\)/);
    expect(src).toMatch(/Already drafted for week \$\{week\}/);
    // The block has to END THE RUN. Every other assertion here holds with the
    // return deleted, and so does the whole suite, so the guard has to pin the
    // shape of the block and not just its contents.
    expect(src).toMatch(/if \(prior && !dryRun && !again\) \{[\s\S]{0,400}?\n    return;\n  \}/);
    expect(src).toMatch(/action: DRAFTED_ACTION/);
    // The week is CLAIMED before the Gmail call and recorded after it, the
    // way scripts/lib/send.ts claims a send. Recording only afterwards left a
    // draft with no row whenever the insert failed - a transient database
    // error, not only a crash - and the next run drafted the roster again.
    expect(code("scripts/distribute/lib/drafted.ts")).toMatch(/const DRAFT_CLAIM_ACTION = "distribute_draft_claim";/);
    expect(src).toMatch(/loadAuditByAction\(client, DRAFT_CLAIM_ACTION\)/);
    expect(src.indexOf("loadAuditByAction(client, DRAFT_CLAIM_ACTION)")).toBeLessThan(src.indexOf("createDraft("));
    expect(src.indexOf("action: DRAFT_CLAIM_ACTION")).toBeLessThan(src.indexOf("createDraft("));
    expect(src.indexOf("createDraft(")).toBeLessThan(src.indexOf("action: DRAFTED_ACTION"));
    // A claim on its own counts, so an unknown outcome never drafts twice.
    expect(src).toMatch(/priorDraftFor\(\[\.\.\.drafted, \.\.\.claims\], week\)/);
  });

  it("does not block the preview or a deliberate redraft: --dry-run creates nothing and --again is the escape hatch", () => {
    // The guard is against a second tick, not against Anthony. Blocking
    // --dry-run made a documented read-only preview unavailable for the rest
    // of the week, and with an append-only audit ledger there was no way back
    // once a week's row existed - he deletes a draft in Gmail and cannot redo it.
    const src = code("scripts/distribute/cli.ts");
    expect(src).toMatch(/if \(prior && !dryRun && !again\) \{/);
    expect(src).toMatch(/x === "--again"/);
    expect(src).toMatch(/Pass --again to draft it again/);
    // A redraft still records its own row, so the next tick sees it.
    expect(src.indexOf("if (prior && !dryRun && !again)")).toBeLessThan(src.indexOf("action: DRAFTED_ACTION"));
  });
});

describe("the week a distribute draft was recorded for", () => {
  it("is read from the audit row, and a row that names none matches no week", () => {
    expect(draftedWeekOf({ after: { week: 3, draft_id: "d1" } })).toBe(3);
    expect(draftedWeekOf({ after: { week: "3" } })).toBeNull();
    expect(draftedWeekOf({ after: { week: 1.5 } })).toBeNull();
    expect(draftedWeekOf({ after: {} })).toBeNull();
    expect(draftedWeekOf({ after: null })).toBeNull();
    const rows = [{ after: { week: 1 } }, { after: { week: 2 } }, { after: null }];
    expect(priorDraftFor(rows, 2)).toBe(rows[1]);
    // A claim row alone matches: an attempted draft whose outcome is unknown
    // must still stop the next run, exactly as a completed one does.
    expect(priorDraftFor([{ after: { week: 5, recipient_count: 39 } }], 5)).not.toBeNull();
    expect(priorDraftFor(rows, 3)).toBeNull();
    expect(priorDraftFor([], 1)).toBeNull();
  });
});
