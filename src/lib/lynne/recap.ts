// C5: the weekly email I forward to my players — my group's standings in
// Lynne's three buckets, who lost and to whom, who is alive, the next
// deadline, and any duplicate-team warnings. Text and HTML variants.

import type { EntrySummary, GridCell, WeekRow } from "@/lib/data/types";
import { LYNNE_TEAM_NAME, lynneBucket } from "./names";
import { duplicateTeamRisks } from "@/lib/alive";
import { nextLockBoundary, LOCK_KIND_LABEL } from "@/lib/dashboard";
import { SKIP_WEEK, TEAM_NAME } from "@/lib/standing";

export interface Recap {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function buildRecap(
  week: number,
  entries: EntrySummary[],
  cells: GridCell[],
  weeks: WeekRow[],
  now: Date,
): Recap {
  const buckets = { "No Losses": 0, "Loss/Bye": 0, Out: 0 };
  for (const e of entries) buckets[lynneBucket(e)] += 1;
  const aliveList = entries
    .filter((e) => e.status !== "eliminated")
    .map((e) => e.entryName)
    .sort((a, b) => a.localeCompare(b));

  const nameById = new Map(entries.map((e) => [e.id, e.entryName]));
  const losers = cells
    .filter(
      (c) =>
        c.week === week &&
        (c.result === "loss" || c.result === "tie_loss" || c.result === "missed"),
    )
    .map((c) => ({
      name: nameById.get(c.entryId) ?? "?",
      team:
        c.team === "MISSED"
          ? "no pick (missed)"
          : (LYNNE_TEAM_NAME[c.team] ?? TEAM_NAME[c.team] ?? c.team),
      tie: c.result === "tie_loss",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byes = cells
    .filter((c) => c.week === week && c.team === SKIP_WEEK)
    .map((c) => nameById.get(c.entryId) ?? "?")
    .sort();

  const boundary = nextLockBoundary(weeks, now);
  const deadlineLine = boundary
    ? `Next deadline: Week ${boundary.week} ${LOCK_KIND_LABEL[boundary.kind]} lock ${new Date(
        boundary.deadlineAt,
      ).toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })} ET.`
    : "The season is complete.";

  const dupes = duplicateTeamRisks(cells).map(
    (d) =>
      `${nameById.get(d.entryId) ?? d.entryId} has ${d.team} picked in weeks ${d.weeks.join(" and ")} — a repeat team is an elimination, fix it before the deadline`,
  );

  const sentence = `No Losses=${buckets["No Losses"]}, 1 Loss/Bye used=${buckets["Loss/Bye"]} and Out=${buckets.Out}. We are down to ${aliveList.length} left in the pool.`;

  const textParts = [
    `SURVIVOR — WEEK ${week} RECAP`,
    "",
    sentence,
    "",
    losers.length > 0
      ? `Losses this week (${losers.length}):\n` +
        losers.map((l) => `  ${l.name} — ${l.team}${l.tie ? " (tie counts as a loss)" : ""}`).join("\n")
      : "No losses in our group this week.",
    byes.length > 0 ? `\nByes used: ${byes.join(", ")}` : "",
    "",
    `Still alive (${aliveList.length}): ${aliveList.join(", ")}`,
    "",
    deadlineLine,
    dupes.length > 0 ? `\n⚠ WARNINGS:\n` + dupes.map((d) => `  ${d}`).join("\n") : "",
  ].filter((p) => p !== "");

  const htmlParts = [
    `<h2 style="margin:0 0 8px">Survivor — Week ${week} recap</h2>`,
    `<p><strong>${esc(sentence)}</strong></p>`,
    losers.length > 0
      ? `<p>Losses this week (${losers.length}):</p><ul>` +
        losers
          .map(
            (l) =>
              `<li><strong>${esc(l.name)}</strong> — ${esc(l.team)}${l.tie ? " <em>(tie counts as a loss)</em>" : ""}</li>`,
          )
          .join("") +
        `</ul>`
      : `<p>No losses in our group this week.</p>`,
    byes.length > 0 ? `<p>Byes used: ${esc(byes.join(", "))}</p>` : "",
    `<p>Still alive (${aliveList.length}): ${esc(aliveList.join(", "))}</p>`,
    `<p>${esc(deadlineLine)}</p>`,
    dupes.length > 0
      ? `<p style="color:#c0392b"><strong>⚠ Warnings</strong></p><ul>` +
        dupes.map((d) => `<li style="color:#c0392b">${esc(d)}</li>`).join("") +
        `</ul>`
      : "",
  ].filter(Boolean);

  return {
    subject: `Survivor — Week ${week} recap`,
    text: textParts.join("\n"),
    html: htmlParts.join("\n"),
  };
}
