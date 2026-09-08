import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { notify } from "../../scripts/lib/notify";
import { alreadySent, isSendable, lockDayKey, priorSendFrom, type PriorSend } from "../../scripts/lib/send";
import { encodeRaw } from "../../scripts/lib/gmail";
import { buildRecipientOwners, earliestOpenDeadline, unpickedEntries } from "../../scripts/lib/roster";
import type { EntryRow, OwnerRow, StandingRow } from "../../scripts/lib/db";
import type { GameLite, WeekBounds } from "../../scripts/picks/lib/deadline";

const WEEK1: WeekBounds = {
  week: 1,
  earlyDeadlineAt: "2026-09-09T16:00:00+00:00",
  lateDeadlineAt: "2026-09-11T16:00:00+00:00",
};
const GAMES: GameLite[] = [
  { week: 1, dayOfWeek: "Wednesday", homeTeam: "SEA", awayTeam: "NE" },
  { week: 1, dayOfWeek: "Thursday", homeTeam: "LAR", awayTeam: "SF" },
  { week: 1, dayOfWeek: "Sunday", homeTeam: "PHI", awayTeam: "WAS" },
  { week: 1, dayOfWeek: "Monday", homeTeam: "KC", awayTeam: "DEN" },
];

describe("notify", () => {
  const original = process.env.NTFY_TOPIC;
  const fetchSpy = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (original === undefined) delete process.env.NTFY_TOPIC;
    else process.env.NTFY_TOPIC = original;
  });

  it("prints and never posts when NTFY_TOPIC is unset", async () => {
    delete process.env.NTFY_TOPIC;
    expect(await notify("picks finished - 3 written")).toBe("printed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts one line to the chosen topic when it is set", async () => {
    process.env.NTFY_TOPIC = "anthony-survivor";
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    expect(await notify("chase finished -  2 drafts")).toBe("posted");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://ntfy.sh/anthony-survivor");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("chase finished - 2 drafts");
  });

  it("falls back to printing when ntfy is unreachable", async () => {
    process.env.NTFY_TOPIC = "anthony-survivor";
    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
    expect(await notify("results finished")).toBe("printed");
  });
});

describe("send gate", () => {
  it("allows only pick_reminder", () => {
    expect(isSendable("pick_reminder")).toBe(true);
    expect(isSendable("pick_request")).toBe(false);
    expect(isSendable("")).toBe(false);
  });

  it("keys the lock day on the ET calendar date of the deadline", () => {
    expect(lockDayKey("2026-09-11T16:00:00+00:00")).toBe("2026-09-11");
    // 10 PM ET on the 10th is 02:00Z on the 11th; the lock day is still the 10th.
    expect(lockDayKey("2026-09-11T02:00:00Z")).toBe("2026-09-10");
  });

  it("counts a claim row with no message id as a prior send", () => {
    const claim = priorSendFrom({
      at: "2026-09-11T14:00:00Z",
      target_id: "chas.flaster@gmail.com:2026-09-11",
      after: { recipient: "chas.flaster@gmail.com", lock_day: "2026-09-11" },
    });
    expect(claim).toEqual({ recipient: "chas.flaster@gmail.com", lockDay: "2026-09-11", messageId: "", at: "2026-09-11T14:00:00Z" });
    expect(alreadySent([claim!], "chas.flaster@gmail.com", "2026-09-11")).not.toBeNull();
    expect(priorSendFrom({ at: "", target_id: null, after: { recipient: "x@y.com" } })).toBeNull();
  });

  it("finds a prior send by recipient and lock day, case-insensitively", () => {
    const prior: PriorSend[] = [
      { recipient: "chas.flaster@gmail.com", lockDay: "2026-09-11", messageId: "m1", at: "" },
    ];
    expect(alreadySent(prior, "Chas.Flaster@gmail.com", "2026-09-11")?.messageId).toBe("m1");
    expect(alreadySent(prior, "chas.flaster@gmail.com", "2026-09-09")).toBeNull();
    expect(alreadySent(prior, "someone@else.com", "2026-09-11")).toBeNull();
  });
});

describe("encodeRaw", () => {
  it("writes Bcc and a blank line before the body", () => {
    const raw = encodeRaw({ to: ["me@x.com"], bcc: ["a@x.com", "b@x.com"], subject: "Survivor - test", body: "Hi" });
    const text = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(text).toContain("To: me@x.com\r\n");
    expect(text).toContain("Bcc: a@x.com, b@x.com\r\n");
    expect(text).toContain("Subject: Survivor - test\r\n");
    expect(text.endsWith("\r\n\r\nHi")).toBe(true);
  });
});

describe("earliestOpenDeadline", () => {
  it("on Tuesday afternoon the Thursday game is the earliest still open", () => {
    const now = new Date("2026-09-08T17:55:00Z");
    const d = earliestOpenDeadline(GAMES, WEEK1, now);
    expect(d?.deadlineIso).toBe(WEEK1.earlyDeadlineAt);
    expect(d?.teams).toEqual(["LAR", "SF"]);
    expect(d?.lateDeadlineIso).toBe(WEEK1.lateDeadlineAt);
  });

  it("skips teams the entry has already used", () => {
    const now = new Date("2026-09-08T17:55:00Z");
    const d = earliestOpenDeadline(GAMES, WEEK1, now, ["SF", "LAR"]);
    expect(d?.deadlineIso).toBe(WEEK1.lateDeadlineAt);
    expect(d?.teams).toEqual(["DEN", "KC", "PHI", "WAS"]);
  });

  it("is null once Friday noon has passed", () => {
    expect(earliestOpenDeadline(GAMES, WEEK1, new Date("2026-09-11T16:00:01Z"))).toBeNull();
  });
});

const owners: OwnerRow[] = [
  { id: "o1", first_name: "Kris", last_name: "Tomasco", email: "kris@x.com", participation_status: "confirmed" },
  { id: "o2", first_name: "John", last_name: "Vassallo", email: "john@x.com", participation_status: "declined" },
  { id: "o3", first_name: "", last_name: "Pumpy321", email: "p@x.com", participation_status: "confirmed" },
];
const entry = (id: string, owner: string, name: string, extra: Partial<EntryRow> = {}): EntryRow => ({
  id,
  owner_id: owner,
  entry_name: name,
  player_email: null,
  is_gifted: false,
  is_free_entry: false,
  lynne_number: null,
  lynne_label: null,
  voided_at: null,
  ...extra,
});
const entries: EntryRow[] = [
  entry("e1", "o1", "Kris Tomasco #1"),
  entry("e2", "o1", "Chas Flaster #1", { is_gifted: true, player_email: "chas@x.com" }),
  entry("e3", "o2", "John Vassallo #1", { voided_at: "2026-09-04T00:00:00Z" }),
  entry("e4", "o3", "Pumpy321"),
  entry("e5", "o1", "Kris Tomasco #2"),
];
const standings: StandingRow[] = [
  { entry_id: "e1", status: "active", losses: 0, bye_used: false },
  { entry_id: "e2", status: "active", losses: 0, bye_used: false },
  { entry_id: "e4", status: "eliminated", losses: 2, bye_used: false },
  { entry_id: "e5", status: "active", losses: 0, bye_used: false },
];

describe("unpickedEntries", () => {
  it("drops picked, eliminated and voided entries", () => {
    const ids = unpickedEntries(entries, ["e5"], standings).map((e) => e.id);
    expect(ids).toEqual(["e1", "e2"]);
  });
});

describe("buildRecipientOwners", () => {
  it("keeps confirmed owners with included entries and greets by first name", () => {
    const out = buildRecipientOwners(owners, entries, (e) => e.id !== "e5");
    expect(out.map((o) => o.id)).toEqual(["o1", "o3"]);
    expect(out[0].greetingName).toBe("Kris");
    expect(out[0].entries.map((e) => e.entryName)).toEqual(["Kris Tomasco #1", "Chas Flaster #1"]);
    expect(out[0].entries[1]).toMatchObject({ isGifted: true, playerEmail: "chas@x.com" });
    expect(out[1].greetingName).toBe("Pumpy321");
  });
});

describe("standings source", () => {
  it("reads v_entry_public, the dashboard's view, never v_entry_standing, which the admin session cannot select", () => {
    const src = readFileSync(path.resolve(__dirname, "../../scripts/lib/db.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function loadStandings"));
    const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
    expect(body).toContain('.from("v_entry_public")');
    expect(body).not.toContain('.from("v_entry_standing")');
    expect(body).not.toContain('.from("v_entry_admin")');
  });
});

describe("the one send path", () => {
  it("is scripts/lib/send.ts: no other file under scripts/ calls Gmail's send", () => {
    const root = path.resolve(__dirname, "../../scripts");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts")) files.push(full);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(10);
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const senders = files.filter((f) => /messages\.send\s*\(/.test(strip(readFileSync(f, "utf8"))));
    expect(senders.map((f) => path.relative(root, f))).toEqual(["lib/send.ts"]);
  });
});
