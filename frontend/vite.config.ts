import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** If a private overlay ships its own tab icons or OG card, copy them into
 *  dist. The committed default is always the Tresorpost padlock / Inter card
 *  in public/. Licensed fonts stay out of this repo. */
function privateFaviconOverride(): Plugin {
  const files = [
    "favicon.svg",
    "favicon.ico",
    "apple-touch-icon.png",
    "og.png",
  ];
  return {
    name: "private-favicon-override",
    writeBundle(options) {
      const dir = options.dir ?? path.resolve(import.meta.dirname, "dist");
      for (const name of files) {
        const src = path.resolve(import.meta.dirname, "src/brand/private", name);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(dir, name));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), privateFaviconOverride()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
