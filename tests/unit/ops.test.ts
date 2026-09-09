import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EXPECTED_ROSTER_ADDRESSES } from "../../scripts/lib/constants";
import { CONFIG_PATH, JOB_NAMES, loadOpsConfig, SEND_JOBS, validateOpsConfig } from "../../scripts/ops/lib/config";
import { cronMatches, dueInWindow, parseCron } from "../../scripts/ops/lib/cron";
import { latestLockedWeek } from "../../scripts/ops/lib/weeks";

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
    expect(loadOpsConfig().expectedRosterAddresses).toBe(39);
    expect(EXPECTED_ROSTER_ADDRESSES).toBe(39);
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

  it("puts the reminder six hours before a noon, 1 PM or 2 PM ET deadline on the days that carry one", () => {
    const { schedule } = loadOpsConfig().jobs["pick-reminder"];
    // Week 1's late deadline is Friday 18:00Z; six hours before is 12:00Z, the 12:43Z tick sees it.
    expect(dueInWindow(schedule, new Date("2026-09-11T12:43:00Z"), 60)).toBe(true);
    // A noon-ET deadline (16:00Z) is six hours before at 10:00Z.
    expect(dueInWindow(schedule, new Date("2026-09-16T10:43:00Z"), 60)).toBe(true); // Wednesday
    expect(dueInWindow(schedule, new Date("2026-09-14T10:43:00Z"), 60)).toBe(false); // Monday
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
