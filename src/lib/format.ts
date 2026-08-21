const ET = "America/New_York";

export function formatEtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: ET,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatEtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: ET,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Sep 8, 12:00 PM ET" */
export function formatDeadline(iso: string): string {
  return `${formatEtDateTime(iso)} ET`;
}
