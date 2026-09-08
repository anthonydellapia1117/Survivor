import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The public list lives at /master-list; the older paths stay reachable
    // and the runner's name never appears in a player's address bar.
    return [
      { source: "/lynne", destination: "/master-list", permanent: true },
      { source: "/official", destination: "/master-list", permanent: true },
    ];
  },
};

export default nextConfig;
