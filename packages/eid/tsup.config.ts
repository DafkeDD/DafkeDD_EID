import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const define = { __DAFKEDD_EID_VERSION__: JSON.stringify(pkg.version) };

/** Eén entry per subpad. Moet overeenkomen met "exports" in package.json (test: tests/structuur.test.ts). */
export const entries = {
  index: "src/core/index.ts",
  node: "src/node/index.ts",
  react: "src/react/index.ts",
  server: "src/server/index.ts",
  nestjs: "src/nestjs/index.ts",
  mock: "src/mock/index.ts",
};

export default defineConfig([
  {
    entry: entries,
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "es2022",
    treeshake: true,
    external: ["react", "@nestjs/common", "koffi"],
    define,
  },
  {
    // De bridge als commando: `npx dafke-eid`.
    entry: { cli: "src/node/cli.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    sourcemap: true,
    external: ["koffi"],
    banner: { js: "#!/usr/bin/env node" },
    define,
  },
]);
