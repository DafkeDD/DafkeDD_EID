import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./packages/eid/package.json", import.meta.url), "utf8"));

// Unit-tests. React-tests (jsdom) komen in fase 4, integratietests met een echte lezer in fase 3.
export default defineConfig({
  define: { __DAFKEDD_EID_VERSION__: JSON.stringify(pkg.version) },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    restoreMocks: true,
  },
});
