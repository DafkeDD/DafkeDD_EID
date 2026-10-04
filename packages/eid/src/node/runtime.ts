/**
 * Alles wat te maken heeft met draaien als zelfstandig programma (Node "single executable",
 * dafke-eid.exe) in plaats van via `npx dafke-eid`.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { VERSION } from "../version";
import type { BridgeConfig } from "./config";

interface SeaModule {
  isSea(): boolean;
  getAsset(key: string): ArrayBuffer;
}

declare const __DAFKEDD_EID_EMBEDDED__: string | undefined;

function builtin<T>(name: string): T | undefined {
  const get = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  try {
    return get?.(name) as T | undefined;
  } catch {
    return undefined;
  }
}

/** Draaien we als zelfstandig programma (dafke-eid.exe) in plaats van via Node? */
export function isSea(): boolean {
  return builtin<SeaModule>("node:sea")?.isSea() ?? false;
}

export function exeName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "dafke-eid.exe" : "dafke-eid";
}

/**
 * Installatiemap per gebruiker (programma, config.json, logbestand):
 *   Windows  %LOCALAPPDATA%\DafkeDD\eid
 *   macOS    ~/Library/Application Support/DafkeDD/eid
 *   Linux    $XDG_DATA_HOME/dafkedd/eid (standaard ~/.local/share/dafkedd/eid)
 */
export function appDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (platform === "win32") {
    const base = env.LOCALAPPDATA ?? win32.join(env.USERPROFILE ?? home, "AppData", "Local");
    return win32.join(base, "DafkeDD", "eid");
  }
  const h = env.HOME ?? home;
  if (platform === "darwin") return posix.join(h, "Library", "Application Support", "DafkeDD", "eid");
  return posix.join(env.XDG_DATA_HOME ?? posix.join(h, ".local", "share"), "dafkedd", "eid");
}

/** Draait dit programma vanuit de installatiemap? */
export function runningInstalled(execPath = process.execPath, dir = appDir()): boolean {
  const normalize = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  return normalize(dirname(execPath)) === normalize(dir);
}

/** Instellingen die bij het bouwen in het programma gebakken werden (scripts/build-exe.mjs). */
export function embeddedConfig(): BridgeConfig {
  const raw = typeof __DAFKEDD_EID_EMBEDDED__ === "string" ? __DAFKEDD_EID_EMBEDDED__ : "{}";
  try {
    return JSON.parse(raw) as BridgeConfig;
  } catch {
    return {};
  }
}

/**
 * In een zelfstandig programma kan Node geen native addon uit het programma zelf laden. De
 * koffi-addon zit er als asset in: één keer naar schijf schrijven en koffi ernaar laten kijken
 * (koffi zoekt in `process.resourcesPath/koffi/<platform>_<arch>/koffi.node`).
 * Doet niets buiten een zelfstandig programma.
 */
export function prepareNativeModules(root: string = join(appDir(), "runtime", VERSION)): void {
  const sea = builtin<SeaModule>("node:sea");
  if (!sea?.isSea()) return;
  let asset: ArrayBuffer;
  try {
    asset = sea.getAsset("koffi.node");
  } catch {
    return;
  }
  const target = join(root, "koffi", `${process.platform}_${process.arch}`, "koffi.node");
  if (!existsSync(target) || statSync(target).size !== asset.byteLength) {
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(asset));
    } catch (error) {
      // Een andere instantie kan het bestand vasthouden; dat is goed zolang het bestaat.
      if (!existsSync(target)) throw error;
    }
  }
  (process as unknown as { resourcesPath?: string }).resourcesPath = root;
}
