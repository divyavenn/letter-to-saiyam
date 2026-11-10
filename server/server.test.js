import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "./index.js";
import { isRecipientSlug, letterFiles, readLetterRequest, recipientSlug } from "./letters.js";
import { copyMissing, diskStorage } from "./storage.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const p = (...content) => ({ type: "paragraph", content });
const text = (value) => ({ type: "text", text: value });
const photo = (imageId) => ({ type: "image", attrs: { src: "blob:x", imageId } });
const letterBody = (...blocks) => ({ type: "doc", content: blocks });
const image = { type: "image/png", data: PNG.toString("base64") };
const FIELDS = { date: "2026-11-05", to: "Ranju", from: "Divya", location: "", stamp: "japan-mark.svg" };

test("recipient slugs come from names and avoid the site's own paths", () => {
  assert.equal(recipientSlug("Ranju"), "ranju");
  assert.equal(recipientSlug("  Sidd Mehta! "), "sidd-mehta");
  assert.equal(recipientSlug("Zoë"), "zoe");
  assert.equal(isRecipientSlug("saiyam"), true);
  for (const taken of ["write", "api", "images", "assets", "", "-x", "a/b"]) assert.equal(isRecipientSlug(taken), false, taken);
});

test("a letter becomes markdown plus photos with unguessable names", () => {
  const { files, markdown } = letterFiles(
    { recipient: "ranju", slug: "2026-11-05", fields: FIELDS, images: { a: image, b: image },
      document: letterBody(photo("a"), p(text("Dear Ranju,")), photo("b"), p(text("Love,"))) },
    "abc123",
  );
  assert.deepEqual(files.map((file) => file.path), [
    "public/images/letter-ranju-2026-11-05-abc123-cover.png",
    "public/images/letter-ranju-2026-11-05-abc123-1.png",
    "src/letters/ranju/2026-11-05.md",
  ]);
  assert.equal(
    markdown,
    "---\ndate: 2026-11-05\nto: Ranju\nfrom: Divya\nimage: letter-ranju-2026-11-05-abc123-cover.png\nstamp: japan-mark.svg\n---\n\n" +
      "Dear Ranju,\n\n![](/images/letter-ranju-2026-11-05-abc123-1.png)\n\nLove,\n",
  );
});

test("bad requests are refused with a reason", () => {
  const ok = { recipient: "Ranju", fields: FIELDS, document: letterBody(p(text("hi"))), images: {} };
  assert.throws(() => readLetterRequest({ ...ok, recipient: "write" }, []), /Choose who/);
  assert.throws(() => readLetterRequest({ ...ok, fields: { ...FIELDS, date: "2026-02-30" } }, []), /date/);
  assert.equal(readLetterRequest(ok, []).fields.stamp, "", "unknown stamps are dropped");
  const request = readLetterRequest(ok, ["japan-mark.svg"]);
  assert.throws(() => letterFiles({ ...request, slug: "2026-11-05" }), /Paste in a photo/);
  assert.throws(
    () => letterFiles({ ...request, slug: "x", document: letterBody(p(text("Hi")), photo("a")), images: { a: { type: "text/html", data: "PHA+" } } }),
    /didn't come through/,
  );
});

async function serve() {
  const root = await mkdtemp(path.join(tmpdir(), "letters-"));
  const dist = path.join(root, "dist");
  await mkdir(path.join(dist, "write"), { recursive: true });
  await writeFile(path.join(dist, "index.html"), "stack");
  await writeFile(path.join(dist, "write/index.html"), "composer");
  await mkdir(path.join(root, "src/letters/saiyam"), { recursive: true });
  await writeFile(path.join(root, "src/letters/saiyam/2026-11-05.md"), "---\ndate: 2026-11-05\n---\n\nHello");
  const app = createApp({ root, dist, storage: diskStorage(root) });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://localhost:${server.address().port}`;
  return { root, base, close: () => server.close() };
}

test("each page only gets its own letters, and slugs can't be probed", async (t) => {
  const site = await serve();
  t.after(site.close);
  const letters = (slug) => fetch(`${site.base}/api/letters/${slug}`).then((r) => r.json());
  assert.equal((await letters("saiyam")).letters.length, 1);
  assert.deepEqual(await letters("nobody"), { letters: [] });
  assert.deepEqual(await letters("..%2Fsaiyam"), { letters: [] });
  assert.equal((await fetch(`${site.base}/api/nope`)).status, 404);
  assert.equal(await fetch(`${site.base}/saiyam`).then((r) => r.text()), "stack");
  assert.equal(await fetch(`${site.base}/`).then((r) => r.text()), "stack");
});

test("the composer is at /write, with or without the slash", async (t) => {
  const site = await serve();
  t.after(site.close);
  for (const url of ["/write", "/write/"]) assert.equal(await fetch(site.base + url).then((r) => r.text()), "composer", url);
  assert.deepEqual(await fetch(`${site.base}/api/recipients`).then((r) => r.json()), { recipients: ["saiyam"] });
});

test("sending writes the letter, taking the next name when the date is used", async (t) => {
  const site = await serve();
  t.after(site.close);
  const send = (recipient) =>
    fetch(`${site.base}/api/letters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipient, fields: FIELDS, images: { a: image }, document: letterBody(p(text("Dear you,")), photo("a")) }),
    });
  const first = await send("Saiyam");
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { recipient: "saiyam", slug: "2026-11-05-2", url: "/saiyam" });
  const second = await send("Ranju");
  assert.deepEqual(await second.json(), { recipient: "ranju", slug: "2026-11-05", url: "/ranju" });

  assert.deepEqual((await readdir(path.join(site.root, "src/letters/saiyam"))).sort(), ["2026-11-05-2.md", "2026-11-05.md"]);
  const markdown = await readFile(path.join(site.root, "src/letters/ranju/2026-11-05.md"), "utf8");
  const [, photoPath] = markdown.match(/!\[\]\((\/images\/[^)]+)\)/);
  const served = await fetch(site.base + photoPath);
  assert.equal(served.status, 200);
  assert.equal((await fetch(`${site.base}/images/not-a-photo.jpg`)).status, 404);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), PNG);
  assert.equal((await fetch(`${site.base}/api/letters/ranju`).then((r) => r.json())).letters.length, 1);
});

test("repo letters are copied onto the disk, never over what's there", async () => {
  const repo = await mkdtemp(path.join(tmpdir(), "letters-repo-"));
  const disk = await mkdtemp(path.join(tmpdir(), "letters-disk-"));
  await mkdir(path.join(repo, "src/letters/saiyam"), { recursive: true });
  await mkdir(path.join(repo, "public/images"), { recursive: true });
  await writeFile(path.join(repo, "src/letters/saiyam/2026-01-11.md"), "from the repo");
  await writeFile(path.join(repo, "src/letters/saiyam/2026-06-28.md"), "older copy");
  await writeFile(path.join(repo, "public/images/cover.png"), PNG);
  await writeFile(path.join(repo, "public/images/.DS_Store"), "junk");
  await mkdir(path.join(disk, "src/letters/saiyam"), { recursive: true });
  await writeFile(path.join(disk, "src/letters/saiyam/2026-06-28.md"), "edited on the server");

  const copied = await copyMissing(repo, disk);
  assert.deepEqual(copied.sort(), ["public/images/cover.png", "src/letters/saiyam/2026-01-11.md"]);
  assert.equal(await readFile(path.join(disk, "src/letters/saiyam/2026-06-28.md"), "utf8"), "edited on the server");
  assert.deepEqual(await copyMissing(repo, disk), [], "a second deploy copies nothing");
  assert.deepEqual(await copyMissing(repo, repo), [], "running from the repo itself is a no-op");
});

test("download all letters: a zip of letters, photos and their details", async (t) => {
  const site = await serve();
  t.after(site.close);
  await mkdir(path.join(site.root, "public/images"), { recursive: true });
  await writeFile(path.join(site.root, "public/images/seed.png"), PNG);
  await writeFile(
    path.join(site.root, "src/letters/saiyam/2026-11-05.md"),
    "---\ndate: 2026-11-05\nto: Saiyam\nfrom: Divya\nlocation: the Presidio\nimage: seed.png\nstamp: japan-mark.svg\n---\n\nDear Saiyam,\n\n![](/images/seed.png)\n",
  );

  const response = await fetch(`${site.base}/api/archive`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /attachment; filename="letters-\d{4}-\d{2}-\d{2}\.zip"/);
  const zipPath = path.join(site.root, "out.zip");
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));

  const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(listing, ["images/seed.png", "letters.json", "letters/saiyam/2026-11-05.md"]);
  const manifest = JSON.parse(execFileSync("unzip", ["-p", zipPath, "letters.json"], { encoding: "utf8" }));
  assert.deepEqual(manifest.letters, [
    {
      recipient: "saiyam",
      letter: "2026-11-05",
      file: "letters/saiyam/2026-11-05.md",
      date: "2026-11-05",
      to: "Saiyam",
      from: "Divya",
      location: "the Presidio",
      stamp: "japan-mark.svg",
      cover: "seed.png",
      photos: ["seed.png"],
    },
  ]);
  assert.deepEqual(execFileSync("unzip", ["-p", zipPath, "images/seed.png"]), PNG);
});

test("each person can download their own letters as markdown, photos and a PDF", async (t) => {
  const site = await serve();
  t.after(site.close);
  await mkdir(path.join(site.root, "public/images"), { recursive: true });
  await writeFile(path.join(site.root, "public/images/seed.png"), PNG);
  await writeFile(path.join(site.root, "public/images/someone-elses.png"), PNG);
  await writeFile(
    path.join(site.root, "src/letters/saiyam/2026-11-05.md"),
    "---\ndate: 2026-11-05\nto: Saiyam\nfrom: Divya\nimage: seed.png\n---\n\nDear Saiyam, **bold** and [a link](https://example.com).\n\n![](/images/seed.png)\n",
  );

  assert.equal((await fetch(`${site.base}/api/letters/nobody/download`)).status, 404);
  const response = await fetch(`${site.base}/api/letters/saiyam/download`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /filename="letters-for-saiyam\.zip"/);
  const zipPath = path.join(site.root, "theirs.zip");
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));

  const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(listing, [
    "letters-for-saiyam/images/seed.png",
    "letters-for-saiyam/letters.pdf",
    "letters-for-saiyam/letters/2026-11-05.md",
  ]);
  const markdown = execFileSync("unzip", ["-p", zipPath, "letters-for-saiyam/letters/2026-11-05.md"], { encoding: "utf8" });
  assert.match(markdown, /!\[\]\(\.\.\/images\/seed\.png\)/, "photo links work inside the zip");
  const pdf = execFileSync("unzip", ["-p", zipPath, "letters-for-saiyam/letters.pdf"]);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.includes("https://example.com"), "the letter's link is clickable in the PDF");
});
