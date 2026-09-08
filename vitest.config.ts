import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // tsconfig keeps jsx: preserve for Next; a component under test needs the
  // automatic runtime so react-dom/server can render it in a test.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
  },
});
