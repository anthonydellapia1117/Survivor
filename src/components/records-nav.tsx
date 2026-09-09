"use client";

// The two pages under Records: the roster (this group's entries, as the
// Entries page was) and the 2025 archive. Anthony named the parent Records on
// 2026-09-09 and will rename it if it reads wrong; the subpages are unchanged.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const RECORDS_PAGES = [
  { href: "/records/roster", label: "Roster" },
  { href: "/records/2025", label: "2025" },
] as const;

export function RecordsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Records" className="flex gap-1 rounded-lg border border-border bg-surface p-0.5 text-sm w-fit">
      {RECORDS_PAGES.map((p) => {
        const active = pathname === p.href || pathname.startsWith(p.href + "/");
        return (
          <Link
            key={p.href}
            href={p.href}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium transition-colors duration-150",
              active ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
