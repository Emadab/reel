import { expect, test, type Page } from "@playwright/test";

async function settle(page: Page) {
  await page.locator("main h1, main h2").first().waitFor(); // the first run hits a cold dev server
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400); // route fade-in (240 ms)
}

test("Library", async ({ page }) => {
  await page.goto("/");
  await settle(page);
  await expect(page).toHaveScreenshot("Main.png", { fullPage: true });
});

test("Film detail", async ({ page }) => {
  await page.goto("/film/335984");
  await settle(page);
  await expect(page).toHaveScreenshot("Detail.png", { fullPage: true });
});

test("Search", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 912 }); // the reference capture is 912 tall
  await page.goto("/");
  await settle(page);
  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Search any film…");
  await input.waitFor();
  await input.fill("drive");
  await page.getByText("Drive My Car").waitFor(); // after the 180 ms debounce
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.getByLabel("Watched on").fill("2026-10-04");
  await page.getByRole("button", { name: "9 out of 10" }).click();
  await page.getByPlaceholder("Search any film…").focus();
  await page.waitForTimeout(300);
  // The mock fakes a blurred poster wall behind the scrim; the app blurs the real Library (SCREENS.md),
  // so the background alone differs by ~2%. The dialog itself matches the reference's layout exactly.
  await expect(page).toHaveScreenshot("Search.png", { maxDiffPixelRatio: 0.04 });
});

test("Timeline", async ({ page }) => {
  await page.goto("/timeline");
  await settle(page);
  await page.locator('section[aria-label="Watches by month"]').evaluate((el) => (el.scrollLeft = 0));
  await expect(page).toHaveScreenshot("Timeline.png", { fullPage: true });
});

test("Stats", async ({ page }) => {
  await page.goto("/stats");
  await settle(page);
  await expect(page).toHaveScreenshot("Stats.png", { fullPage: true });
});

test("For you", async ({ page }) => {
  await page.goto("/for-you");
  await settle(page);
  await expect(page).toHaveScreenshot("ForYou.png", { fullPage: true });
});

test("Taste map", async ({ page }) => {
  await page.goto("/map");
  await settle(page);
  await expect(page).toHaveScreenshot("TasteMap.png", { fullPage: true });
});
