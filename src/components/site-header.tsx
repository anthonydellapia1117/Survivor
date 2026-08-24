"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/grid", label: "Grid" },
  { href: "/schedule", label: "Schedule" },
  { href: "/teams", label: "Teams" },
  { href: "/entries", label: "Entries" },
  { href: "/lynne", label: "Lynne" },
  { href: "/2025", label: "2025" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // Overflow affordance: fade the right edge while more links hide off-screen.
  const [moreRight, setMoreRight] = useState(false);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () =>
      setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

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
        <div className="relative min-w-0 flex-1 self-stretch">
          <nav
            ref={navRef}
            className="-mb-px flex h-full items-stretch gap-1 overflow-x-auto"
          >
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
          {moreRight ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-end bg-gradient-to-l from-background to-transparent pr-0.5 text-xs text-muted-foreground"
            >
              ›
            </span>
          ) : null}
        </div>
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
