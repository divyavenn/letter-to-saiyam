// Letters and photos are files under one root: the persistent disk on Render,
// or the repo itself when running locally.
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export function diskStorage(root) {
  const resolve = (file) => {
    const full = path.resolve(root, file);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(`Refusing to write outside ${root}`);
    return full;
  };
  return {
    async exists(file) {
      return stat(resolve(file)).then(() => true, () => false);
    },
    async commit(files) {
      for (const { path: file, content } of files) {
        const full = resolve(file);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content);
      }
    },
  };
}

// The folders that hold letters and photos, relative to a root.
export const LETTER_FOLDERS = ["src/letters", "public/images"];

export async function walk(folder) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(folder, entry.name);
      return entry.isDirectory() ? walk(full) : entry.isFile() ? [full] : [];
    }),
  );
  return nested.flat();
}

// Letters committed to the repo (the originals, or ones added by hand) are
// copied onto the disk at startup. Anything already there is left alone, so
// the disk is never overwritten. Returns the paths copied.
export async function copyMissing(from, to) {
  if (path.resolve(from) === path.resolve(to)) return [];
  const copied = [];
  for (const folder of LETTER_FOLDERS) {
    for (const source of await walk(path.join(from, folder))) {
      const relative = path.relative(from, source);
      if (path.basename(relative).startsWith(".")) continue;
      const target = path.join(to, relative);
      if (await stat(target).then(() => true, () => false)) continue;
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      copied.push(relative);
    }
  }
  return copied;
}

