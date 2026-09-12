import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      core: path.resolve(__dirname, "../core/src"),
      "core/domain": path.resolve(__dirname, "../core/src/domain"),
      "core/ports": path.resolve(__dirname, "../core/src/ports"),
      "core/entity": path.resolve(__dirname, "../core/src/entity"),
      "core/execution": path.resolve(__dirname, "../core/src/execution"),
      "core/operation": path.resolve(__dirname, "../core/src/operation"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
})
