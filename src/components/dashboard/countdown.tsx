"use client";

import { useEffect, useState } from "react";

function remaining(target: number): string | null {
  const ms = target - Date.now();
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s % 60}s`;
  return `${m}m ${s % 60}s`;
}

export function Countdown({ deadlineIso }: { deadlineIso: string }) {
  const target = new Date(deadlineIso).getTime();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setText(remaining(target));
    const id = setInterval(() => setText(remaining(target)), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (text === null) {
    return <span className="text-muted-foreground">locked</span>;
  }
  return <span className="tabular-nums">{text}</span>;
}
