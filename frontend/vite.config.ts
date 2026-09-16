import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const commitHash = (() => {
  try {
    return execSync("git rev-parse --short=6 HEAD").toString().trim().slice(0, 6);
  } catch {
    return (process.env.VITE_COMMIT_HASH || "").slice(0, 6);
  }
})();

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
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
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
