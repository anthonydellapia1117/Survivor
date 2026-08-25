// Dynamic share card: live pool state, no money on it ever — the pot and
// every dollar figure are admin-only and must never reach a public
// surface, and this image is fetched by link scrapers with no auth.

import { ImageResponse } from "next/og";
import { getData } from "@/lib/data";
import { isAliveStatus } from "@/lib/alive";
import { LOCK_KIND_LABEL, nextLockBoundary } from "@/lib/dashboard";

export const runtime = "nodejs";

function deadlineText(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function GET() {
  const data = getData();
  const [entries, weeks] = await Promise.all([
    data.getEntries(),
    data.getWeeks(),
  ]);

  const total = entries.length;
  const alive = entries.filter((e) => isAliveStatus(e.status)).length;
  const next = nextLockBoundary(weeks, new Date());
  const weekNo = next?.week ?? weeks.at(-1)?.week ?? 18;
  const deadlineLine = next
    ? `${LOCK_KIND_LABEL[next.kind]} lock ${deadlineText(next.deadlineAt)} ET`
    : "Season complete";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#0B0D0F",
          backgroundImage:
            "radial-gradient(circle at 85% 15%, rgba(59,130,246,0.18), transparent 55%)",
          padding: "64px 72px",
          color: "#F4F5F6",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: 12,
              backgroundColor: "#3B82F6",
              color: "#FFFFFF",
              fontSize: 40,
              fontWeight: 700,
            }}
          >
            S
          </div>
          <div style={{ display: "flex", fontSize: 52, fontWeight: 700 }}>
            2026 NFL Survivor Pool
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 132, fontWeight: 700, color: "#4ADE80" }}>
            {alive}
          </div>
          <div style={{ display: "flex", fontSize: 44, color: "#9BA1A8" }}>
            of {total} entries alive
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", fontSize: 34, color: "#C8CDD3" }}>
            {deadlineLine}
          </div>
          <div
            style={{
              display: "flex",
              padding: "10px 26px",
              borderRadius: 999,
              border: "2px solid #3B82F6",
              color: "#7EB1FA",
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            Week {weekNo}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "cache-control":
          "public, max-age=0, s-maxage=900, stale-while-revalidate=3600",
      },
    },
  );
}
