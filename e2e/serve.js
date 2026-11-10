// The real server, writing letters to a scratch folder instead of GitHub.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createApp } from "../server/index.js";
import { diskStorage } from "../server/storage.js";
import { E2E_ROOT, PORT } from "./env.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

await rm(E2E_ROOT, { recursive: true, force: true });
await mkdir(path.join(E2E_ROOT, "src/letters/saiyam"), { recursive: true });
await mkdir(path.join(E2E_ROOT, "public/images"), { recursive: true });
await writeFile(path.join(E2E_ROOT, "public/images/seed.png"), PNG);
await writeFile(
  path.join(E2E_ROOT, "src/letters/saiyam/2026-11-05.md"),
  "---\ndate: 2026-11-05\nto: Saiyam\nfrom: Divya\nimage: seed.png\n---\n\nDear Saiyam,\n\nA seeded letter.\n",
);

createApp({ root: E2E_ROOT, storage: diskStorage(E2E_ROOT) }).listen(PORT, () => {
  console.log(`e2e server on ${PORT}`);
});
