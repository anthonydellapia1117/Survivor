import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Owners, entries, payments, picks, imports, and the deadline sweep.
        </p>
      </div>
      <EmptyState
        title="Admin arrives in Phase 5"
        detail="Auth and the write surfaces are built after the public read path."
      />
    </div>
  );
}
