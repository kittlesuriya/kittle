import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      core: path.resolve(__dirname, "../core/src"),
      "kittle-core/domain": path.resolve(__dirname, "../core/src/domain"),
      "kittle-core/ports": path.resolve(__dirname, "../core/src/ports"),
      "kittle-core/entity": path.resolve(__dirname, "../core/src/entity"),
      "kittle-core/execution": path.resolve(__dirname, "../core/src/execution"),
      "kittle-core/operation": path.resolve(__dirname, "../core/src/operation"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
})
