import { readFileSync } from "node:fs";
import { defineConfig, type Options } from "tsup";

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

const { react, ...others } = entries;

const common: Options = {
  format: ["esm", "cjs"],
  dts: true,
  // dist/ wordt leeggemaakt door het build-script; clean hier zou parallelle builds wissen.
  clean: false,
  sourcemap: true,
  target: "es2022",
  treeshake: true,
  external: ["react", "react-dom", "@nestjs/common", "koffi"],
  define,
};

export default defineConfig([
  { ...common, entry: others },
  // React apart, met "use client" bovenaan (Next.js App Router).
  // treeshake uit: rollup zou de directive weghalen.
  { ...common, entry: { react }, treeshake: false, banner: { js: '"use client";' } },
  {
    // De bridge als commando: `npx dafke-eid`.
    entry: { cli: "src/node/cli.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    sourcemap: true,
    clean: false,
    external: ["koffi"],
    banner: { js: "#!/usr/bin/env node" },
    define,
  },
]);
