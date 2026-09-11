import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // ONE TABLE, at /grid (Anthony, 2026-09-11). The Master List and the Grid
    // rendered the same rows with different chrome, so they merged. Every
    // address that reached the list still reaches the table - the link is in
    // emails, in his messages and in people's history, and a 404 would strand
    // all of them. One hop each, not two, and the runner's name still never
    // appears in a player's address bar.
    return [
      { source: "/master-list", destination: "/grid", permanent: true },
      { source: "/lynne", destination: "/grid", permanent: true },
      { source: "/official", destination: "/grid", permanent: true },
      // Records is the parent of the roster (the old Entries page) and the
      // 2025 archive (2026-09-09); the old paths stay reachable.
      { source: "/entries", destination: "/records/roster", permanent: true },
      { source: "/2025", destination: "/records/2025", permanent: true },
      { source: "/records", destination: "/records/roster", permanent: false },
    ];
  },
};

export default nextConfig;
