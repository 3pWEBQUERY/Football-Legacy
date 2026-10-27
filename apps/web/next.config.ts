import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@fl/sim", "@fl/game", "@fl/i18n"],
  serverExternalPackages: ["pg"],
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
