"use client";

// A team's logo beside its code, inline and sized to the text. If the image
// fails to load (or the code is not one of the 32) the code alone is shown -
// never a broken image, never an empty gap. The asset is local; nothing here
// fetches from ESPN.

import { useState } from "react";
import { logoPath } from "@/lib/team-logos";
import { TEAM_NAME } from "@/lib/standing";
import { cn } from "@/lib/utils";

export function TeamLabel({ abbr, className }: { abbr: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = logoPath(abbr);
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {src && !failed ? (
        // 1em square: the same height as the text beside it, whatever size that is.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          aria-hidden
          width={96}
          height={96}
          decoding="async"
          loading="lazy"
          className="inline-block h-[1em] w-[1em] shrink-0 object-contain align-[-0.1em]"
          onError={() => setFailed(true)}
        />
      ) : null}
      <span title={TEAM_NAME[abbr]}>{abbr}</span>
    </span>
  );
}
