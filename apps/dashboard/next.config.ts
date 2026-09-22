import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "redis"],
  transpilePackages: ["@agentmeter/config", "@agentmeter/contracts"],
};

export default config;
