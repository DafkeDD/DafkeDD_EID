/**
 * Byte-hulpjes zonder Node-API's (geen Buffer), zodat core ook in de browser draait.
 */
import { EidError } from "./errors";

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** Bytes → hex in kleine letters, zonder scheidingstekens. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b];
  return out;
}

/** Hex (spaties toegelaten, hoofdletters of kleine letters) → bytes. */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    throw new EidError("internal", `Ongeldige hex-string: "${hex}"`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

export type DigestAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

/** Hash via WebCrypto (`globalThis.crypto.subtle`), beschikbaar in browsers en Node ≥ 20. */
export async function digest(algorithm: DigestAlgorithm, data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new EidError("internal", "WebCrypto (crypto.subtle) is niet beschikbaar");
  // Kopie zodat ook een subarray van een grotere buffer correct gehasht wordt.
  return new Uint8Array(await subtle.digest(algorithm, data.slice()));
}
