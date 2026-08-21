import { cn } from "@/lib/utils";
import { STATUS_DOT, STATUS_LABEL } from "@/lib/standing";
import type { EntryStatus } from "@/lib/data/types";

export function StatusDot({
  status,
  className,
}: {
  status: EntryStatus;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block size-2 rounded-full", STATUS_DOT[status], className)}
      title={STATUS_LABEL[status]}
      aria-label={STATUS_LABEL[status]}
    />
  );
}
