"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

export function RecapView({
  week,
  weeks,
  subject,
  text,
  html,
}: {
  week: number;
  weeks: number[];
  subject: string;
  text: string;
  html: string;
}) {
  const router = useRouter();
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl">Weekly recap</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The email body I forward to the group — Lynne&apos;s three buckets,
          the week&apos;s losses, who is alive, and the next deadline. Copy
          either version and paste into Gmail.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={String(week)}
          onValueChange={(v) => router.push(`/admin/recap?week=${v}`)}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {weeks.map((w) => (
              <SelectItem key={w} value={String(w)}>
                Week {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Subject: <span className="font-medium text-foreground">{subject}</span>
        </span>
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Plain text</h2>
          <CopyButton value={text} label="Copy text" />
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-4 font-mono text-xs leading-relaxed">
          {text}
        </pre>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">HTML</h2>
          <CopyButton value={html} label="Copy HTML" />
        </div>
        <div
          className="rounded-lg border border-border bg-surface p-4 text-sm [&_h2]:text-lg [&_ul]:list-disc [&_ul]:pl-5"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </section>
    </div>
  );
}
