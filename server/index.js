// The letters site on Render: each recipient's stack at /<slug>, the composer
// at /write, and the API behind both. Letters are files on
// Render's persistent disk (DATA_ROOT); locally, in .data/, which works the same way.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { writeArchive, writeRecipientArchive } from "./archive.js";
import { LetterError, isRecipientSlug, letterFiles, readLetterRequest } from "./letters.js";
import { CODE_ROOT, dataRoot } from "./paths.js";
import { copyMissing, diskStorage } from "./storage.js";


// root: where letters and photos live (the disk on Render, .data/ locally).
export function createApp({ root = CODE_ROOT, dist = path.join(CODE_ROOT, "dist"), storage }) {
  const app = express();
  const lettersDir = path.join(root, "src/letters");
  const stampNames = () => readdir(path.join(CODE_ROOT, "src/stamps")).catch(() => []);


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

  // Someone's own letters to keep: markdown, photos and a PDF, as one zip.
  // Like the page itself, the slug is the key.
  app.get("/api/letters/:recipient/download", async (req, res, next) => {
    const { recipient } = req.params;
    const folder = path.join(lettersDir, recipient);
    const hasLetters = isRecipientSlug(recipient) && (await readdir(folder).catch(() => [])).some((name) => name.endsWith(".md"));
    if (!hasLetters) return res.status(404).json({ error: "No letters here." });
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="letters-for-${recipient}.zip"`,
      "Cache-Control": "no-store",
    });
    try {
      await writeRecipientArchive(root, recipient, res);
    } catch (error) {
      if (res.headersSent) res.destroy(error);
      else next(error);
    }
  });

  app.get("/api/recipients", async (req, res) => {
    const entries = await readdir(lettersDir, { withFileTypes: true }).catch(() => []);
    const recipients = entries.filter((entry) => entry.isDirectory() && isRecipientSlug(entry.name)).map((entry) => entry.name);
    res.json({ recipients: recipients.sort() });
  });

  app.post("/api/letters", express.json({ limit: "80mb" }), async (req, res, next) => {
    try {
      const letter = readLetterRequest(req.body, await stampNames());
      let slug = letter.fields.date;
      for (let n = 2; await storage.exists(`src/letters/${letter.recipient}/${slug}.md`); n += 1) {
        if (n > 50) throw new LetterError("Too many letters on this date.");
        slug = `${letter.fields.date}-${n}`;
      }
      const { files } = letterFiles({ ...letter, slug });
      await storage.commit(files);
      res.status(201).json({ recipient: letter.recipient, slug, url: `/${letter.recipient}` });
    } catch (error) {
      next(error);
    }
  });

  // Everything, for safekeeping: a zip of every letter, photo and letters.json.
  app.get("/api/archive", async (req, res, next) => {
    const day = new Date().toISOString().slice(0, 10);
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="letters-${day}.zip"`,
      "Cache-Control": "no-store",
    });
    try {
      await writeArchive(root, res);
    } catch (error) {
      if (res.headersSent) res.destroy(error);
      else next(error);
    }
  });

  app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

  app.use("/images", express.static(path.join(root, "public/images"), { fallthrough: false, maxAge: "1y", immutable: true }));

  app.get(["/write", "/write/"], (req, res) => {
    res.set("Cache-Control", "no-store").sendFile(path.join(dist, "write/index.html"));
  });

  app.use(express.static(dist, { index: false, maxAge: "1h" }));

  // Every other page is the stack; it reads the recipient from the URL and
  // shows a blank envelope when there's nothing there.
  app.get("/{*path}", (req, res) => res.sendFile(path.join(dist, "index.html")));

  app.use((error, req, res, next) => {
    if (error instanceof LetterError) return res.status(error.status).json({ error: error.message });
    if (error?.type === "entity.too.large") return res.status(413).json({ error: "That letter is too large to send." });
    if (error?.status === 404) return res.status(404).end();
    console.error(error);
    res.status(500).json({ error: "The letter couldn't be sent. It's still here; try again in a moment." });
  });

  return app;
}

async function start() {
  const root = dataRoot();
  const production = process.env.NODE_ENV === "production";

  // Bring over letters committed to the repo that the disk doesn't have yet.
  const copied = await copyMissing(CODE_ROOT, root);
  if (copied.length) console.log(`Copied ${copied.length} files from the repo into ${root}`);

  if (production && root === CODE_ROOT) {
    console.warn("DATA_ROOT isn't set: letters sent now are lost on the next deploy. Point it at the persistent disk.");
  }

  // Render sets PORT; locally the API sits beside Vite, which sets PUBLIC_URL.
  const port = Number(process.env.PORT) || 5174;
  createApp({ root, storage: diskStorage(root) }).listen(port, () => {
    const base = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || `http://localhost:${port}`;
    console.log(`Letters at ${base}/<recipient>, e.g. ${base}/saiyam`);
    console.log(`Write letters at ${base}/write`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
