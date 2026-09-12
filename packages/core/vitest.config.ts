import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/__tests__/**", "src/**/*.d.ts"],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 94,
        branches: 92,
      },
    },
  },
})
