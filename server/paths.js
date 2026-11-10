// Where the code is, and where letters live.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Locally, letters live in .data/ (git-ignored), standing in for Render's disk.
export function dataRoot() {
  if (process.env.DATA_ROOT) return path.resolve(process.env.DATA_ROOT);
  return process.env.NODE_ENV === "production" ? CODE_ROOT : path.join(CODE_ROOT, ".data");
}
