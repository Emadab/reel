import { defineConfig } from "@playwright/test";

// Visual tests: fixture mode at 1440×900, compared against the handover's reference renders.
export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate: "../design/screenshots/{arg}-desktop{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled", caret: "hide" } },
  use: { baseURL: "http://localhost:5174", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" },
  webServer: { command: "npx vite --mode fixtures --port 5174 --strictPort", url: "http://localhost:5174", reuseExistingServer: true, timeout: 60_000 },
  reporter: [["list"]],
});
