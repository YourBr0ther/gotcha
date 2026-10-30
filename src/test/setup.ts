/**
 * Runs before every test file. The database module loads .env so the suite
 * can reach the local Postgres, and that file may hold a real NanoGPT key.
 * Tests must never spend it or depend on the network, so the key is removed
 * here unless a live run is explicitly requested.
 */
// Set to empty rather than deleted: process.loadEnvFile() in the db module
// fills only variables that are absent, and an empty key reads as unconfigured.
if (process.env.GOTCHA_LIVE_TESTS !== "1") {
  process.env.NANOGPT_API_KEY = "";
  process.env.GOTCHA_STT_URL = "";
}
