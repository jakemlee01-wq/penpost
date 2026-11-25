import { defineConfig } from "vitest/config";

// base "./" keeps asset paths relative, so the build works at penpost.co and on a preview path.
export default defineConfig({
  base: "./",
  build: { outDir: "dist" },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
