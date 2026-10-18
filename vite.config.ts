import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// base "./" keeps asset paths relative, so the same build works at
// username.github.io/penpost/ and at a custom domain root.
export default defineConfig(({ mode }) => ({
  base: "./",
  // Lets the app tell whether this bundle already has stories that finished at a given time (src/lib/curate.ts).
  define: { __PENPOST_BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [react(), ...(mode === "single" ? [viteSingleFile()] : [])],
  build: {
    outDir: mode === "single" ? "dist-single" : "dist",
    assetsInlineLimit: mode === "single" ? 100_000_000 : 4096,
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
}));
