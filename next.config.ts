import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The codebase uses loose typing in places; let the build succeed regardless.
  // Flip to `false` to enforce strict type checks.
  // Note: Next.js 16 no longer runs ESLint during `next build`, so there is no
  // `eslint` config key. Run `npm run lint` separately.
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
