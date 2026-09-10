import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  use: {
    baseURL: "http://127.0.0.1:6008",
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm exec storybook dev -p 6008 --ci",
    url: "http://127.0.0.1:6008",
    reuseExistingServer: !process.env.CI,
  },
});
