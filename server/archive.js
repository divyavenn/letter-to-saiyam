// "Download all letters": every recipient's letters with their frontmatter,
// all the photos, and letters.json listing each letter's details.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { lettersPdf, photoFile } from "./pdf.js";
import { walk } from "./storage.js";

// Same rules as the site's reader: "key: value" lines between --- fences.
export function readFrontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { fields: {}, body: source.trim() };
  const fields = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { fields, body: source.slice(match[0].length).trim() };
}

function photosIn(fields, body) {
  const photos = [...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((match) => match[1]);
  return [...new Set([fields.image, ...photos].filter(Boolean).map((src) => src.replace(/^\/?images\//, "")))];
}

export async function letterIndex(root) {
  const lettersDir = path.join(root, "src/letters");
  const files = (await walk(lettersDir)).filter((file) => file.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (file) => {
      const [recipient, name] = path.relative(lettersDir, file).split(path.sep);
      const { fields, body } = readFrontmatter(await readFile(file, "utf8"));
      return {
        recipient,
        letter: name.replace(/\.md$/, ""),
        file: `letters/${recipient}/${name}`,
        date: fields.date || null,
        to: fields.to || null,
        from: fields.from || null,
        location: fields.location || null,
        stamp: fields.stamp || null,
        cover: fields.image || null,
        photos: photosIn(fields, body),
      };
    }),
  );
}

// Streams the zip to `output` (an HTTP response).
export async function writeArchive(root, output) {
  const index = await letterIndex(root);
  const zip = archiver("zip", { zlib: { level: 6 } });
  const done = new Promise((resolve, reject) => {
    zip.on("error", reject);
    output.on("close", resolve);
    output.on("finish", resolve);
  });
  zip.pipe(output);
  zip.append(`${JSON.stringify({ exported: new Date().toISOString(), letters: index }, null, 2)}\n`, {
    name: "letters.json",
  });
  for (const entry of index) {
    zip.append(createReadStream(path.join(root, "src/letters", entry.recipient, `${entry.letter}.md`)), { name: entry.file });
  }
  for (const photo of await walk(path.join(root, "public/images"))) {
    const name = path.relative(path.join(root, "public/images"), photo);
    if (!name.startsWith(".")) zip.append(createReadStream(photo), { name: `images/${name}` });
  }
  await zip.finalize();
  await done;
}

// What someone downloads from their own page: their letters as markdown (with
// photo links that work inside the zip), their photos, and letters.pdf.
export async function writeRecipientArchive(root, recipient, output) {
  const folder = path.join(root, "src/letters", recipient);
  const names = (await walk(folder)).filter((file) => file.endsWith(".md")).sort();
  const letters = await Promise.all(
    names.map(async (file) => {
      const source = await readFile(file, "utf8");
      return { file: path.basename(file), source, ...readFrontmatter(source) };
    }),
  );
  letters.sort((a, b) => String(a.fields.date).localeCompare(String(b.fields.date)) || a.file.localeCompare(b.file));

  // Their name as the letters address them, e.g. "Saiyam" rather than "saiyam".
  const counts = new Map();
  for (const { fields } of letters) if (fields.to) counts.set(fields.to, (counts.get(fields.to) || 0) + 1);
  const name = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || recipient;

  const top = `letters-for-${recipient}`;
  const zip = archiver("zip", { zlib: { level: 6 } });
  const done = new Promise((resolve, reject) => {
    zip.on("error", reject);
    output.on("close", resolve);
    output.on("finish", resolve);
  });
  zip.pipe(output);
  zip.append(await lettersPdf(root, name, letters), { name: `${top}/letters.pdf` });

  const photos = new Set();
  for (const letter of letters) {
    zip.append(letter.source.replace(/\]\(\/images\//g, "](../images/"), { name: `${top}/letters/${letter.file}` });
    for (const photo of photosIn(letter.fields, letter.body)) photos.add(photo);
  }
  for (const photo of photos) {
    const file = photoFile(root, photo);
    const exists = file && (await stat(file).then((info) => info.isFile(), () => false));
    if (exists) zip.append(createReadStream(file), { name: `${top}/images/${path.basename(file)}` });
  }
  await zip.finalize();
  await done;
}
