import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { PicksEntry } from "@/components/admin/picks/picks-entry";

export const metadata: Metadata = { title: "Picks" };

export default async function PicksPage() {
  const data = getData();
  const [entries, weeks, cells] = await Promise.all([
    data.getEntries(),
    data.getWeeks(),
    data.getGridCells(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl">Picks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Picks lock at each week&apos;s deadline — anything entered after it is
          flagged late automatically. Re-entering a pick supersedes the old one,
          never edits it. Picking a team an entry already used is a warning,
          never a block.
        </p>
      </div>
      <PicksEntry entries={entries} weeks={weeks} cells={cells} />
    </div>
  );
}
