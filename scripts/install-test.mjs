#!/usr/bin/env node
/**
 * Installatietest (fase 9): installeert het gebouwde pakket zoals een gebruiker dat doet, in kopieën
 * van examples/next-app en examples/nest-api buiten de repo, en test de hele keten:
 *   website (Next.js) → nonce → programma (`dafke-eid --mock`) → token → server (Next.js én NestJS).
 * Daarnaast: oude TypeScript-instellingen (CommonJS + moduleResolution "node") vinden alle subpaden.
 *
 *   npm run test:install                 # bouwt eerst
 *   npm run test:install -- --skip-build
 *   npm run test:install -- --keep       # tijdelijke map niet opruimen
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const isWin = process.platform === "win32";
const PORTS = { next: 3100, nest: 3101, bridge: 47897 };
const SITE = `http://localhost:${PORTS.next}`;
const children = [];

const step = (text) => console.log(`\n▶ ${text}`);
function run(cmd, cmdArgs, cwd, env = {}) {
  const result = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", shell: isWin, env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(" ")} faalde in ${cwd} (code ${result.status})`);
}
function start(name, cmd, cmdArgs, cwd, env = {}) {
  const child = spawn(cmd, cmdArgs, { cwd, shell: isWin, detached: !isWin, env: { ...process.env, ...env } });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  children.push({ name, child, log: () => log });
  return child;
}
function stopAll() {
  for (const { child } of children) {
    try {
      if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}
async function waitFor(url, init) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} kwam niet online`);
}
function expect(label, condition, detail = "") {
  if (!condition) throw new Error(`✗ ${label} ${detail}`);
  console.log(`  ✓ ${label}`);
}
const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json", Origin: SITE }, body: JSON.stringify(body) });

const work = mkdtempSync(join(tmpdir(), "dafke-eid-install-"));
try {
  if (!args.has("--skip-build")) {
    step("pakket bouwen");
    run("npm", ["run", "build"], root);
  }
  step("pakket inpakken (npm pack)");
  run("npm", ["pack", "--pack-destination", work], join(root, "packages/eid"));
  const tgz = join(work, readdirSync(work).find((f) => f.endsWith(".tgz")));

  const copy = (name) => {
    const dir = join(work, name);
    const from = join(root, "examples", name);
    const skip = /^[\\/]?(node_modules|\.next|dist)([\\/]|$)/;
    cpSync(from, dir, { recursive: true, filter: (src) => !skip.test(src.slice(from.length)) });
    return dir;
  };

  step("Next.js-voorbeeld installeren en bouwen");
  const next = copy("next-app");
  run("npm", ["install", "--no-audit", "--no-fund", tgz], next);
  run("npm", ["run", "build"], next, { NEXT_TELEMETRY_DISABLED: "1" });
  run("npx", ["--no-install", "dafke-eid", "--version"], next);

  step("NestJS-voorbeeld installeren en bouwen");
  const nest = copy("nest-api");
  run("npm", ["install", "--no-audit", "--no-fund", tgz], nest);
  run("npm", ["run", "build"], nest);

  step("CommonJS + moduleResolution node (oudere projecten, bv. NestJS 10)");
  const cjs = join(work, "cjs");
  mkdirSync(cjs);
  writeFileSync(join(cjs, "package.json"), JSON.stringify({ name: "cjs-check", private: true }));
  run("npm", ["install", "--no-audit", "--no-fund", tgz, "typescript@5", "@types/node", "@nestjs/common@11", "reflect-metadata", "rxjs"], cjs);
  writeFileSync(
    join(cjs, "check.ts"),
    [
      'import { EidError } from "@dafkedd/eid";',
      'import { EidAuthenticator } from "@dafkedd/eid/server";',
      'import { EidAuthModule } from "@dafkedd/eid/nestjs";',
      'import { TEST_ROOT_CA } from "@dafkedd/eid/mock";',
      'import { createEidReader } from "@dafkedd/eid/node";',
      'import type { EidState } from "@dafkedd/eid/react";',
      "const state: EidState | null = null;",
      "console.log(typeof EidError, typeof EidAuthenticator, typeof EidAuthModule.forRoot, TEST_ROOT_CA.length > 0, typeof createEidReader, state);",
    ].join("\n"),
  );
  run("npx", ["tsc", "check.ts", "--module", "commonjs", "--moduleResolution", "node", "--target", "es2022", "--strict", "--skipLibCheck", "--outDir", "out"], cjs);
  run("node", ["out/check.js"], cjs);

  step("starten: programma (virtuele kaart), Next.js en NestJS");
  start("bridge", "node", [join(next, "node_modules/@dafkedd/eid/dist/cli.js"), "serve", "--mock", "--port", String(PORTS.bridge), "--auth-origin", SITE], next);
  const env = { EID_TEST_CARD: "1", APP_ORIGIN: SITE };
  start("next", "npx", ["--no-install", "next", "start", "-p", String(PORTS.next)], next, { ...env, NEXT_TELEMETRY_DISABLED: "1" });
  start("nest", "node", ["dist/main.js"], nest, { ...env, PORT: String(PORTS.nest) });
  const bridge = `http://127.0.0.1:${PORTS.bridge}`;
  const api = `http://localhost:${PORTS.nest}`;
  await Promise.all([waitFor(`${bridge}/v1/status`), waitFor(SITE), waitFor(`${api}/eid/challenge`)]);

  step("website + programma");
  const html = await (await fetch(SITE)).text();
  expect("pagina rendert (server-side: phase connecting)", html.includes("connecting"));
  const status = await fetch(`${bridge}/v1/status`, { headers: { Origin: SITE } });
  expect("programma laat de website toe (CORS)", status.headers.get("access-control-allow-origin") === SITE);
  const foreign = await fetch(`${bridge}/v1/status`, { headers: { Origin: "https://kwaad.example" } });
  expect("programma weigert een vreemde website", foreign.headers.get("access-control-allow-origin") === null);

  const login = async (challengeUrl, loginUrl, label) => {
    const challenge = await fetch(challengeUrl, { headers: { Origin: SITE } });
    const cookie = challenge.headers.get("set-cookie")?.split(";")[0] ?? "";
    const { nonce } = await challenge.json();
    expect(`${label}: nonce + httpOnly-cookie`, typeof nonce === "string" && nonce.length >= 44 && cookie.startsWith("eid_nonce="));

    const wrong = await fetch(`${bridge}/v1/authenticate`, json({ nonce, pin: "0000" }));
    const wrongBody = await wrong.json();
    expect(`${label}: verkeerde PIN → pin-incorrect`, wrongBody.error?.code === "pin-incorrect", JSON.stringify(wrongBody));

    const auth = await fetch(`${bridge}/v1/authenticate`, json({ nonce, pin: "1234" }));
    const { token } = await auth.json();
    expect(`${label}: token van het programma`, token?.format === "web-eid:1.0");

    const post = (body, withCookie = true) =>
      fetch(loginUrl, { ...json(body), headers: { ...json(body).headers, ...(withCookie ? { cookie } : {}) } });
    const ok = await post(token);
    const who = await ok.json();
    expect(`${label}: server aanvaardt het token`, ok.status === 200 && who.lastName === "Specimen", `${ok.status} ${JSON.stringify(who)}`);
    expect(`${label}: geen rijksregisternummer naar de browser`, !JSON.stringify(who).match(/\d{11}/));
    const replay = await post(token);
    expect(`${label}: hergebruik van het token geweigerd`, replay.status === 401);
    const noCookie = await post(token, false);
    expect(`${label}: zonder nonce-cookie geweigerd`, noCookie.status === 401);
  };
  await login(`${SITE}/api/eid`, `${SITE}/api/eid`, "Next.js");
  await login(`${api}/eid/challenge`, `${api}/eid/login`, "NestJS");

  const otherSite = await fetch(`${bridge}/v1/authenticate`, {
    ...json({ nonce: "x".repeat(44), pin: "1234" }),
    headers: { "Content-Type": "application/json", Origin: "http://localhost:4000" },
  });
  expect("andere website mag niet aanmelden (auth-not-allowed)", (await otherSite.json()).error?.code === "auth-not-allowed");

  console.log("\n✔ Installatietest geslaagd");
} catch (error) {
  console.error(`\n${error.message}`);
  for (const { name, log } of children) console.error(`\n--- ${name} ---\n${log().slice(-3000)}`);
  process.exitCode = 1;
} finally {
  stopAll();
  if (!args.has("--keep")) rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  else console.log(`Map bewaard: ${work}`);
}
