"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/owners", label: "Owners" },
  { href: "/admin/entries", label: "Entries" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/picks", label: "Picks" },
  { href: "/admin/import", label: "Import" },
  { href: "/admin/deadline", label: "Deadline" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
      {links.map((l) => {
        const active =
          l.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground",
              active && "bg-surface-2 text-foreground",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
