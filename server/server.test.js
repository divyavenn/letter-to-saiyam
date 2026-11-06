import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { composerPath, createApp } from "./index.js";
import { isRecipientSlug, letterFiles, letterMessage, readLetterRequest, recipientSlug } from "./letters.js";
import { diskStorage, githubStorage } from "./storage.js";

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
  assert.equal(letterMessage("ranju", "2026-11-05"), "Add November 5 letter for ranju");
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

test("composer paths are URL-safe", () => {
  assert.equal(composerPath("my-long-secret-path-123"), "my-long-secret-path-123");
  assert.match(composerPath("B0jrphAPOY7pg92AN0c9MN4yecczLMdwnx4OkA1KFUk="), /^[0-9a-f]{32}$/);
  assert.equal(composerPath(""), "");
});

async function serve() {
  const root = await mkdtemp(path.join(tmpdir(), "letters-"));
  const dist = path.join(root, "dist");
  await mkdir(path.join(dist, "write"), { recursive: true });
  await writeFile(path.join(dist, "index.html"), "stack");
  await writeFile(path.join(dist, "write/index.html"), "composer");
  await mkdir(path.join(root, "src/letters/saiyam"), { recursive: true });
  await writeFile(path.join(root, "src/letters/saiyam/2026-11-05.md"), "---\ndate: 2026-11-05\n---\n\nHello");
  const app = createApp({ root, dist, writeKey: "secret-path-for-tests", storage: diskStorage(root) });
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

test("the composer and its API need the secret path", async (t) => {
  const site = await serve();
  t.after(site.close);
  assert.equal(await fetch(`${site.base}/write/secret-path-for-tests/`).then((r) => r.text()), "composer");
  for (const url of ["/write", "/write/", "/write/index.html", "/write/guess"]) {
    const response = await fetch(site.base + url);
    assert.equal(response.status, 404, url);
    assert.equal(await response.text(), "stack", url);
  }
  assert.equal((await fetch(`${site.base}/api/recipients`)).status, 403);
  const listed = await fetch(`${site.base}/api/recipients`, { headers: { "x-write-key": "secret-path-for-tests" } });
  assert.deepEqual(await listed.json(), { recipients: ["saiyam"] });
});

test("sending writes the letter, taking the next name when the date is used", async (t) => {
  const site = await serve();
  t.after(site.close);
  const send = (key, recipient) =>
    fetch(`${site.base}/api/letters`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-write-key": key },
      body: JSON.stringify({ recipient, fields: FIELDS, images: { a: image }, document: letterBody(p(text("Dear you,")), photo("a")) }),
    });
  assert.equal((await send("wrong", "saiyam")).status, 403);

  const first = await send("secret-path-for-tests", "Saiyam");
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { recipient: "saiyam", slug: "2026-11-05-2", url: "/saiyam" });
  const second = await send("secret-path-for-tests", "Ranju");
  assert.deepEqual(await second.json(), { recipient: "ranju", slug: "2026-11-05", url: "/ranju" });

  assert.deepEqual((await readdir(path.join(site.root, "src/letters/saiyam"))).sort(), ["2026-11-05-2.md", "2026-11-05.md"]);
  const markdown = await readFile(path.join(site.root, "src/letters/ranju/2026-11-05.md"), "utf8");
  const [, photoPath] = markdown.match(/!\[\]\((\/images\/[^)]+)\)/);
  const served = await fetch(site.base + photoPath);
  assert.equal(served.status, 200);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), PNG);
  assert.equal((await fetch(`${site.base}/api/letters/ranju`).then((r) => r.json())).letters.length, 1);
});

test("GitHub storage commits everything at once, then mirrors it to disk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "letters-gh-"));
  const calls = [];
  const fakeFetch = async (url, { method = "GET", body } = {}) => {
    const route = url.replace("https://api.github.com/repos/me/letters", "");
    calls.push(`${method} ${route}`);
    const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
    if (route.startsWith("/contents/")) return json({ message: "Not Found" }, 404);
    if (route === "/git/blobs") return json({ sha: `blob-${JSON.parse(body).content.length}` }, 201);
    if (route === "/git/ref/heads/main") return json({ object: { sha: "parent" } });
    if (route === "/git/commits/parent") return json({ sha: "parent", tree: { sha: "base" } });
    if (route === "/git/trees") return json({ sha: "tree" }, 201);
    if (route === "/git/commits") return json({ sha: "commit" }, 201);
    if (route === "/git/refs/heads/main") return json({});
    throw new Error(route);
  };
  const storage = githubStorage({ token: "t", repo: "me/letters", fetch: fakeFetch }, diskStorage(root));
  assert.equal(await storage.exists("src/letters/ranju/2026-11-05.md"), false);
  await storage.commit([{ path: "src/letters/ranju/2026-11-05.md", content: Buffer.from("hi") }], "Add letter");
  assert.deepEqual(calls, [
    "GET /contents/src/letters/ranju/2026-11-05.md?ref=main",
    "POST /git/blobs",
    "GET /git/ref/heads/main",
    "GET /git/commits/parent",
    "POST /git/trees",
    "POST /git/commits",
    "PATCH /git/refs/heads/main",
  ]);
  assert.equal(await readFile(path.join(root, "src/letters/ranju/2026-11-05.md"), "utf8"), "hi");
});
