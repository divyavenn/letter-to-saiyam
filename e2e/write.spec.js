import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_ROOT } from "./env.js";

const DATE = "2026-11-05";
const mod = process.platform === "darwin" ? "Meta" : "Control";

const recipients = new WeakMap();

// Gives the test its own recipient, so parallel tests never share a folder,
// and reads back what the server wrote. File names are shown without the
// recipient and the random part, e.g. letter-2026-11-05-1.png.
async function mailbox(page, { taken = false } = {}) {
  const recipient = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  recipients.set(page, recipient);
  const folder = path.join(E2E_ROOT, "src/letters", recipient);
  if (taken) {
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `${DATE}.md`), "---\ndate: 2026-11-05\n---\n\nAlready here.\n");
  }
  const tidy = (text) =>
    text.replace(new RegExp(`letter-${recipient}-(\\d{4}-\\d{2}-\\d{2}(?:-\\d+)?)-[0-9a-f]{6}-`, "g"), "letter-$1-");
  const newest = () => {
    const files = readdirSync(folder).filter((name) => name !== `${DATE}.md` || !taken).sort();
    return files.at(-1);
  };
  return {
    recipient,
    markdown: () => tidy(readFileSync(path.join(folder, newest()), "utf8")),
    paths: () => {
      const photos = readdirSync(path.join(E2E_ROOT, "public/images"))
        .filter((name) => name.startsWith(`letter-${recipient}-`))
        .sort((a, b) => (a.includes("-cover.") ? -1 : b.includes("-cover.") ? 1 : a.localeCompare(b, "en", { numeric: true })))
        .map((name) => `public/images/${tidy(name)}`);
      return [...photos, `src/letters/${newest()}`];
    },
  };
}

async function openComposer(page) {
  await page.goto("/write");
  const editor = page.getByRole("textbox", { name: "Letter" });
  await expect(editor).toBeVisible();
  await retype(page, page.getByLabel("Date", { exact: true }), "11/5/2026");
  return editor;
}

// Clicks a printed detail and types over it, the way a person would.
async function retype(page, target, text, { save = "Enter" } = {}) {
  await target.click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type(text);
  if (save === "Enter") await page.keyboard.press("Enter");
  else await page.locator("body").click({ position: { x: 5, y: 5 } });
}

// Puts the caret on the blank line between the greeting and the sign-off.
async function writeBody(page, editor) {
  await editor.locator("p").nth(1).click();
}

async function pasteImage(editor, color = "#c97", { width = 800, height = 450 } = {}) {
  await editor.evaluate((element, [fill, w, h]) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    context.fillStyle = fill;
    context.fillRect(0, 0, w, h);
    const binary = atob(canvas.toDataURL("image/png").split(",")[1]);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "photo.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, [color, width, height]);
}

async function pasteData(editor, items) {
  await editor.evaluate((element, entries) => {
    const data = new DataTransfer();
    for (const [type, value] of Object.entries(entries)) data.setData(type, value);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, items);
}

async function send(page) {
  await page.getByLabel("Who it's for", { exact: true }).fill(recipients.get(page));
  await page.getByRole("button", { name: "send" }).click();
  await expect(page.getByText("Sent.")).toBeVisible();
}

const withoutStamp = (markdown) => markdown.replace(/^stamp: .+\n/m, "");

test("the defaults are filled in and the sign-off keeps its line break", async ({ page }) => {
  // There's already a letter for this person on this date, so this one is -2.
  const github = await mailbox(page, { taken: true });
  const editor = await openComposer(page);
  await expect(page.getByRole("group", { name: "to Saiyam. from Divya" })).toBeAttached();
  await expect(page.getByText("11/5/2026")).toBeVisible();
  await writeBody(page, editor);
  await page.keyboard.type("Hello.");
  await pasteImage(editor);
  await send(page);
  expect(github.markdown()).toMatch(/^stamp: [\w-]+\.svg$/m);
  expect(withoutStamp(github.markdown())).toBe(
    `---\ndate: ${DATE}\nto: Saiyam\nfrom: Divya\nimage: letter-${DATE}-2-1.png\n---\n\n` +
      `Dear Saiyam,\n\nHello.\n\n![](/images/letter-${DATE}-2-1.png)\n\nLove,\\\nDivya\n`,
  );
  expect(github.paths()).toEqual([`public/images/letter-${DATE}-2-1.png`, `src/letters/${DATE}-2.md`]);
});

test("selecting text shows a formatting tooltip", async ({ page }) => {
  await mailbox(page);
  const editor = await openComposer(page);
  const tooltip = page.getByRole("toolbar", { name: "Formatting" });
  await expect(tooltip).toHaveCount(0);
  await writeBody(page, editor);
  await page.keyboard.type("a lovely word");
  await editor.getByText("a lovely word").dblclick({ position: { x: 20, y: 5 } });
  await expect(tooltip).toBeVisible();
  await tooltip.getByRole("button", { name: "Bold (⌘B)" }).click();
  await expect(editor.locator("strong")).toHaveText("lovely");
  await expect(tooltip.getByRole("button", { name: "Bold (⌘B)" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tooltip).toHaveCount(0);
});

test("keyboard shortcuts format text", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  await writeBody(page, editor);
  await page.keyboard.type("plain ");
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type("bold");
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type(" ");
  await page.keyboard.press(`${mod}+i`);
  await page.keyboard.type("italic");
  await page.keyboard.press(`${mod}+i`);
  await page.keyboard.type(" ");
  await page.keyboard.press(`${mod}+Shift+s`);
  await page.keyboard.type("struck");
  await page.keyboard.press(`${mod}+Shift+s`);
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("next line");
  await page.keyboard.press("Enter");
  await page.keyboard.press(`${mod}+Shift+b`);
  await page.keyboard.type("a quote");
  await pasteImage(editor);
  await send(page);
  expect(github.markdown()).toContain("plain **bold** *italic* ~~struck~~\\\nnext line\n\n> a quote");
});

test("typed markdown and HTML stay literal, through a reload too", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  const literal = "**stars** # > <b>tag</b> &amp; ~tilde~ [x](y)";
  await writeBody(page, editor);
  await page.keyboard.type(literal);
  await expect(editor.locator("strong")).toHaveCount(0);
  await page.waitForTimeout(700);
  await page.reload();
  await expect(editor).toContainText(literal);
  await pasteImage(editor);
  await send(page);
  expect(github.markdown()).toContain(
    "\\*\\*stars\\*\\* # > \\<b>tag\\</b> \\&amp; \\~tilde\\~ \\[x\\](y)",
  );
});

// The clipboard is shared across the browser, so these can't run side by side.
test.describe("clipboard prefill", () => {
  test.describe.configure({ mode: "serial" });

  test("⌘K links a selection, prefilled from a copied URL", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const github = await mailbox(page);
    const editor = await openComposer(page);
    await page.evaluate(() => navigator.clipboard.writeText("glenkeane.com/films"));
    await writeBody(page, editor);
    await page.keyboard.type("watch this");
    for (let i = 0; i < 4; i += 1) await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press(`${mod}+k`);
    const url = page.getByLabel("Link URL", { exact: true });
    await expect(url).toHaveValue("https://glenkeane.com/films");
    await expect(page.getByLabel("Link text", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Enter");
    // Typing right after a link doesn't extend it.
    await page.keyboard.type(" now");
    await pasteImage(editor);
    await send(page);
    expect(github.markdown()).toContain("watch [this](https://glenkeane.com/films) now");
  });

  test("a copied sentence doesn't prefill the link field", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mailbox(page);
    const editor = await openComposer(page);
    await page.evaluate(() => navigator.clipboard.writeText("call me after dinner"));
    await writeBody(page, editor);
    await page.keyboard.press(`${mod}+k`);
    await expect(page.getByLabel("Link text", { exact: true })).toBeFocused();
    await page.waitForTimeout(200);
    await expect(page.getByLabel("Link URL", { exact: true })).toHaveValue("");
  });
});

test("⌘K with nothing selected inserts a labelled link", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  await writeBody(page, editor);
  await page.keyboard.type("Listen to ");
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type("Nepthali");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Link URL", { exact: true })).toBeFocused();
  await page.keyboard.type("youtube.com/watch?v=7peyXHKX9dw");
  await page.keyboard.press("Enter");
  await page.keyboard.type(".");
  await pasteImage(editor);
  await send(page);
  expect(github.markdown()).toContain("Listen to [Nepthali](https://youtube.com/watch?v=7peyXHKX9dw).");
});

test("editing a link changes its label and URL; clearing the URL unlinks it", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  await writeBody(page, editor);
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type("first");
  await page.keyboard.press("Enter");
  await page.keyboard.type("a.com");
  await page.keyboard.press("Enter");
  await page.keyboard.type(" and ");
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type("second");
  await page.keyboard.press("Enter");
  await page.keyboard.type("b.com");
  await page.keyboard.press("Enter");

  await editor.getByText("first").click();
  await page.keyboard.press(`${mod}+k`);
  await expect(page.getByLabel("Link text", { exact: true })).toHaveValue("first");
  await expect(page.getByLabel("Link URL", { exact: true })).toHaveValue("https://a.com/");
  await page.getByLabel("Link text", { exact: true }).fill("one");
  await page.getByLabel("Link URL", { exact: true }).fill("c.com");
  await page.keyboard.press("Enter");

  await editor.getByText("second").click();
  await page.keyboard.press(`${mod}+k`);
  await page.getByLabel("Link URL", { exact: true }).fill("");
  await page.keyboard.press("Enter");

  await pasteImage(editor);
  await send(page);
  expect(github.markdown()).toContain("[one](https://c.com/) and second\n");
});

test("unsafe links are refused", async ({ page }) => {
  await mailbox(page);
  const editor = await openComposer(page);
  await writeBody(page, editor);
  await page.keyboard.type("click");
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.type("javascript:alert(1)");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("That doesn't look like a link.");
  await expect(editor.locator("a")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await pasteData(editor, {
    "text/html": `<p><a href="javascript:alert(1)">pasted</a> <a href="https://ok.com">fine</a></p>`,
    "text/plain": "pasted fine",
  });
  await expect(editor.getByText("pasted")).toBeVisible();
  await expect(editor.locator("a")).toHaveCount(1);
  await expect(editor.locator("a")).toHaveAttribute("href", "https://ok.com");
});

test("pasting from Google Docs keeps formatting and drops styles", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  await writeBody(page, editor);
  await pasteData(editor, {
    "text/html":
      `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">` +
      `<p dir="ltr"><span style="font-weight:700;color:red">Docs bold</span><span> and </span>` +
      `<span style="font-style:italic;">italic</span><span style="font-size:30pt"> text</span></p>` +
      `<p dir="ltr"><span>Second paragraph</span></p><script>alert(1)</script></b>`,
    "text/plain": "Docs bold and italic text\n\nSecond paragraph",
  });
  await expect(editor.locator("[style]")).toHaveCount(0);
  await pasteImage(editor);
  await send(page);
  expect(github.markdown()).toContain("**Docs bold** and *italic* text\n\nSecond paragraph");
  expect(github.markdown()).not.toContain("alert");
});

test("plain-text paste: blank lines make paragraphs, single newlines make breaks", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  await writeBody(page, editor);
  await pasteData(editor, { "text/plain": "line one\nline two\n\nnew paragraph" });
  await pasteImage(editor);
  await send(page);
  expect(github.markdown()).toContain("line one\\\nline two\n\nnew paragraph");
});

test("typing after a photo starts a new line instead of joining the next one", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  await writeBody(page, editor);
  await page.keyboard.type("Before.");
  await page.keyboard.press("Enter");
  // Big enough to be shrunk before upload, which takes a moment.
  await pasteImage(editor, "#c97", { width: 4000, height: 3000 });
  await page.keyboard.type("After.");
  await send(page);
  expect(github.markdown()).toContain(`Before.\n\n![](/images/letter-${DATE}-1.jpg)\n\nAfter.\n\nLove,`);
});

test("a photo above the greeting is the cover alone; details and stamp survive a reload", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  await editor.locator("p").first().click();
  await page.keyboard.press("Home");
  await pasteImage(editor, "#123");
  await writeBody(page, editor);
  await page.locator(".ProseMirror p").filter({ hasText: /^$/ }).last().click();
  await page.keyboard.type("Two photos.");
  await pasteImage(editor, "#c97");
  await pasteImage(editor, "#345");
  await expect(editor.locator("img")).toHaveCount(3);

  await retype(page, page.getByLabel("Written at", { exact: true }), "the Presidio");
  await expect(page.getByLabel("Written at", { exact: true })).toHaveText("the Presidio");

  const stamp = page.getByRole("button", { name: /^Stamp: / });
  const before = await stamp.getAttribute("aria-label");
  await stamp.click();
  await expect(stamp).not.toHaveAttribute("aria-label", before);
  const chosen = (await stamp.getAttribute("aria-label")).match(/^Stamp: (.+)\. Change stamp$/)[1];

  await page.waitForTimeout(700);
  await page.reload();
  await expect(editor.locator("img")).toHaveCount(3);
  await expect(page.getByLabel("Written at", { exact: true })).toHaveText("the Presidio");
  await expect(stamp).toHaveAttribute("aria-label", `Stamp: ${chosen}. Change stamp`);

  await send(page);
  expect(github.paths()).toEqual([
    `public/images/letter-${DATE}-cover.png`,
    `public/images/letter-${DATE}-1.png`,
    `public/images/letter-${DATE}-2.png`,
    `src/letters/${DATE}.md`,
  ]);
  const markdown = github.markdown();
  expect(markdown).toContain(
    `location: the Presidio\nimage: letter-${DATE}-cover.png\nstamp: ${chosen.replace(/ /g, "-")}.svg\n---\n\nDear Saiyam,`,
  );
  expect(markdown).not.toContain("cover.png)");
});

test("holding ⌘Z doesn't wipe out the whole history", async ({ page }) => {
  await mailbox(page);
  const editor = await openComposer(page);
  await writeBody(page, editor);
  await page.keyboard.type("first");
  await page.waitForTimeout(700);
  await page.keyboard.type(" second");
  await page.keyboard.down(mod);
  await page.keyboard.down("z");
  await page.keyboard.down("z");
  await page.keyboard.down("z");
  await page.keyboard.up("z");
  await page.keyboard.up(mod);
  await expect(editor.locator("p").nth(1)).toHaveText("first");
});

test("to and from are retyped right on the envelope", async ({ page }) => {
  await mailbox(page);
  const editor = await openComposer(page);
  await retype(page, page.getByRole("button", { name: "to Saiyam. Edit" }), "Sai");
  await expect(page.getByRole("group", { name: "to Sai. from Divya" })).toBeAttached();
  await expect(editor.locator("p").first()).toHaveText("Dear Sai,");

  // Clicking away saves too; Escape puts back what was there.
  await retype(page, page.getByRole("button", { name: "from Divya. Edit" }), "D.", { save: "click" });
  await expect(page.getByRole("group", { name: "to Sai. from D." })).toBeAttached();
  await page.getByRole("button", { name: "from D.. Edit" }).click();
  await page.keyboard.type("oops");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "to Sai. from D." })).toBeAttached();
  await expect(page.getByRole("textbox", { name: "From" })).toHaveCount(0);
});

test("the date is typed in place; nonsense is put back", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  const date = page.getByLabel("Date", { exact: true });
  await retype(page, date, "not a date");
  await expect(date).toHaveText("11/5/2026");
  await retype(page, date, "Nov 7, 2026");
  await expect(date).toHaveText("11/7/2026");
  await retype(page, date, "11/6/26", { save: "click" });
  await expect(date).toHaveText("11/6/2026");
  await writeBody(page, editor);
  await pasteImage(editor);
  await send(page);
  expect(github.markdown()).toContain("date: 2026-11-06");
  expect(github.paths()).toContain("src/letters/2026-11-06.md");
});

test("an emptied location falls back to the placeholder and is left out", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  const location = page.getByLabel("Written at", { exact: true });
  await retype(page, location, "Lisbon");
  await retype(page, location, "   ");
  await expect(location).toHaveText("");
  await expect(location).toHaveAttribute("data-placeholder", "somewhere on a lonely blue planet");
  await writeBody(page, editor);
  await pasteImage(editor);
  await send(page);
  expect(github.markdown()).not.toContain("location:");
});

test("sending needs someone to send to, and a photo", async ({ page }) => {
  await mailbox(page);
  await openComposer(page);
  await page.getByRole("button", { name: "send" }).click();
  await expect(page.getByRole("status")).toContainText("Who's it for?");
  await page.getByLabel("Who it's for", { exact: true }).fill("Ranju");
  await page.getByRole("button", { name: "send" }).click();
  await expect(page.getByRole("status")).toContainText("Paste in a photo");
});

test("names complete as you type, like tags in the logbook", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  const who = page.getByRole("combobox", { name: "Who it's for" });
  await who.click();
  await page.keyboard.type("sa");
  // The best match finishes the word inline; Tab takes it.
  await expect(who).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("option", { name: "saiyam" })).toBeAttached();
  await page.keyboard.press("Tab");
  await expect(who).toHaveValue("saiyam");
  await expect(who).toHaveAttribute("aria-expanded", "false");

  // Escape lets a suggestion go; a name nobody has yet is just typed out.
  await who.fill("");
  await page.keyboard.type("sa");
  await page.keyboard.press("Escape");
  await expect(who).toHaveAttribute("aria-expanded", "false");
  await expect(who).toHaveValue("sa");

  // The letter's own "to" line is separate from who it's sent to.
  await writeBody(page, editor);
  await page.keyboard.type("Hello.");
  await pasteImage(editor);
  await send(page);
  expect(github.markdown()).toContain("to: Saiyam");
  await page.getByRole("link", { name: "see their stack" }).click();
  await expect(page).toHaveURL(new RegExp(`/${github.recipient}$`));
  await expect(page.getByRole("article", { name: /Postcard to Saiyam/ })).toBeVisible();

  // Next time, the composer remembers who you last wrote to.
  await openComposer(page);
  await expect(page.getByLabel("Who it's for", { exact: true })).toHaveValue(github.recipient);
});

test("download all letters gives a zip of every letter, photo and their details", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  await writeBody(page, editor);
  await page.keyboard.type("For the archive.");
  await pasteImage(editor);
  await send(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "download all letters" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^letters-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = await download.path();
  const files = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n");
  expect(files).toContain("letters.json");
  expect(files).toContain("letters/saiyam/2026-11-05.md");
  expect(files).toContain(`letters/${github.recipient}/${DATE}.md`);
  const { letters } = JSON.parse(execFileSync("unzip", ["-p", zip, "letters.json"], { encoding: "utf8" }));
  const mine = letters.find((letter) => letter.recipient === github.recipient);
  expect(mine).toMatchObject({ date: DATE, to: "Saiyam", from: "Divya" });
  expect(files).toContain(`images/${mine.cover}`);
});

test("changing the stamp moves the address straight to its new place", async ({ page }) => {
  await mailbox(page);
  await openComposer(page);
  for (let tap = 0; tap < 3; tap++) {
    const positions = await page.evaluate(async () => {
      const where = () => {
        const line = document.querySelector('[role="group"][aria-label^="to "] > span');
        const box = line?.getBoundingClientRect();
        return box ? `${Math.round(box.left)},${Math.round(box.top)}` : "none";
      };
      const seen = [where()];
      document.querySelector('img[role="button"]').click();
      const start = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          if (where() !== seen.at(-1)) seen.push(where());
          performance.now() - start < 600 ? requestAnimationFrame(tick) : resolve();
        };
        requestAnimationFrame(tick);
      });
      return seen;
    });
    // At most one move: from where it was to where it belongs, with no detour.
    expect(positions.length, positions.join(" → ")).toBeLessThanOrEqual(2);
    expect(positions).not.toContain("none");
  }
});

test("the location's placeholder can be edited like any words", async ({ page }) => {
  const github = await mailbox(page);
  const editor = await openComposer(page);
  const location = page.getByLabel("Written at", { exact: true });
  await location.click();
  await expect.poll(() => page.evaluate(() => getSelection().toString().toLowerCase())).toBe("somewhere on a lonely blue planet");
  await page.keyboard.press("ArrowRight");
  for (let i = 0; i < "lonely blue planet".length; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("sunny ");
  await page.keyboard.press("Enter");
  await writeBody(page, editor);
  await pasteImage(editor);
  await send(page);
  expect(github.markdown()).toContain("location: somewhere on a sunny lonely blue planet");
});
