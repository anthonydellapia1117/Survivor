import { requireAdmin } from "@/lib/auth";
import { AdminNav } from "@/components/admin/admin-nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return (
    <div className="space-y-5">
      <AdminNav />
      {children}
    </div>
  );
}
