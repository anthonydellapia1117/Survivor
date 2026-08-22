import type { Metadata } from "next";
import { getAdminData } from "@/lib/data/admin";
import { QuickAdd } from "@/components/admin/quick-add";

export const metadata: Metadata = { title: "Quick add" };

export default async function QuickPage() {
  const owners = await getAdminData().listOwners();
  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-2xl">Quick add</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Built for the phone: find an owner, add entries, record the payment.
        </p>
      </div>
      <QuickAdd owners={owners} />
    </div>
  );
}
