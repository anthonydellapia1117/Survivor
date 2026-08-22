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
          Weeks 2–18 were seeded from the standard NFL pattern, not the real
          schedule — check each one against the released slate and confirm it.
          The missed-pick sweep refuses to run for an unconfirmed week, so an
          unchecked guess can never produce an automatic loss. Times are
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
