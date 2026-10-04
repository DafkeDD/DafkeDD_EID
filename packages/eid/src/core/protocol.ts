/**
 * Het HTTP-protocol tussen de bridge (`dafke-eid`) en de browser. Gedeeld door /node en /react.
 *
 *   GET  /v1/status                 → BridgeStatus
 *   GET  /v1/readers                → { readers: ReaderInfo[] }
 *   GET  /v1/card?reader=…&photo=0  → CardResponse
 *   GET  /v1/events                 → Server-Sent Events: "status" en daarna BridgeEvent's
 *   POST /v1/authenticate           → AuthenticateResponse (alleen voor websites in authOrigins)
 *
 * Fouten: HTTP-status + BridgeErrorBody. Bytes (foto, certificaten) gaan als base64.
 */
import { fromBase64, toBase64 } from "./bytes";
import { EID_ERROR_CODES, EidError, type EidErrorCode } from "./errors";
import type { EidCardData } from "./types";
import type { EidAuthToken } from "./auth";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_BRIDGE_PORT = 47820;
export const DEFAULT_BRIDGE_URL = `http://127.0.0.1:${DEFAULT_BRIDGE_PORT}`;
/** Standaard toegelaten websites: alleen lokale ontwikkeling. */
export const DEFAULT_ORIGINS: readonly string[] = ["http://localhost:*", "http://127.0.0.1:*"];
/** Header voor het optionele token (naast `Authorization: Bearer …`). */
export const TOKEN_HEADER = "x-dafke-eid-token";

export interface ReaderInfo {
  name: string;
  cardPresent: boolean;
  /** ATR van de kaart (hex), als er een kaart in zit. */
  atr?: string;
}

export interface BridgeStatus {
  name: "dafke-eid";
  version: string;
  protocol: number;
  readers: ReaderInfo[];
}

export type BridgeEvent =
  | { type: "reader-added"; reader: string }
  | { type: "reader-removed"; reader: string }
  | { type: "card-inserted"; reader: string; atr: string }
  | { type: "card-removed"; reader: string };

export interface BridgeErrorBody {
  error: { code: EidErrorCode; message: string; triesLeft?: number };
}

/** Body van POST /v1/authenticate. De origin komt uit de Origin-header van de browser, niet uit de body. */
export interface AuthenticateRequest {
  nonce: string;
  pin: string;
  reader?: string;
}

export interface AuthenticateResponse {
  reader: string;
  token: EidAuthToken;
}

/** EidCardData zoals het over JSON gaat: alle bytes als base64. */
export type EidCardJson = Omit<EidCardData, "photo" | "certificates"> & {
  photo?: { mimeType: "image/jpeg"; data: string };
  certificates?: {
    authentication?: string;
    signing?: string;
    ca: string;
    root: string;
    rrn: string;
  };
};

export interface CardResponse {
  reader: string;
  card: EidCardJson;
}

export function encodeCardData(data: EidCardData): EidCardJson {
  const { photo, certificates, ...rest } = data;
  const json: EidCardJson = { ...rest };
  if (photo) json.photo = { mimeType: photo.mimeType, data: toBase64(photo.data) };
  if (certificates) {
    json.certificates = {
      ...(certificates.authentication ? { authentication: toBase64(certificates.authentication) } : {}),
      ...(certificates.signing ? { signing: toBase64(certificates.signing) } : {}),
      ca: toBase64(certificates.ca),
      root: toBase64(certificates.root),
      rrn: toBase64(certificates.rrn),
    };
  }
  return json;
}

export function decodeCardData(json: EidCardJson): EidCardData {
  const { photo, certificates, ...rest } = json;
  const data: EidCardData = { ...rest };
  if (photo) data.photo = { mimeType: photo.mimeType, data: fromBase64(photo.data) };
  if (certificates) {
    data.certificates = {
      ...(certificates.authentication ? { authentication: fromBase64(certificates.authentication) } : {}),
      ...(certificates.signing ? { signing: fromBase64(certificates.signing) } : {}),
      ca: fromBase64(certificates.ca),
      root: fromBase64(certificates.root),
      rrn: fromBase64(certificates.rrn),
    };
  }
  return data;
}

/** Zet een foutantwoord van de bridge om naar een EidError. */
export function errorFromBody(body: unknown, fallback: EidErrorCode = "internal"): EidError {
  const error = (body as Partial<BridgeErrorBody> | null)?.error;
  const code = error && (EID_ERROR_CODES as readonly string[]).includes(error.code) ? error.code : fallback;
  const triesLeft = typeof error?.triesLeft === "number" ? error.triesLeft : undefined;
  return new EidError(code, typeof error?.message === "string" ? error.message : code, triesLeft !== undefined ? { triesLeft } : {});
}

const PATTERN = /^(https?):\/\/(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::(\d{1,5}|\*))?$/;
const ORIGIN = /^(https?):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/;
const DEFAULT_PORTS: Record<string, string> = { http: "80", https: "443" };

/** Controleert of een patroon geldig is. Gooit bij ongeldige patronen (en weigert `*`). */
export function assertOriginPattern(pattern: string): void {
  if (!PATTERN.test(pattern.trim().toLowerCase())) {
    throw new EidError("internal", `Ongeldig origin-patroon: "${pattern}". Voorbeelden: https://app.voorbeeld.be, http://localhost:*, https://*.voorbeeld.be`);
  }
}

/**
 * Past een Origin-header bij één van de patronen?
 * - `https://app.voorbeeld.be` — exact (standaardpoort mag weg)
 * - `http://localhost:*` — elke poort
 * - `https://*.voorbeeld.be` — elk subdomein (niet het domein zelf)
 * Een `*` alleen is nooit toegelaten.
 */
export function matchOrigin(origin: string | null | undefined, patterns: readonly string[]): boolean {
  if (!origin) return false;
  // Een Origin-header is altijd schema://host[:poort], zonder pad. Al de rest (ook "null") weigeren.
  const parsed = ORIGIN.exec(origin.toLowerCase());
  if (!parsed) return false;
  const [, scheme, host, explicitPort] = parsed as unknown as [string, string, string, string | undefined];
  const port = explicitPort ?? DEFAULT_PORTS[scheme];

  return patterns.some((raw) => {
    const match = PATTERN.exec(raw.trim().toLowerCase());
    if (!match) return false;
    const [, pScheme, wildcard, pHost, pPort] = match;
    if (pScheme !== scheme) return false;
    if (wildcard ? !host.endsWith(`.${pHost}`) : host !== pHost) return false;
    if (pPort === "*") return true;
    return (pPort ?? DEFAULT_PORTS[scheme]) === port;
  });
}
