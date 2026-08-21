import type { Metadata } from "next";
import { getData } from "@/lib/data";
import { DeadlineSweep } from "@/components/admin/deadline-sweep";

export const metadata: Metadata = { title: "Deadline sweep" };

export default async function DeadlinePage() {
  const weeks = await getData().getWeeks();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl">Deadline sweep</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A missed pick is an automatic loss at the deadline — no confirmation,
          no grace period, no bye rescue. The sweep never runs without your
          click: preview first, then commit. Running it twice changes nothing.
        </p>
      </div>
      <DeadlineSweep weeks={weeks} />
    </div>
  );
}
