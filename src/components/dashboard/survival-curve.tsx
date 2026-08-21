"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Point {
  week: number;
  remaining: number;
}

export function SurvivalCurve({ data, total }: { data: Point[]; total: number }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="week"
            tick={{ fill: "var(--text-muted, #8A9099)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tickFormatter={(w) => (w === 0 ? "Start" : `W${w}`)}
          />
          <YAxis
            domain={[0, total]}
            tick={{ fill: "var(--text-muted, #8A9099)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--foreground)",
            }}
            labelFormatter={(w) => (w === 0 ? "Season start" : `Week ${w}`)}
            formatter={(value) => [String(value), "remaining"]}
          />
          <Area
            type="stepAfter"
            dataKey="remaining"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#curveFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Tiny sparkline for the Eliminated stat card. */
export function SurvivalSparkline({ data }: { data: Point[] }) {
  if (data.length < 2) return null;
  return (
    <div className="h-8 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area
            type="stepAfter"
            dataKey="remaining"
            stroke="var(--loss)"
            strokeWidth={1.5}
            fill="transparent"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
