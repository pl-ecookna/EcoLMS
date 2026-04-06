import type { NextConfig } from "next";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "../..");

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
