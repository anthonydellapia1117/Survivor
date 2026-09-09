import type { ReactNode } from "react";
import { RecordsNav } from "@/components/records-nav";

export default function RecordsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <RecordsNav />
      {children}
    </div>
  );
}
