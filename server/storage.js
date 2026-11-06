// Where sent letters are written. On Render they're committed to GitHub (and
// mirrored onto the running server's disk so they show up before the redeploy);
// locally, without a GitHub token, they're just written to disk.
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export function diskStorage(root) {
  const resolve = (file) => {
    const full = path.resolve(root, file);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(`Refusing to write outside ${root}`);
    return full;
  };
  return {
    kind: "disk",
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

export function githubStorage({ token, repo, branch = "main", fetch = globalThis.fetch }, mirror) {
  const api = `https://api.github.com/repos/${repo}`;
  const request = async (route, { method = "GET", body } = {}) => {
    const response = await fetch(`${api}${route}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      const error = new Error(`GitHub ${method} ${route} failed (${response.status}): ${detail.message || ""}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  return {
    kind: "github",
    async exists(file) {
      try {
        await request(`/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${branch}`);
        return true;
      } catch (error) {
        if (error.status === 404) return false;
        throw error;
      }
    },
    // All files land in one commit; retried if someone else pushed meanwhile.
    async commit(files, message) {
      const tree = await Promise.all(
        files.map(async ({ path: file, content }) => {
          const blob = await request("/git/blobs", {
            method: "POST",
            body: { content: Buffer.from(content).toString("base64"), encoding: "base64" },
          });
          return { path: file, mode: "100644", type: "blob", sha: blob.sha };
        }),
      );

      for (let attempt = 0; ; attempt += 1) {
        const ref = await request(`/git/ref/heads/${branch}`);
        const parent = await request(`/git/commits/${ref.object.sha}`);
        const newTree = await request("/git/trees", { method: "POST", body: { base_tree: parent.tree.sha, tree } });
        const commit = await request("/git/commits", {
          method: "POST",
          body: { message, tree: newTree.sha, parents: [parent.sha] },
        });
        try {
          await request(`/git/refs/heads/${branch}`, { method: "PATCH", body: { sha: commit.sha } });
          break;
        } catch (error) {
          if (error.status !== 422 || attempt >= 2) throw error;
        }
      }

      await mirror?.commit(files, message);
    },
  };
}
