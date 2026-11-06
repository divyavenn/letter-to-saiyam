import { defineConfig, devices } from "@playwright/test";
import { PORT } from "./e2e/env.js";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the installed Chrome, so no browser download is needed.
    channel: "chrome",
    ...devices["Desktop Chrome"],
  },
  // The built site on the real server, with letters going to a scratch folder.
  webServer: {
    command: "npm run build && node e2e/serve.js",
    port: PORT,
    reuseExistingServer: false,
  },
});
