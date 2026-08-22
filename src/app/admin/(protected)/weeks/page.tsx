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
          Each week carries two windows derived from the verified 2026
          schedule: picks for Wed/Thu/Fri games lock at the early deadline,
          Sat–Mon games at the late one. Week 1 is Tuesday noon for every
          pick. The missed-pick sweep waits for the late deadline and refuses
          unconfirmed weeks. Times are Eastern.
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
