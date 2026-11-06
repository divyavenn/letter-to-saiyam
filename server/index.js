// The letters site on Render: each recipient's stack at /<slug>, the composer
// at a secret /write/<path>, and the API behind both.
import { createHash, timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { LetterError, isRecipientSlug, letterFiles, letterMessage, readLetterRequest } from "./letters.js";
import { diskStorage, githubStorage } from "./storage.js";

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Render's generated secrets are base64, which doesn't belong in a URL, so
// anything that isn't already URL-safe is hashed into the composer's path.
export function composerPath(secret) {
  if (!secret) return "";
  return /^[A-Za-z0-9_-]{16,}$/.test(secret)
    ? secret
    : createHash("sha256").update(secret).digest("hex").slice(0, 32);
}

function sameSecret(given, expected) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// root: where letters and photos live (the repo checkout on Render).
// writeKey: the composer's path segment; "" disables the key check (local dev only).
export function createApp({ root = CODE_ROOT, dist = path.join(CODE_ROOT, "dist"), writeKey, storage }) {
  const app = express();
  const lettersDir = path.join(root, "src/letters");
  const stampNames = () => readdir(path.join(CODE_ROOT, "src/stamps")).catch(() => []);

  const requireKey = (req, res, next) => {
    if (writeKey === "" || (writeKey && sameSecret(req.get("x-write-key"), writeKey))) return next();
    res.status(403).json({ error: "This page can't send letters." });
  };

  app.get("/healthz", (req, res) => res.send("ok"));

  // A recipient's letters. Unknown and empty pages look the same, so slugs
  // can't be discovered by probing.
  app.get("/api/letters/:recipient", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { recipient } = req.params;
    if (!isRecipientSlug(recipient)) return res.json({ letters: [] });
    const folder = path.join(lettersDir, recipient);
    const names = (await readdir(folder).catch(() => [])).filter((name) => name.endsWith(".md"));
    const letters = await Promise.all(
      names.map(async (name) => ({ id: name.replace(/\.md$/, ""), source: await readFile(path.join(folder, name), "utf8") })),
    );
    res.json({ letters });
  });

  app.get("/api/recipients", requireKey, async (req, res) => {
    const entries = await readdir(lettersDir, { withFileTypes: true }).catch(() => []);
    const recipients = entries.filter((entry) => entry.isDirectory() && isRecipientSlug(entry.name)).map((entry) => entry.name);
    res.json({ recipients: recipients.sort() });
  });

  app.post("/api/letters", requireKey, express.json({ limit: "80mb" }), async (req, res, next) => {
    try {
      const letter = readLetterRequest(req.body, await stampNames());
      let slug = letter.fields.date;
      for (let n = 2; await storage.exists(`src/letters/${letter.recipient}/${slug}.md`); n += 1) {
        if (n > 50) throw new LetterError("Too many letters on this date.");
        slug = `${letter.fields.date}-${n}`;
      }
      const { files } = letterFiles({ ...letter, slug });
      await storage.commit(files, letterMessage(letter.recipient, letter.fields.date));
      res.status(201).json({ recipient: letter.recipient, slug, url: `/${letter.recipient}` });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

  app.use("/images", express.static(path.join(root, "public/images"), { fallthrough: false, maxAge: "1y", immutable: true }));

  // The composer only exists at its secret path; /write itself looks like any other blank page.
  app.get("/write/:key", (req, res, next) => {
    if (writeKey && sameSecret(req.params.key, writeKey)) {
      return res.set("Cache-Control", "no-store").sendFile(path.join(dist, "write/index.html"));
    }
    next();
  });
  app.use("/write", (req, res) => res.status(404).sendFile(path.join(dist, "index.html")));

  app.use(express.static(dist, { index: false, maxAge: "1h" }));

  // Every other page is the stack; it reads the recipient from the URL and
  // shows a blank envelope when there's nothing there.
  app.get("/{*path}", (req, res) => res.sendFile(path.join(dist, "index.html")));

  app.use((error, req, res, next) => {
    if (error instanceof LetterError) return res.status(error.status).json({ error: error.message });
    if (error?.type === "entity.too.large") return res.status(413).json({ error: "That letter is too large to send." });
    console.error(error);
    res.status(500).json({ error: "The letter couldn't be sent. It's still here; try again in a moment." });
  });

  return app;
}

function start() {
  const root = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : CODE_ROOT;
  const production = process.env.NODE_ENV === "production";
  const writeKey = composerPath(process.env.WRITE_SECRET);
  const disk = diskStorage(root);
  const storage = process.env.GITHUB_TOKEN
    ? githubStorage(
        { token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPO, branch: process.env.GITHUB_BRANCH || "main" },
        disk,
      )
    : disk;

  if (production && !writeKey) console.warn("WRITE_SECRET isn't set, so sending letters is turned off.");
  if (production && storage.kind !== "github") {
    console.warn("GITHUB_TOKEN isn't set: letters are saved on this server only and lost on the next deploy.");
  }

  // Render sets PORT; locally the API sits beside Vite (see vite.config.js).
  const port = Number(process.env.PORT) || 5174;
  createApp({ root, writeKey: writeKey || (production ? undefined : ""), storage }).listen(port, () => {
    const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
    console.log(`Letters at ${base}/<recipient>`);
    if (writeKey) console.log(`Write letters at ${base}/write/${writeKey}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
