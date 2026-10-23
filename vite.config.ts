import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    projects: [
      {
        extends: true,
        plugins: [storybookTest({
          configDir: join(rootDir, ".storybook"),
          storybookScript: "pnpm storybook",
        })],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: "chromium" }],
            commands: {
              async pointerDown(context, selector: string) {
                const frame = await context.frame();

                await frame.locator(selector).hover();
                await context.page.mouse.down();
              },
              async pointerUp(context) {
                await context.page.mouse.up();
              },
              async setReducedMotion(context, reduced: boolean) {
                await context.page.emulateMedia({
                  reducedMotion: reduced ? "reduce" : "no-preference",
                });
              },
            },
          },
          setupFiles: ["./.storybook/vitest.setup.ts"],
        },
      },
    ],
  },
});
