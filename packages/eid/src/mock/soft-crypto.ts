/**
 * Software-ondertekening voor de virtuele kaart (alleen voor tests en demo's!).
 * Een echte eID ondertekent een al berekende hash; WebCrypto kan dat niet (het hasht altijd zelf),
 * daarom hier een kleine implementatie met BigInt:
 *   - ECDSA P-384 over een hash van 48 bytes → r ‖ s (96 bytes), zoals applet 1.8
 *   - RSASSA-PKCS1-v1.5 met SHA-256-DigestInfo → 256 bytes, zoals applet 1.7
 * Niet in constante tijd: nooit voor echte sleutels gebruiken.
 */
import { fromHex, toHex } from "../core";

const big = (bytes: Uint8Array): bigint => (bytes.length === 0 ? 0n : BigInt(`0x${toHex(bytes)}`));

function toBytes(value: bigint, length: number): Uint8Array {
  const hex = value.toString(16).padStart(length * 2, "0");
  if (hex.length > length * 2) throw new Error("Getal te groot");
  return fromHex(hex);
}

const mod = (a: bigint, m: bigint) => ((a % m) + m) % m;

function modPow(base: bigint, exponent: bigint, m: bigint): bigint {
  let result = 1n;
  let b = mod(base, m);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

function modInv(a: bigint, m: bigint): bigint {
  let [oldR, r] = [mod(a, m), m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return mod(oldS, m);
}

function randomBelow(n: bigint): bigint {
  const bytes = new Uint8Array(Math.ceil(n.toString(16).length / 2) + 8);
  for (;;) {
    globalThis.crypto.getRandomValues(bytes);
    const k = big(bytes) % n;
    if (k > 0n) return k;
  }
}

// --- P-384 (NIST, FIPS 186-4) ---

const P = BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff");
const N = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973");
const A = P - 3n;
const G: Point = {
  x: BigInt("0xaa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7"),
  y: BigInt("0x3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f"),
};

type Point = { x: bigint; y: bigint } | null;

function add(p1: Point, p2: Point): Point {
  if (!p1) return p2;
  if (!p2) return p1;
  if (p1.x === p2.x) {
    if (mod(p1.y + p2.y, P) === 0n) return null;
    const l = mod(3n * p1.x * p1.x + A, P) * modInv(2n * p1.y, P);
    return line(p1, p1.x, l);
  }
  const l = mod(p2.y - p1.y, P) * modInv(p2.x - p1.x, P);
  return line(p1, p2.x, l);
}

function line(p1: { x: bigint; y: bigint }, x2: bigint, lambda: bigint): Point {
  const l = mod(lambda, P);
  const x = mod(l * l - p1.x - x2, P);
  return { x, y: mod(l * (p1.x - x) - p1.y, P) };
}

function multiply(k: bigint, point: Point): Point {
  let result: Point = null;
  let addend = point;
  let e = k;
  while (e > 0n) {
    if (e & 1n) result = add(result, addend);
    addend = add(addend, addend);
    e >>= 1n;
  }
  return result;
}

/** ECDSA P-384 over een hash van 48 bytes; geeft r ‖ s (96 bytes). */
export function ecdsaP384SignHash(hash: Uint8Array, privateKeyHex: string): Uint8Array {
  if (hash.length !== 48) throw new Error("ECDSA P-384 verwacht een SHA-384-hash (48 bytes)");
  const d = BigInt(`0x${privateKeyHex}`);
  const z = big(hash);
  for (;;) {
    const k = randomBelow(N);
    const r = mod(multiply(k, G)!.x, N);
    if (r === 0n) continue;
    const s = mod(modInv(k, N) * (z + r * d), N);
    if (s === 0n) continue;
    const out = new Uint8Array(96);
    out.set(toBytes(r, 48));
    out.set(toBytes(s, 48), 48);
    return out;
  }
}

/** DigestInfo-prefix voor SHA-256 (RFC 8017). */
const SHA256_DIGEST_INFO = fromHex("3031300d060960864801650304020105000420");

/** RSASSA-PKCS1-v1.5: de kaart (en dus wij) voegt DigestInfo en opvulling toe aan de SHA-256-hash. */
export function rsaPkcs1Sha256SignHash(hash: Uint8Array, modulusHex: string, privateExponentHex: string): Uint8Array {
  if (hash.length !== 32) throw new Error("RSA PKCS#1 met SHA-256 verwacht een hash van 32 bytes");
  const n = BigInt(`0x${modulusHex}`);
  const d = BigInt(`0x${privateExponentHex}`);
  const k = modulusHex.length / 2;
  const t = new Uint8Array(SHA256_DIGEST_INFO.length + hash.length);
  t.set(SHA256_DIGEST_INFO);
  t.set(hash, SHA256_DIGEST_INFO.length);
  const em = new Uint8Array(k).fill(0xff);
  em[0] = 0x00;
  em[1] = 0x01;
  em[k - t.length - 1] = 0x00;
  em.set(t, k - t.length);
  return toBytes(modPow(big(em), d, n), k);
}
