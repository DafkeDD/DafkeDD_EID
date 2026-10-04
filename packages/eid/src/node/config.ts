/**
 * Instellingen van de bridge en waar ze vandaan komen. Volgorde (eerste wint):
 *   1. opties op de opdrachtregel
 *   2. omgevingsvariabelen (DAFKE_EID_PORT, DAFKE_EID_ORIGINS, DAFKE_EID_AUTH_ORIGINS, DAFKE_EID_TOKEN, DAFKE_EID_TESTPAGE)
 *   3. config.json in de installatiemap (of --config)
 *   4. ingebakken bij het bouwen (scripts/build-exe.mjs --origin …)
 *   5. standaardwaarden
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_BRIDGE_PORT, DEFAULT_ORIGINS, EidError } from "../core";

export interface BridgeConfig {
  port?: number;
  origins?: string[];
  /** Websites die mogen aanmelden met PIN (aparte lijst, standaard leeg). */
  authOrigins?: string[];
  token?: string;
  testpage?: boolean;
}

export interface ResolvedConfig {
  port: number;
  origins: string[];
  authOrigins: string[];
  token: string | undefined;
  testpage: boolean;
}

function validPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65535;
}

/** Controleert en normaliseert een (deel)configuratie. Gooit `internal` bij ongeldige waarden. */
export function normalizeConfig(input: unknown, source: string): BridgeConfig {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new EidError("internal", `${source}: verwacht een object`);
  const raw = input as Record<string, unknown>;
  const out: BridgeConfig = {};
  if (raw.port !== undefined) {
    if (!validPort(raw.port)) throw new EidError("internal", `${source}: "port" moet een getal tussen 0 en 65535 zijn`);
    out.port = raw.port;
  }
  if (raw.origins !== undefined) {
    if (!Array.isArray(raw.origins) || !raw.origins.every((o) => typeof o === "string")) {
      throw new EidError("internal", `${source}: "origins" moet een lijst van teksten zijn`);
    }
    out.origins = raw.origins.map((o) => o.trim()).filter(Boolean);
  }
  if (raw.authOrigins !== undefined) {
    if (!Array.isArray(raw.authOrigins) || !raw.authOrigins.every((o) => typeof o === "string")) {
      throw new EidError("internal", `${source}: "authOrigins" moet een lijst van teksten zijn`);
    }
    out.authOrigins = raw.authOrigins.map((o) => o.trim()).filter(Boolean);
  }
  if (raw.token !== undefined) {
    if (typeof raw.token !== "string") throw new EidError("internal", `${source}: "token" moet tekst zijn`);
    if (raw.token) out.token = raw.token;
  }
  if (raw.testpage !== undefined) {
    if (typeof raw.testpage !== "boolean") throw new EidError("internal", `${source}: "testpage" moet true of false zijn`);
    out.testpage = raw.testpage;
  }
  return out;
}

/** Leest config.json; `undefined` als het bestand niet bestaat. */
export function readConfigFile(path: string): BridgeConfig | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    throw new EidError("internal", `${path}: geen geldige JSON`, { cause: error });
  }
  return normalizeConfig(json, path);
}

export function writeConfigFile(path: string, config: BridgeConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(normalizeConfig(config, path), null, 2) + "\n", "utf8");
}

/** Instellingen uit omgevingsvariabelen. */
export function configFromEnv(env: Record<string, string | undefined>): BridgeConfig {
  const out: BridgeConfig = {};
  if (env.DAFKE_EID_PORT) {
    const port = Number(env.DAFKE_EID_PORT);
    if (!validPort(port)) throw new EidError("internal", "DAFKE_EID_PORT is geen geldige poort");
    out.port = port;
  }
  const origins = (env.DAFKE_EID_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  if (origins.length > 0) out.origins = origins;
  const authOrigins = (env.DAFKE_EID_AUTH_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  if (authOrigins.length > 0) out.authOrigins = authOrigins;
  if (env.DAFKE_EID_TOKEN) out.token = env.DAFKE_EID_TOKEN;
  if (env.DAFKE_EID_TESTPAGE) out.testpage = !["0", "false", "nee", "no", "off"].includes(env.DAFKE_EID_TESTPAGE.toLowerCase());
  return out;
}

/** Voegt lagen samen: per instelling wint de eerste laag die ze heeft. */
export function resolveConfig(...layers: Array<BridgeConfig | undefined>): ResolvedConfig {
  const pick = <K extends keyof BridgeConfig>(key: K): BridgeConfig[K] => layers.find((l) => l?.[key] !== undefined)?.[key];
  const origins = pick("origins");
  return {
    port: pick("port") ?? DEFAULT_BRIDGE_PORT,
    origins: origins && origins.length > 0 ? [...origins] : [...DEFAULT_ORIGINS],
    authOrigins: [...(pick("authOrigins") ?? [])],
    token: pick("token"),
    testpage: pick("testpage") ?? true,
  };
}
