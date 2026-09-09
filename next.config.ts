import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The public list lives at /master-list; the older paths stay reachable
    // and the runner's name never appears in a player's address bar.
    return [
      { source: "/lynne", destination: "/master-list", permanent: true },
      { source: "/official", destination: "/master-list", permanent: true },
      // Records is the parent of the roster (the old Entries page) and the
      // 2025 archive (2026-09-09); the old paths stay reachable.
      { source: "/entries", destination: "/records/roster", permanent: true },
      { source: "/2025", destination: "/records/2025", permanent: true },
      { source: "/records", destination: "/records/roster", permanent: false },
    ];
  },
};

export default nextConfig;
