import { expect, test } from "@playwright/test";

test("a recipient's page shows their postcards", async ({ page }) => {
  await page.goto("/saiyam");
  await expect(page.getByRole("article", { name: /Postcard to Saiyam/ })).toBeVisible();
});

test("the bare site and unknown pages are a blank envelope", async ({ page }) => {
  for (const url of ["/", "/nobody-here", "/write/not-a-page"]) {
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

test("each page can download its letters as markdown, photos and a PDF", async ({ page }) => {
  await page.goto("/saiyam");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "download letters" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("letters-for-saiyam.zip");
  const { execFileSync } = await import("node:child_process");
  const files = execFileSync("unzip", ["-Z1", await download.path()], { encoding: "utf8" }).trim().split("\n");
  expect(files).toEqual(
    expect.arrayContaining([
      "letters-for-saiyam/letters.pdf",
      "letters-for-saiyam/letters/2026-11-05.md",
      "letters-for-saiyam/images/seed.png",
    ]),
  );
  // Downloading doesn't flip or move the postcards.
  await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", /postcard front/);
});

test("an open letter's text can be selected", async ({ page }) => {
  await page.goto("/saiyam");
  const card = page.getByRole("article").first();
  const box = await card.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 40);
  await expect(card).toHaveAttribute("aria-label", /letter back/);
  await page.waitForTimeout(600);
  const words = await page.locator("p:visible", { hasText: "A seeded letter." }).first().boundingBox();
  await page.mouse.move(words.x + 2, words.y + words.height / 2);
  await page.mouse.down();
  await page.mouse.move(words.x + words.width - 2, words.y + words.height / 2, { steps: 10 });
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection().toString())).toContain("seeded letter");
  await expect(card).toHaveAttribute("aria-label", /letter back/);
});
