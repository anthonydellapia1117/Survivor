"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/grid", label: "Grid" },
  { href: "/schedule", label: "Schedule" },
  { href: "/teams", label: "Teams" },
  { href: "/entries", label: "Entries" },
  { href: "/lynne", label: "Lynne" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-sm bg-primary text-xs font-semibold text-primary-foreground">
            S
          </span>
          <span className="hidden text-lg font-semibold sm:inline">
            Survivor 2026
          </span>
        </Link>
        <nav className="-mb-px flex h-full flex-1 items-stretch gap-1 overflow-x-auto">
          {links.map((l) => {
            const active =
              l.href === "/"
                ? pathname === "/"
                : pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "flex items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground",
                  active && "border-primary text-foreground",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/admin"
          className="text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
        >
          Admin
        </Link>
      </div>
    </header>
  );
}
