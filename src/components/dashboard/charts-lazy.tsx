"use client";

// Recharts is the heaviest client dependency; loading it after hydration
// keeps the dashboard's first paint and main-thread work light.

import dynamic from "next/dynamic";

export const SurvivalCurveLazy = dynamic(
  () => import("./survival-curve").then((m) => ({ default: m.SurvivalCurve })),
  {
    ssr: false,
    loading: () => (
      <div className="h-56 w-full animate-pulse rounded-md bg-surface-2" />
    ),
  },
);

export const SurvivalSparklineLazy = dynamic(
  () =>
    import("./survival-curve").then((m) => ({ default: m.SurvivalSparkline })),
  { ssr: false, loading: () => <div className="h-8 w-full" /> },
);

export const PickDistributionLazy = dynamic(
  () =>
    import("./pick-distribution").then((m) => ({
      default: m.PickDistribution,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-40 w-full animate-pulse rounded-md bg-surface-2" />
    ),
  },
);
