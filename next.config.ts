import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

function revision(args: string[], fallback: string) {
  try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return fallback; }
}
const nextConfig: NextConfig = {
  output: "standalone",
  // Inlined into the office bundle: identifies what this build actually serves.
  env: {
    NEXT_PUBLIC_PREVIEW_BRANCH: process.env.DEPLOY_BRANCH ?? revision(["branch", "--show-current"], "release"),
    NEXT_PUBLIC_PREVIEW_COMMIT: process.env.DEPLOY_COMMIT ?? revision(["rev-parse", "--short", "HEAD"], "unknown"),
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
