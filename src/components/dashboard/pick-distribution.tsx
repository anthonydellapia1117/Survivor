"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SKIP_WEEK, TEAM_NAME } from "@/lib/standing";

interface Row {
  team: string;
  count: number;
  pct: number;
}

export function PickDistribution({ rows }: { rows: Row[] }) {
  const height = Math.max(120, rows.length * 34 + 30);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 0, right: 44, bottom: 0, left: 8 }}
        >
          <CartesianGrid
            stroke="var(--border)"
            strokeDasharray="3 3"
            horizontal={false}
          />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="team"
            width={44}
            tick={{ fill: "var(--foreground)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(t: string) => (t === SKIP_WEEK ? "BYE" : t)}
          />
          <Tooltip
            cursor={{ fill: "color-mix(in srgb, var(--primary) 8%, transparent)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--foreground)",
            }}
            formatter={(value, _name, item) => [
              `${value} picks (${(item?.payload as Row)?.pct}%)`,
              (item?.payload as Row)?.team === SKIP_WEEK
                ? "Bye"
                : (TEAM_NAME[(item?.payload as Row)?.team] ??
                  (item?.payload as Row)?.team),
            ]}
          />
          <Bar
            dataKey="count"
            radius={[2, 2, 2, 2]}
            barSize={18}
            isAnimationActive={false}
            label={{
              position: "right",
              fill: "var(--text-muted, #8A9099)",
              fontSize: 11,
            }}
          >
            {rows.map((r) => (
              <Cell key={r.team} fill="var(--primary)" fillOpacity={0.75} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
