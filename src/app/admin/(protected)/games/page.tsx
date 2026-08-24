import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { getAdminData } from "@/lib/data/admin";
import { currentPlayWeek } from "@/lib/dashboard";
import { GamesControl } from "@/components/admin/games-control";

export const metadata: Metadata = { title: "Games" };

export default async function GamesPage(props: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await props.searchParams;
  const data = getData();
  const [games, weeks, cells] = await Promise.all([
    data.getSchedule(),
    data.getWeeks(),
    getAdminData().listGridCells(),
  ]);
  const playWeek = currentPlayWeek(weeks, new Date())?.week ?? 1;
  const week = Math.min(18, Math.max(1, Number(weekParam) || playWeek));

  // Real pick counts per team for the week — admin always sees them.
  const pickCounts = new Map<string, number>();
  for (const c of cells) {
    if (c.week !== week) continue;
    pickCounts.set(c.team, (pickCounts.get(c.team) ?? 0) + 1);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl">Games</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-game pick visibility. Picks unlock automatically when each game
          kicks off; the override forces a game open early (wrong kickoff
          time, moved game) or keeps it locked past kickoff. The public
          never sees a pick before its game is open — enforced in the
          database, not the page.
        </p>
      </div>
      <GamesControl
        week={week}
        weeks={weeks.map((w) => w.week)}
        games={games.filter((g) => g.week === week)}
        pickCounts={Object.fromEntries(pickCounts)}
      />
    </div>
  );
}
