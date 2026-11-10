import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// /write (without the slash) opens the composer too, as it does on Render.
function composerAtWrite() {
  return {
    name: "composer-at-write",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [pathname, query] = req.url.split("?");
        if (pathname === "/write") req.url = `/write/${query ? `?${query}` : ""}`;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), composerAtWrite()],
  // In development the letters server runs separately (npm run dev starts
  // both). Photos come from it too, so they're read from wherever it keeps
  // letters (the repo, or DATA_ROOT), as on Render.
  server: {
    proxy: {
      "/api": "http://127.0.0.1:5174",
      "/images": "http://127.0.0.1:5174",
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        write: fileURLToPath(new URL("write/index.html", import.meta.url)),
      },
    },
  },
});
