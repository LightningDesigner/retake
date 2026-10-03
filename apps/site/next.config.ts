import type { NextConfig } from "next"

const config: NextConfig = {
  // `next dev` shouldn't write files into the project.
  agentRules: false,
  // No Next badge in the corner in dev: the page looks as it does deployed.
  devIndicators: false,
}

export default config
