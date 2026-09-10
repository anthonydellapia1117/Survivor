import { describe, expect, it } from "vitest";
import {
  cronMatches,
  cronMatchesEt,
  dueInWindowEt,
  etClock,
  unobservedEtSlots,
} from "../../scripts/ops/lib/cron";

// A slot written as a fixed UTC cron MOVES when the clock does. 3 AM ET is
// 07:00 UTC until 2026-11-01 and 08:00 UTC after it, so a cron pinned to
// either is an hour wrong for half the season - and the half it is wrong for
// is the half nobody is watching, because these slots are overnight.
//
// 2026-09-11 and 2026-11-13 are both Fridays, one either side of the change.

const FRI_EDT_3AM = new Date("2026-09-11T07:00:00Z");
const FRI_EST_3AM = new Date("2026-11-13T08:00:00Z");
const FRI_EST_0700 = new Date("2026-11-13T07:00:00Z"); // 2 AM ET, an hour early

describe("the ET wall clock", () => {
  it("reads an instant as a person in Philadelphia reads it", () => {
    expect(etClock(FRI_EDT_3AM)).toEqual({ dow: 5, hour: 3, minute: 0 });
    expect(etClock(FRI_EST_3AM)).toEqual({ dow: 5, hour: 3, minute: 0 });
    expect(etClock(FRI_EST_0700)).toEqual({ dow: 5, hour: 2, minute: 0 });
  });

  it("calls midnight hour 0, not 24", () => {
    expect(etClock(new Date("2026-09-11T04:00:00Z")).hour).toBe(0);
  });

  it("crosses the date line where ET does, not where UTC does", () => {
    // Sunday 10 PM ET is already Monday in UTC. A UTC-read cron would put
    // this slot on the wrong day of the week.
    const sunday10pm = new Date("2026-09-14T02:00:00Z");
    expect(etClock(sunday10pm)).toEqual({ dow: 0, hour: 22, minute: 0 });
    expect(sunday10pm.getUTCDay()).toBe(1);
  });
});

describe("an ET schedule", () => {
  const FRI_3AM_ET = "0 3 * * 5";

  it("names the same wall-clock minute in both offsets", () => {
    expect(cronMatchesEt(FRI_3AM_ET, FRI_EDT_3AM)).toBe(true);
    expect(cronMatchesEt(FRI_3AM_ET, FRI_EST_3AM)).toBe(true);
    expect(cronMatchesEt(FRI_3AM_ET, FRI_EST_0700)).toBe(false);
  });

  it("is exactly what a fixed UTC cron cannot do - which is why the field exists", () => {
    // Pinned to the EDT hour, the November run is missed.
    expect(cronMatches("0 7 * * 5", FRI_EDT_3AM)).toBe(true);
    expect(cronMatches("0 7 * * 5", FRI_EST_3AM)).toBe(false);
    // Pinned to the EST hour, the September run is missed AND it fires an
    // hour early in November - the two failures a season apart.
    expect(cronMatches("0 8 * * 5", FRI_EDT_3AM)).toBe(false);
    expect(cronMatches("0 8 * * 5", FRI_EST_3AM)).toBe(true);
  });

  it("puts Sunday 10 PM ET on Sunday, in both offsets", () => {
    const SUN_10PM_ET = "0 22 * * 0";
    expect(cronMatchesEt(SUN_10PM_ET, new Date("2026-09-14T02:00:00Z"))).toBe(true); // EDT
    expect(cronMatchesEt(SUN_10PM_ET, new Date("2026-11-16T03:00:00Z"))).toBe(true); // EST
    // A UTC cron for the same wall time would have to say Monday.
    expect(cronMatches("0 22 * * 0", new Date("2026-09-14T02:00:00Z"))).toBe(false);
  });

  it("refuses a date field, because that would need a zone of its own", () => {
    expect(() => cronMatchesEt("0 3 1 * 5", FRI_EDT_3AM)).toThrow(/day-of-month and month must both be \*/);
  });

  it("is due for the whole look-back window, the same as a UTC one", () => {
    expect(dueInWindowEt("0 3 * * 5", new Date("2026-11-13T08:43:00Z"), 60)).toBe(true);
    expect(dueInWindowEt("0 3 * * 5", new Date("2026-11-13T09:43:00Z"), 60)).toBe(false);
  });
});

describe("whether the tick observes an ET schedule", () => {
  const TICK = "43 7-23,0-3 * * *";
  const OLD_TICK = "43 9-23,0-2 * * *";

  it("checks BOTH offsets, and the tick this repo runs covers all six slots", () => {
    for (const e of ["0 3 * * 5", "0 3 * * 6", "0 17 * * 0", "0 22 * * 0", "0 3 * * 1", "0 3 * * 2"]) {
      expect({ slot: e, missed: unobservedEtSlots(e, TICK, 60) }).toEqual({ slot: e, missed: [] });
    }
  });

  it("names what the OLD tick would have lost - nine of the twelve slot-offsets", () => {
    const all = ["0 3 * * 5", "0 3 * * 6", "0 17 * * 0", "0 22 * * 0", "0 3 * * 1", "0 3 * * 2"]
      .flatMap((e) => unobservedEtSlots(e, OLD_TICK, 60));
    expect(all).toHaveLength(9);
    expect(all).toContain("Fri 03:00 ET = Fri 07:00 UTC (EDT)");
    expect(all).toContain("Fri 03:00 ET = Fri 08:00 UTC (EST)");
    // Sunday 5 PM was fine in both; Sunday 10 PM only in EDT.
    expect(all).not.toContain("Sun 17:00 ET = Sun 21:00 UTC (EDT)");
    expect(all).toContain("Sun 22:00 ET = Mon 03:00 UTC (EST)");
    expect(all).not.toContain("Sun 22:00 ET = Mon 02:00 UTC (EDT)");
  });

  it("catches a tick that observes a slot in ONE offset only", () => {
    // 07:43 but not 08:43: fine all summer, gone every November.
    const half = "43 7,9-23,0-3 * * *";
    expect(unobservedEtSlots("0 3 * * 5", half, 60)).toEqual(["Fri 03:00 ET = Fri 08:00 UTC (EST)"]);
  });
});
