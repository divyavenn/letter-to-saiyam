import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // In development the letters API runs separately (npm run dev starts both).
  server: {
    proxy: { "/api": "http://127.0.0.1:5174" },
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
