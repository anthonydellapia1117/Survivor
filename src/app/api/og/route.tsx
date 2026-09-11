// Dynamic share card: HER pool's two published headline figures, and nothing
// else. Set by Anthony on 2026-09-11.
//
// THE MONEY RULE HERE IS NOT "no money". This card used to say so, and that
// was written before her figures were public. What is admin-only is THIS
// GROUP's finances - collected, due, outstanding, the margin, the
// recruited-vs-free split - and none of that is here. Her pool-wide pot is the
// one dollar figure that is public by design, entered on /admin exactly as she
// publishes it, and Total in Pool is her count of the whole pool.
//
// TWO THINGS CAME OFF. "121 of 121 entries alive" is an OUR-GROUP figure: it
// is what Anthony manages, not what a person following the link came to see,
// and it reads the same every week until somebody dies - the same reasoning
// that took Entries and Alive off the dashboard. And the countdown went
// because a share card is scraped once and cached: a lock time baked into an
// image is wrong within hours and then stays wrong.
//
// A figure she has not published is left off rather than shown as zero, which
// is poolStats()'s rule and the reason this reads it rather than formatting
// its own.

import { ImageResponse } from "next/og";
import { getData } from "@/lib/data";
import { poolStats } from "@/lib/master-list";

export const runtime = "nodejs";

export async function GET() {
  const data = getData();
  const pot = await data.getPot();
  // Her four, filtered to the two that head the card. Read through poolStats
  // so this cannot drift from the dashboard strip or the Master List.
  const wanted = ["Total in Pool", "Total Payout"];
  const figures = poolStats(pot).filter((f) => wanted.includes(f.label));

  return new ImageResponse(
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

      <div style={{ display: "flex", gap: 72 }}>
        {figures.map((f) => (
          <div
            key={f.label}
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            <div style={{ display: "flex", fontSize: 34, color: "#9BA1A8" }}>
              {f.label}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 104,
                fontWeight: 700,
                color: "#4ADE80",
              }}
            >
              {f.value}
            </div>
          </div>
        ))}
      </div>
    </div>,
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
