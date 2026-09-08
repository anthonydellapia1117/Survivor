import { requireAdmin } from "@/lib/auth";
import { getAdminData } from "@/lib/data/admin";
import { AdminNav } from "@/components/admin/admin-nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  // The open queue count rides on the Now tab from every admin page. A count
  // query, no rows fetched; if the queue table is unavailable the badge
  // simply stays off.
  let queueCount = 0;
  try {
    queueCount = await getAdminData().countPendingActions();
  } catch {
    queueCount = 0;
  }
  return (
    <div className="space-y-5">
      <AdminNav queueCount={queueCount} />
      {children}
    </div>
  );
}
