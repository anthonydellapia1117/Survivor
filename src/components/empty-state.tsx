export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface/50 px-6 py-16 text-center">
      <p className="text-lg font-medium">{title}</p>
      {detail ? (
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}
