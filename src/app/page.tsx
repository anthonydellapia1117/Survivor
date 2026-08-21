import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";

const cards = [
  { title: "Pot", value: "—", hint: "collected / due" },
  { title: "Alive", value: "—", hint: "of total entries" },
  { title: "Week", value: "—", hint: "next deadline" },
  { title: "Eliminated", value: "—", hint: "season to date" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">2026 NFL Survivor Pool</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live standings, picks, and pool health.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title} className="bg-surface">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {c.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl tabular-nums">{c.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <EmptyState
        title="Season not seeded yet"
        detail="The roster, payments, and weekly picks will appear here once the pool data is loaded."
      />
    </div>
  );
}
