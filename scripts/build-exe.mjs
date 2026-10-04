#!/usr/bin/env node
/**
 * Bouwt dafke-eid als zelfstandig programma (Node "single executable application"): één bestand
 * met Node, de bridge en de koffi-addon. De gebruiker hoeft geen Node te hebben.
 *
 *   node scripts/build-exe.mjs                                   → dist-bin/dafke-eid-<os>-<arch>[.exe]
 *   node scripts/build-exe.mjs --origin https://app.voorbeeld.be → toegelaten websites inbakken (meermaals)
 *   node scripts/build-exe.mjs --auth-origin https://sso.x.be     → websites die mogen aanmelden met PIN
 *   node scripts/build-exe.mjs --token <geheim> --no-testpage    → token inbakken / testpagina uit
 *
 * Gebouwd vanuit de Node die dit script draait (process.execPath): bouw de Windows-.exe dus op
 * Windows, de Mac-versie op een Mac (lokaal of in GitHub Actions). Gebruik Node 22 of 24.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "packages", "eid");
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const { values } = parseArgs({
  options: {
    origin: { type: "string", multiple: true },
    "auth-origin": { type: "string", multiple: true },
    token: { type: "string" },
    "no-testpage": { type: "boolean" },
    out: { type: "string" },
  },
});

const platform = process.platform;
const arch = process.arch;
const osName = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : platform;
const exeName = `dafke-eid-${osName}-${arch}${platform === "win32" ? ".exe" : ""}`;
const outDir = resolve(values.out ?? join(ROOT, "dist-bin"));
const work = join(ROOT, "build", "sea", `${platform}-${arch}`);
const exe = join(outDir, exeName);
const version = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version;

const step = (message) => console.log(`\n▸ ${message}`);
function tryRun(command, args) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const pkgRequire = createRequire(join(PKG, "package.json"));

function koffiDir() {
  let dir = dirname(pkgRequire.resolve("koffi"));
  while (!existsSync(join(dir, "package.json")) || JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name !== "koffi") {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("koffi niet gevonden");
    dir = parent;
  }
  return dir;
}

function koffiAddon() {
  const req = createRequire(join(koffiDir(), "package.json"));
  const dir = dirname(req.resolve(`@koromix/koffi-${platform}-${arch}/package.json`));
  const addon = join(dir, `${platform}_${arch}`, "koffi.node");
  if (!existsSync(addon)) throw new Error(`koffi.node niet gevonden op ${addon}`);
  return addon;
}

const embedded = {};
if (values.origin?.length) embedded.origins = values.origin.flatMap((o) => o.split(",")).map((o) => o.trim()).filter(Boolean);
if (values["auth-origin"]?.length) embedded.authOrigins = values["auth-origin"].flatMap((o) => o.split(",")).map((o) => o.trim()).filter(Boolean);
if (values.token) embedded.token = values.token;
if (values["no-testpage"]) embedded.testpage = false;

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(outDir, { recursive: true });

step(`Bundelen (esbuild) — dafke-eid ${version} voor ${osName}-${arch}`);
const bundle = join(work, "dafke-eid.cjs");
await build({
  entryPoints: [join(PKG, "src", "node", "cli.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // De native koffi-pakketten zitten er als asset in, niet als code.
  external: ["@koromix/*"],
  // De ESM-build van koffi gebruikt import.meta.url; in een CJS-bundel de CJS-versie nemen.
  alias: { koffi: join(koffiDir(), "index.cjs") },
  define: {
    __DAFKEDD_EID_VERSION__: JSON.stringify(version),
    __DAFKEDD_EID_EMBEDDED__: JSON.stringify(JSON.stringify(embedded)),
  },
  legalComments: "none",
  logLevel: "warning",
});

step("SEA-blob maken");
const blob = join(work, "sea-prep.blob");
const seaConfig = join(work, "sea-config.json");
writeFileSync(
  seaConfig,
  JSON.stringify(
    { main: bundle, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets: { "koffi.node": koffiAddon() } },
    null,
    2,
  ),
);
try {
  execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });
} catch (error) {
  console.error(`\nSEA-blob maken mislukt met Node ${process.version}. Bouw met Node 22 of 24 (zoals in CI).`);
  throw error;
}

step(`Programma maken: ${exe}`);
rmSync(exe, { force: true });
copyFileSync(process.execPath, exe);
// De handtekening van Node klopt niet meer na het injecteren: eerst verwijderen.
if (platform === "win32") {
  if (!tryRun("signtool", ["remove", "/s", exe])) console.warn("  (signtool niet gevonden: handtekening niet verwijderd; het programma werkt wel)");
} else if (platform === "darwin") {
  tryRun("codesign", ["--remove-signature", exe]);
}
const postject = createRequire(join(ROOT, "package.json")).resolve("postject/dist/cli.js");
const postjectArgs = [postject, exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", SEA_FUSE];
if (platform === "darwin") postjectArgs.push("--macho-segment-name", "NODE_SEA");
execFileSync(process.execPath, postjectArgs, { stdio: "inherit" });
// macOS (zeker Apple Silicon) start geen programma zonder handtekening: ad-hoc ondertekenen.
// De echte ondertekening (Developer ID + notarisatie) gebeurt in de release-workflow.
if (platform === "darwin") execFileSync("codesign", ["--sign", "-", "--force", exe], { stdio: "inherit" });

step("Controleren");
const reported = execFileSync(exe, ["--version"], { encoding: "utf8" }).trim();
if (reported !== version) throw new Error(`Programma meldt versie "${reported}", verwacht "${version}"`);

const hash = createHash("sha256").update(readFileSync(exe)).digest("hex");
writeFileSync(`${exe}.sha256`, `${hash}  ${exeName}\n`);
const mb = (statSync(exe).size / 1024 / 1024).toFixed(1);
console.log(`\n✔ ${exe} (${mb} MB)\n  sha256 ${hash}`);
if (Object.keys(embedded).length) console.log(`  ingebakken: ${JSON.stringify({ ...embedded, ...(embedded.token ? { token: "***" } : {}) })}`);
