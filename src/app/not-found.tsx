import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl">Not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        That page or entry doesn&apos;t exist. It may have been removed, or the
        link is wrong.
      </p>
      <Link href="/" className="text-sm font-medium text-primary hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
