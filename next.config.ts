import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The public board lives at /official; the old path stays reachable but
    // the name never appears in a player's address bar.
    return [{ source: "/lynne", destination: "/official", permanent: true }];
  },
};

export default nextConfig;
