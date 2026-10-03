import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./packages/eid/package.json", import.meta.url), "utf8"));

// Tests met een echte kaartlezer en eID: `npm run test:integration`. Niet in CI.
export default defineConfig({
  define: { __DAFKEDD_EID_VERSION__: JSON.stringify(pkg.version) },
  test: {
    include: ["tests/integration/**/*.int.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Eén kaartlezer: niets parallel.
    fileParallelism: false,
  },
});
