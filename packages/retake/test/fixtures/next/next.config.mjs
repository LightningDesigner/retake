// Next 16 sends React's debug data over its HMR socket unless this is off
// (F49). The fixture runs both ways: FIXTURE_DEBUG_CHANNEL=1 turns it on.
export default {
  experimental: { reactDebugChannel: process.env.FIXTURE_DEBUG_CHANNEL === "1" },
  devIndicators: false,
  agentRules: false,
}
