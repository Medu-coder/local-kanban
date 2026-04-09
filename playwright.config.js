import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        "node e2e/helpers/prepare-fixture-cli.js && HOST=127.0.0.1 PORT=4011 KANBAN_CONFIG_PATH=.e2e/projects.json node server/index.js",
      url: "http://127.0.0.1:4011/api/health",
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command:
        "VITE_PORT=4173 VITE_API_PROXY_TARGET=http://127.0.0.1:4011 npx vite --host 127.0.0.1 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
