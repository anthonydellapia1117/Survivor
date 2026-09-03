import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { WeeksEditor } from "@/components/admin/weeks-editor";

export const metadata: Metadata = { title: "Weeks" };

export default async function WeeksPage() {
  const weeks = await getData().getWeeks();
  const unconfirmed = weeks.filter((w) => !w.confirmed).length;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl">Week deadlines</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A pick&apos;s deadline follows the day its team plays, in every week
          including Week 1. Two boundaries are stored per week and the rest
          derive from them: a Wednesday game closes a day before the early
          deadline, a Thursday game at it, a Friday game a day after, and
          Sat–Mon games at the late deadline. So moving the early deadline moves
          the Wednesday and Friday cutoffs with it. A week holding a Friday game
          will refuse a late deadline less than a day after the early one,
          because the late boundary is also the full lock. The missed-pick sweep
          waits for the late deadline and refuses unconfirmed weeks. Times are
          Eastern.
        </p>
      </div>
      {unconfirmed > 0 ? (
        <p className="rounded-md border border-tie/40 bg-tie/10 px-3 py-2 text-sm text-tie">
          {unconfirmed} of {weeks.length} deadlines still unconfirmed.
        </p>
      ) : (
        <p className="text-sm text-win">All deadlines confirmed.</p>
      )}
      <WeeksEditor weeks={weeks} />
    </div>
  );
}
