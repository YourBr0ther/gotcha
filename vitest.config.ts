import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "packages/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
