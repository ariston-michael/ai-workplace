import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Inlined into the office bundle: identifies what this build actually serves.
  env: {
    NEXT_PUBLIC_PREVIEW_BRANCH: execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(),
    NEXT_PUBLIC_PREVIEW_COMMIT: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
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
