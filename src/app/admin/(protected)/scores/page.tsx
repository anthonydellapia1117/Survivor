import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { currentPlayWeek } from "@/lib/dashboard";
import { ScoresEditor } from "@/components/admin/scores-editor";

export const metadata: Metadata = { title: "Scores" };

export default async function ScoresPage(props: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await props.searchParams;
  const data = getData();
  const [games, weeks] = await Promise.all([
    data.getSchedule(),
    data.getWeeks(),
  ]);
  const playWeek = currentPlayWeek(weeks, new Date())?.week ?? 1;
  const week = Math.min(18, Math.max(1, Number(weekParam) || playWeek));

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl">Scores</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter finals and every pick result derives from its game —
          corrections recompute everything downstream. Nothing commits
          without the echo-confirm.
        </p>
      </div>
      <ScoresEditor
        week={week}
        weeks={weeks.map((w) => w.week)}
        games={games.filter((g) => g.week === week)}
      />
    </div>
  );
}
