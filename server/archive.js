// "Download all letters": every recipient's letters with their frontmatter,
// all the photos, and letters.json listing each letter's details.
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
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
