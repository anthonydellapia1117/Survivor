import type { Metadata } from "next";
import { getAdminData } from "@/lib/data/admin";
import { PaymentsClient } from "@/components/admin/payments/payments-client";

export const metadata: Metadata = { title: "Payments" };

export default async function AdminPaymentsPage() {
  const data = getAdminData();
  const [payments, owners] = await Promise.all([
    data.listPayments(),
    data.listOwners(),
  ]);
  return <PaymentsClient payments={payments} owners={owners} />;
}
