import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { gmail_v1 } from "googleapis";
import { loadAuditByAction, recordAudit, type WeekBoundsRow } from "../../scripts/lib/db";
import { sendWeekReminder, weekReminderKey, WEEK_REMINDER_CLAIM_ACTION, type WeekReminderRequest } from "../../scripts/lib/send";
import { dueSlot, etDateKey, findSlot, isSlotName, slotKey, slotsOf, SLOT_NAMES } from "../../scripts/remind/lib/due";
import { reminderBody, reminderSubject } from "../../scripts/remind/lib/message";
import type { GameLite, WeekBounds } from "../../scripts/picks/lib/deadline";
import { loadOpsConfig, jobSchedule} from "../../scripts/ops/lib/config";
import { dueInWindow, parseCron } from "../../scripts/ops/lib/cron";

// THREE reminders a week, each sent in the morning. Set by Anthony on
// 2026-09-10, replacing the two-boundary schedule:
//
//   wed  Wednesday morning, naming the week's EARLY boundary (the Thursday
//        game's deadline)
//   thu  Thursday morning, naming the week's LATE boundary (the weekend)
//   fri  Friday morning, the FINAL CALL, naming that same LATE boundary
//
// Thursday and Friday name the SAME boundary, so week + boundary can no
// longer be the once-only key and every guard below is about the key being
// week + SLOT instead.

// Week 1 as the weeks table holds it: 2 PM ET, which is 18:00Z in EDT.
const WEEKS: WeekBoundsRow[] = [
  { week: 1, early_deadline_at: "2026-09-09T18:00:00+00:00", late_deadline_at: "2026-09-11T18:00:00+00:00" },
  { week: 2, early_deadline_at: "2026-09-16T18:00:00+00:00", late_deadline_at: "2026-09-18T18:00:00+00:00" },
];

// The same week with the hour Anthony used BEFORE 2026-09-09: noon ET, 16:00Z.
// Nothing in the schedule may read differently for it.
const NOON_WEEKS: WeekBoundsRow[] = [
  { week: 1, early_deadline_at: "2026-09-09T16:00:00+00:00", late_deadline_at: "2026-09-11T16:00:00+00:00" },
];

// And an hour nobody has ever used, to prove the same.
const ODD_WEEKS: WeekBoundsRow[] = [
  { week: 1, early_deadline_at: "2026-09-09T13:45:00+00:00", late_deadline_at: "2026-09-11T22:15:00+00:00" },
];

describe("the three slots of a week", () => {
  it("each names the right boundary: wed the early one, thu and fri the late one", () => {
    const week1 = slotsOf(WEEKS).filter((s) => s.week === 1);
    expect(week1.map((s) => [s.slot, s.kind, s.deadlineIso])).toEqual([
      ["wed", "early", "2026-09-09T18:00:00+00:00"],
      ["thu", "late", "2026-09-11T18:00:00+00:00"],
      ["fri", "late", "2026-09-11T18:00:00+00:00"],
    ]);
    // Every slot is sent on a morning: wed on the early boundary's own ET day,
    // fri on the late one's, thu on the day between them.
    expect(week1.map((s) => s.sendDate)).toEqual(["2026-09-09", "2026-09-10", "2026-09-11"]);
    expect(SLOT_NAMES).toEqual(["wed", "thu", "fri"]);
    expect(findSlot(WEEKS, 2, "thu")).toMatchObject({ week: 2, kind: "late", sendDate: "2026-09-17" });
    expect(findSlot(WEEKS, 3, "wed")).toBeNull();
    expect(isSlotName("thu")).toBe(true);
    expect(isSlotName("late")).toBe(false);
  });

  it("keys on week and SLOT, so wed and fri never collide and thu and fri are two sends", () => {
    const week1 = slotsOf(WEEKS).filter((s) => s.week === 1);
    expect(week1.map(slotKey)).toEqual(["week:1:wed", "week:1:thu", "week:1:fri"]);
    expect(new Set(week1.map(slotKey)).size).toBe(3);
    // The whole reason the key moved: thu and fri name ONE boundary. A key
    // made of week + boundary would give them the same string and the audit
    // guard would swallow the final call.
    const [, thu, fri] = week1;
    expect(thu.deadlineIso).toBe(fri.deadlineIso);
    expect(thu.kind).toBe(fri.kind);
    expect(slotKey(thu)).not.toBe(slotKey(fri));
    // And no two weeks share a key either.
    const all = slotsOf(WEEKS).map(slotKey);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("which slot a run belongs to", () => {
  it("is today's, from the ET calendar, and nothing on a day without one", () => {
    // Wednesday morning ET.
    expect(dueSlot(WEEKS, new Date("2026-09-09T13:00:00Z"))).toMatchObject({ week: 1, slot: "wed", kind: "early" });
    // Thursday morning ET: the late boundary, a day and a half out.
    expect(dueSlot(WEEKS, new Date("2026-09-10T13:00:00Z"))).toMatchObject({ week: 1, slot: "thu", kind: "late" });
    // Friday morning ET: the final call, on the same boundary.
    expect(dueSlot(WEEKS, new Date("2026-09-11T13:00:00Z"))).toMatchObject({ week: 1, slot: "fri", kind: "late" });
    // Tuesday, Saturday, Sunday: nothing.
    expect(dueSlot(WEEKS, new Date("2026-09-08T13:00:00Z"))).toBeNull();
    expect(dueSlot(WEEKS, new Date("2026-09-12T13:00:00Z"))).toBeNull();
    expect(dueSlot(WEEKS, new Date("2026-09-13T13:00:00Z"))).toBeNull();
    // The next week picks up on its own Wednesday.
    expect(dueSlot(WEEKS, new Date("2026-09-16T13:00:00Z"))).toMatchObject({ week: 2, slot: "wed" });
  });

  it("stops at the deadline it names: a reminder never says an open window that has closed", () => {
    // Wednesday one minute before and one minute after the early deadline.
    expect(dueSlot(WEEKS, new Date("2026-09-09T17:59:00Z"))?.slot).toBe("wed");
    expect(dueSlot(WEEKS, new Date("2026-09-09T18:01:00Z"))).toBeNull();
    // Friday afternoon, after the lock: nothing to call for.
    expect(dueSlot(WEEKS, new Date("2026-09-11T18:01:00Z"))).toBeNull();
    // Thursday evening still has the Friday boundary ahead of it.
    expect(dueSlot(WEEKS, new Date("2026-09-10T23:00:00Z"))?.slot).toBe("thu");
  });

  it("reads the hour out of the weeks table and holds none of its own", () => {
    // Every one of the eighteen weeks reads 2 PM ET today and read noon
    // before 2026-09-09. The schedule must be the same shape either way, and
    // for an hour nobody has ever stored.
    for (const weeks of [NOON_WEEKS, ODD_WEEKS]) {
      const slots = slotsOf(weeks);
      expect(slots.map((s) => [s.slot, s.kind])).toEqual([["wed", "early"], ["thu", "late"], ["fri", "late"]]);
      expect(slots.map((s) => s.sendDate)).toEqual(["2026-09-09", "2026-09-10", "2026-09-11"]);
    }
    // Noon ET: 8 AM is inside the Wednesday slot, 1 PM is past it.
    expect(dueSlot(NOON_WEEKS, new Date("2026-09-09T12:00:00Z"))?.slot).toBe("wed");
    expect(dueSlot(NOON_WEEKS, new Date("2026-09-09T17:00:00Z"))).toBeNull();
    // 9:45 AM ET on the Wednesday, 6:15 PM ET on the Friday: the same rule.
    expect(dueSlot(ODD_WEEKS, new Date("2026-09-09T13:44:00Z"))?.slot).toBe("wed");
    expect(dueSlot(ODD_WEEKS, new Date("2026-09-09T13:46:00Z"))).toBeNull();
    expect(dueSlot(ODD_WEEKS, new Date("2026-09-11T22:14:00Z"))?.slot).toBe("fri");
    expect(dueSlot(ODD_WEEKS, new Date("2026-09-11T22:16:00Z"))).toBeNull();
    // In EST the same 2 PM deadline is 19:00Z, and the slots do not move.
    const est: WeekBoundsRow[] = [{ week: 10, early_deadline_at: "2026-11-11T19:00:00+00:00", late_deadline_at: "2026-11-13T19:00:00+00:00" }];
    expect(slotsOf(est).map((s) => s.sendDate)).toEqual(["2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(dueSlot(est, new Date("2026-11-12T13:00:00Z"))?.slot).toBe("thu");
    // No hour, minute or clock time is written into the schedule's source.
    const src = readFileSync("scripts/remind/lib/due.ts", "utf8").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/\b(1[0-9]|[0-9]):[0-5][0-9]\b/);
    expect(src).not.toMatch(/setUTCHours|getUTCHours|getHours|\bhour\b/i);
    expect(etDateKey(new Date("2026-09-12T03:30:00Z"))).toBe("2026-09-11");
  });
});

describe("the words each slot carries", () => {
  const BOUNDS: WeekBounds = { week: 1, earlyDeadlineAt: WEEKS[0].early_deadline_at, lateDeadlineAt: WEEKS[0].late_deadline_at };
  const GAMES: GameLite[] = [
    { week: 1, dayOfWeek: "Wednesday", homeTeam: "SEA", awayTeam: "NE" },
    { week: 1, dayOfWeek: "Thursday", homeTeam: "LAR", awayTeam: "SF" },
    { week: 1, dayOfWeek: "Sunday", homeTeam: "PHI", awayTeam: "DAL" },
    { week: 1, dayOfWeek: "Monday", homeTeam: "BUF", awayTeam: "NYJ" },
  ];
  const [wed, thu, fri] = slotsOf(WEEKS).filter((s) => s.week === 1);
  const WED_AM = new Date("2026-09-09T13:00:00Z");
  const THU_AM = new Date("2026-09-10T13:00:00Z");
  const FRI_AM = new Date("2026-09-11T13:00:00Z");

  it("names its own boundary's day and time, and only Friday is the final call", () => {
    expect(reminderSubject(wed, WED_AM)).toBe("Survivor Week 1 - picks due today at 2 PM");
    expect(reminderSubject(thu, THU_AM)).toBe("Survivor Week 1 - picks due tomorrow at 2 PM");
    expect(reminderSubject(fri, FRI_AM)).toBe("Survivor Week 1 - FINAL CALL, picks due today at 2 PM");
    // Every subject begins with the word the reply filter needs.
    for (const [s, now] of [[wed, WED_AM], [thu, THU_AM], [fri, FRI_AM]] as const) {
      expect(reminderSubject(s, now)).toMatch(/^Survivor\b/);
    }
    expect(reminderBody(fri, BOUNDS, GAMES, FRI_AM, { outstanding: 0 }).split("\n")[0]).toBe("Week 1 - FINAL CALL.");
    expect(reminderBody(thu, BOUNDS, GAMES, THU_AM, { outstanding: 0 }).split("\n")[0]).toBe("Week 1 is here.");
  });

  it("tells each morning what is still open, and never a window that has closed", () => {
    // Every deadline names its date as well as its relative day: "tomorrow" in
    // a message somebody opens the next morning points at the wrong day.
    expect(reminderBody(wed, BOUNDS, GAMES, WED_AM, { outstanding: 0 })).toContain("Thursday's game closes today, Wednesday September 9, at 2 PM ET. Sunday and Monday games close Friday September 11 at 2 PM ET.");
    expect(reminderBody(thu, BOUNDS, GAMES, THU_AM, { outstanding: 0 })).toContain("Sunday and Monday games close tomorrow, Friday September 11, at 2 PM ET.");
    expect(reminderBody(thu, BOUNDS, GAMES, THU_AM, { outstanding: 0 })).not.toContain("Thursday's game");
    expect(reminderBody(fri, BOUNDS, GAMES, FRI_AM, { outstanding: 0 })).toContain("Sunday and Monday games close today, Friday September 11, at 2 PM ET.");
  });

  it("says reply or text on every slot, and links the site only on the line that denies it", () => {
    for (const [s, now] of [[wed, WED_AM], [thu, THU_AM], [fri, FRI_AM]] as const) {
      const body = reminderBody(s, BOUNDS, GAMES, now, { outstanding: 0 });
      expect(body).toContain("Reply to this email with your team - reply to me, not reply all.");
      expect(body).toContain("Or text 215-384-8335.");
      const linked = body.split("\n").filter((l) => l.includes("ad-26-survivor.vercel.app"));
      expect(linked).toEqual(["You do not make picks in the app. It is there to look at: https://ad-26-survivor.vercel.app"]);
    }
  });
});

// ------------------------------------------------ the send, once per slot
vi.mock("../../scripts/lib/db", () => ({ recordAudit: vi.fn(), loadAuditByAction: vi.fn() }));

const audit = vi.mocked(recordAudit);
const loadAudit = vi.mocked(loadAuditByAction);

const client = {} as SupabaseClient;
function fakeGmail() {
  const send = vi.fn(async () => ({ data: { id: "gmail-msg-1" } }));
  return { gmail: { users: { messages: { send } } } as unknown as gmail_v1.Gmail, send };
}
const req: WeekReminderRequest = {
  template: "week_reminder",
  to: "anthonydellapia@gmail.com",
  bcc: ["a@example.com", "b@example.com", "c@example.com"],
  subject: "Survivor Week 1 - FINAL CALL, picks due today at 2 PM",
  body: "Week 1 - FINAL CALL.\n",
  week: 1,
  boundary: "late",
  slot: "fri",
  deadlineIso: "2026-09-11T18:00:00+00:00",
  expectedRecipients: 3,
  actor: "anthonydellapia@gmail.com",
};

describe("sending a slot", () => {
  const original = process.env.REMINDER_AUTOSEND;
  beforeEach(() => {
    process.env.REMINDER_AUTOSEND = "true";
    audit.mockReset();
    let n = 0;
    audit.mockImplementation(async () => ++n);
    loadAudit.mockReset();
    loadAudit.mockResolvedValue([]);
  });
  afterEach(() => {
    if (original === undefined) delete process.env.REMINDER_AUTOSEND;
    else process.env.REMINDER_AUTOSEND = original;
  });

  const claimRow = (key: string) => [
    { id: 1, at: "2026-09-11T12:00:00Z", actor: "a", action: WEEK_REMINDER_CLAIM_ACTION, target_id: key, after: { boundary_key: key } as Record<string, unknown> },
  ];

  it("builds the once-only key from the slot", async () => {
    const { gmail } = fakeGmail();
    const out = await sendWeekReminder(gmail, client, req);
    expect(out).toMatchObject({ kind: "sent", key: "week:1:fri" });
    expect(weekReminderKey(1, "fri")).toBe("week:1:fri");
    expect(audit.mock.calls[0][1]).toMatchObject({ targetId: "week:1:fri", after: { boundary_key: "week:1:fri", slot: "fri", boundary: "late" } });
  });

  it("requires the slot: there is no boundary left to fall back to", () => {
    // This one is checked by `npx tsc --noEmit`, not at run time, and that is
    // the point: the degrade Copilot named on #54 was a TYPE hole, not a
    // runtime branch. `slot` was optional and the key read `req.slot ??
    // req.boundary`, so a caller that simply left it out got week:1:late for
    // BOTH Thursday and Friday and lost the final call. If either signature
    // ever loosens again, @ts-expect-error stops being satisfied and the
    // typecheck fails - which is the only place a hole like this shows up.
    // @ts-expect-error slot is required on WeekReminderRequest
    const noSlot: WeekReminderRequest = { ...req, slot: undefined };
    expect(noSlot.week).toBe(1);
    // @ts-expect-error weekReminderKey takes a slot; a boundary name is not one
    expect(weekReminderKey(1, "late")).toBe("week:1:late");
  });

  it("refuses a second run for the same week and slot", async () => {
    const { gmail, send } = fakeGmail();
    loadAudit.mockImplementation(async (_c, action) => (action === WEEK_REMINDER_CLAIM_ACTION ? claimRow("week:1:fri") : []));
    const out = await sendWeekReminder(gmail, client, req);
    expect(out).toMatchObject({ kind: "already_sent", key: "week:1:fri" });
    expect(send).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("does NOT let Thursday's send swallow Friday's, though both name the late boundary", async () => {
    // The regression the slot key exists for. Under a week+boundary key both
    // of these are week:1:late, and the final call - the one that matters
    // most - would be dropped as a duplicate with nothing printed but
    // "already sent".
    const { gmail, send } = fakeGmail();
    loadAudit.mockImplementation(async (_c, action) => (action === WEEK_REMINDER_CLAIM_ACTION ? claimRow("week:1:thu") : []));
    const out = await sendWeekReminder(gmail, client, req);
    expect(out).toMatchObject({ kind: "sent", key: "week:1:fri" });
    expect(send).toHaveBeenCalledTimes(1);
    // And the Wednesday slot of the same week is its own send too: Friday's
    // row on record does not block it either.
    loadAudit.mockImplementation(async (_c, action) => (action === WEEK_REMINDER_CLAIM_ACTION ? claimRow("week:1:fri") : []));
    const wed = await sendWeekReminder(gmail, client, { ...req, boundary: "early", slot: "wed", deadlineIso: "2026-09-09T18:00:00+00:00" });
    expect(wed).toMatchObject({ kind: "sent", key: "week:1:wed" });
  });

  it("stops on a count that is not exactly the expected one, either way round", async () => {
    const { gmail, send } = fakeGmail();
    await expect(sendWeekReminder(gmail, client, { ...req, expectedRecipients: 4 })).rejects.toThrow(/Count gate: 3 recipients on the Bcc, 4 expected/);
    await expect(sendWeekReminder(gmail, client, { ...req, expectedRecipients: 2 })).rejects.toThrow(/Count gate: 3 recipients on the Bcc, 2 expected/);
    await expect(sendWeekReminder(gmail, client, { ...req, bcc: [] })).rejects.toThrow(/Bcc list is empty/);
    expect(send).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("keeps the two gates the whole schedule rests on: autosend and the Survivor subject", async () => {
    const { gmail, send } = fakeGmail();
    process.env.REMINDER_AUTOSEND = "1";
    await expect(sendWeekReminder(gmail, client, req)).rejects.toThrow(/drafts only/);
    process.env.REMINDER_AUTOSEND = "true";
    await expect(sendWeekReminder(gmail, client, { ...req, subject: "Week 1 - FINAL CALL" })).rejects.toThrow(/begin with "Survivor"/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the command that runs a slot", () => {
  const cli = readFileSync("scripts/remind/cli.ts", "utf8");

  it("derives the slot, the recipients and the count gate on the run, and passes the slot to the send", () => {
    expect(cli).toMatch(/dueSlot\(weeks, now\)/);
    expect(cli).toMatch(/findSlot\(weeks, args\.week, args\.slot\)/);
    // Derived live, never a saved or hand-built list: a hand-built Bcc is how
    // a dead address survived and hard-bounced on 2026-09-09.
    expect(cli).toMatch(/const bcc = reminderAddresses\(owners, entries\);/);
    expect(cli).toMatch(/countGate\(EXPECTED_ROSTER_ADDRESSES, bcc\)/);
    expect(cli).toMatch(/if \(!gate\.ok\) \{[\s\S]{0,600}?throw new Error\(`Count gate:/);
    // The slot reaches the send, so the audit key is the slot's and not the
    // boundary's. Without this line the key silently falls back.
    expect(cli).toMatch(/slot: b\.slot,/);
    expect(cli).toMatch(/sendWeekReminder\(gmailClient\(\), client, \{/);
    // The one send path, behind its own switch.
    expect(cli).toMatch(/if \(args\.send && !autosendEnabled\(\)\)/);
    expect(cli).not.toMatch(/messages\.send/);
    // Reply or text only: no route that offers the site as a way to pick.
    expect(cli).not.toMatch(/SITE_URL/);
    // The hour is never named here either.
    expect(cli).not.toMatch(/\b\d{1,2}:[0-5][0-9]\b/);
  });
});

describe("the cron the three slots fire on", () => {
  it("names the three mornings, and the tick that observes them sees each one", () => {
    const c = loadOpsConfig();
    const cron = jobSchedule(c.jobs["pick-reminder"]).exprs[0];
    const spec = parseCron(cron);
    expect([...spec.dow]).toEqual([3, 4, 5]);
    expect(spec.hour.size).toBe(1);
    expect(spec.minute.size).toBe(1);
    // Wednesday, Thursday and Friday of Week 1, at the tick that follows each
    // slot; and never on a day without a slot.
    for (const day of ["2026-09-09", "2026-09-10", "2026-09-11"]) {
      const tick = new Date(`${day}T12:43:00Z`);
      expect({ day, due: dueInWindow(cron, tick, c.tickWindowMinutes) }).toEqual({ day, due: true });
      expect({ day, slot: dueSlot(WEEKS, tick)?.slot ?? null }).toEqual({ day, slot: { "2026-09-09": "wed", "2026-09-10": "thu", "2026-09-11": "fri" }[day] });
    }
    for (const day of ["2026-09-08", "2026-09-12", "2026-09-13", "2026-09-14"]) {
      expect({ day, due: dueInWindow(cron, new Date(`${day}T12:43:00Z`), c.tickWindowMinutes) }).toEqual({ day, due: false });
    }
  });

  it("gives the two same-day slots at least the notice reminderLeadHours records, in EDT and in EST", () => {
    // The lead no longer decides which slot a run belongs to - the ET calendar
    // does - so it would be a dead setting if nothing held the cron to it.
    // wed and fri name a deadline on their own morning's day, so the cron is
    // the notice those two give: at 12:00 UTC that is six hours before a 2 PM
    // ET deadline in EDT (18:00Z) and seven in EST (19:00Z). Moving the cron
    // later, or the lead higher, fails here rather than quietly shortening the
    // warning Anthony's players get.
    const c = loadOpsConfig();
    const [hour] = [...parseCron(jobSchedule(c.jobs["pick-reminder"]).exprs[0]).hour];
    for (const deadlineUtcHour of [18, 19]) {
      expect({ deadlineUtcHour, notice: deadlineUtcHour - hour }).toEqual({ deadlineUtcHour, notice: expect.any(Number) });
      expect(deadlineUtcHour - hour).toBeGreaterThanOrEqual(c.reminderLeadHours);
    }
  });
});
