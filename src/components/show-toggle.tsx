"use client";

// The persistent ALIVE / OUT / ALL segmented toggle (Part B). Selection
// lives in the URL (?show=) so views are shareable, and in localStorage so
// the choice survives navigation and reload. ALIVE is the first-visit
// default.

import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  isShowMode,
  SHOW_STORAGE_KEY,
  type ShowCounts,
  type ShowMode,
} from "@/lib/alive";
import { cn } from "@/lib/utils";

export function useShowMode(): [ShowMode, (m: ShowMode) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlMode = params.get("show");
  const mode: ShowMode = isShowMode(urlMode) ? urlMode : "alive";

  const setMode = useCallback(
    (m: ShowMode) => {
      try {
        localStorage.setItem(SHOW_STORAGE_KEY, m);
      } catch {
        /* storage unavailable — URL still carries the choice */
      }
      const next = new URLSearchParams(params.toString());
      if (m === "alive") next.delete("show");
      else next.set("show", m);
      router.replace(next.size ? `${pathname}?${next}` : pathname, {
        scroll: false,
      });
    },
    [params, pathname, router],
  );

  // First visit without a ?show= param: restore the remembered choice.
  useEffect(() => {
    if (urlMode !== null) return;
    try {
      const saved = localStorage.getItem(SHOW_STORAGE_KEY);
      if (isShowMode(saved) && saved !== "alive") setMode(saved);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [mode, setMode];
}

const LABEL: Record<ShowMode, string> = {
  alive: "ALIVE",
  out: "OUT",
  all: "ALL",
};

export function ShowToggle({
  mode,
  counts,
  onChange,
}: {
  mode: ShowMode;
  counts: ShowCounts;
  onChange: (m: ShowMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Show alive, eliminated, or all entries"
      className="inline-flex rounded-lg border border-border bg-surface p-0.5"
    >
      {(["alive", "out", "all"] as ShowMode[]).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => onChange(m)}
          className={cn(
            "flex h-9 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold tracking-wide transition-colors duration-150",
            mode === m
              ? m === "out"
                ? "bg-loss/20 text-loss"
                : "bg-surface-2 text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LABEL[m]}
          <span className="tabular-nums opacity-70">{counts[m]}</span>
        </button>
      ))}
    </div>
  );
}
