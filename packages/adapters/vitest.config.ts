import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      core: path.resolve(__dirname, "../core/src"),
      "kittle-core/foundation": path.resolve(__dirname, "../core/src/foundation"),
      "kittle-core/foundation/errors": path.resolve(__dirname, "../core/src/foundation/errors"),
      "kittle-core/foundation/canonicalJson": path.resolve(__dirname, "../core/src/foundation/canonicalJson"),
      "kittle-core/foundation/requestContext": path.resolve(__dirname, "../core/src/foundation/requestContext"),
      "kittle-core/foundation/filterFieldMeta": path.resolve(__dirname, "../core/src/foundation/filterFieldMeta"),
      "kittle-core/foundation/validation": path.resolve(__dirname, "../core/src/foundation/validation"),
      "kittle-core/foundation/abac": path.resolve(__dirname, "../core/src/foundation/abac"),
      "kittle-core/foundation/abacTierDecision": path.resolve(__dirname, "../core/src/foundation/abacTierDecision"),
      "kittle-core/foundation/policyTierResolver": path.resolve(__dirname, "../core/src/foundation/policyTierResolver"),
      "kittle-core/foundation/operationServices": path.resolve(__dirname, "../core/src/foundation/operationServices"),
      "kittle-core/foundation/definitionIntegrity": path.resolve(__dirname, "../core/src/foundation/definitionIntegrity"),
      "kittle-core/cache": path.resolve(__dirname, "../core/src/cache"),
      "kittle-core/cache/cacheService": path.resolve(__dirname, "../core/src/cache/cacheService"),
      "kittle-core/rate-limit": path.resolve(__dirname, "../core/src/rate-limit"),
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
