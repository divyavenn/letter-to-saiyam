import { expect, test } from "@playwright/test";

test("a recipient's page shows their postcards", async ({ page }) => {
  await page.goto("/saiyam");
  await expect(page.getByRole("article", { name: /Postcard to Saiyam/ })).toBeVisible();
});

test("the bare site and unknown pages are a blank envelope", async ({ page }) => {
  for (const url of ["/", "/nobody-here", "/write", "/write/a-wrong-guess"]) {
    await page.goto(url);
    await expect(page.getByLabel("An envelope with nothing inside")).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
  }
});

test("a page only ever loads its own letters", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => request.url().includes("/api/") && requests.push(new URL(request.url()).pathname));
  await page.goto("/saiyam");
  await expect(page.getByRole("article").first()).toBeVisible();
  expect(requests).toEqual(["/api/letters/saiyam"]);
  // Nothing in the page's scripts gives away the letters or who else has a page.
  const scripts = await page.evaluate(() =>
    [...document.scripts].map((script) => script.src).filter((src) => src.startsWith(location.origin)),
  );
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of scripts) {
    const code = await page.evaluate((url) => fetch(url).then((response) => response.text()), src);
    expect(code).not.toContain("A seeded letter");
  }
});
