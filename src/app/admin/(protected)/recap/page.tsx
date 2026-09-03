import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { getAdminData } from "@/lib/data/admin";
import { buildRecap } from "@/lib/lynne/recap";
import { RecapView } from "@/components/admin/recap-view";

export const metadata: Metadata = { title: "Weekly recap" };

export default async function RecapPage(props: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await props.searchParams;
  const data = getData();
  const [entries, cells, weeks, games] = await Promise.all([
    getAdminData().listEntrySummaries(),
    getAdminData().listGridCells(),
    data.getWeeks(),
    data.getSchedule(),
  ]);

  // Default to the most recent week with any scored result.
  const scoredWeeks = [
    ...new Set(
      cells
        .filter((c) => c.result && c.result !== "pending")
        .map((c) => c.week),
    ),
  ].sort((a, b) => a - b);
  const defaultWeek = scoredWeeks.at(-1) ?? 1;
  const week = Math.min(18, Math.max(1, Number(weekParam) || defaultWeek));

  const recap = buildRecap(week, entries, cells, weeks, games, new Date());

  return (
    <RecapView
      week={week}
      weeks={weeks.map((w) => w.week)}
      subject={recap.subject}
      text={recap.text}
      html={recap.html}
    />
  );
}
