/**
 * Kleine DER-encoder (en hulpjes bovenop core/der.ts) voor OCSP. Alleen wat we nodig hebben.
 */
import { readDer, derChildren, type DerNode } from "../core/der";

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function tlv(tag: number, ...content: Uint8Array[]): Buffer {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
}

export const seq = (...content: Uint8Array[]) => tlv(0x30, ...content);
export const octets = (value: Uint8Array) => tlv(0x04, value);
export const nullValue = () => Buffer.from([0x05, 0x00]);
export const explicit = (n: number, ...content: Uint8Array[]) => tlv(0xa0 | n, ...content);
/** INTEGER met de ruwe inhoud (bv. een serienummer zoals het in het certificaat staat). */
export const integerRaw = (content: Uint8Array) => tlv(0x02, content);

export function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const bytes: number[] = [40 * parts[0]! + parts[1]!];
  for (const part of parts.slice(2)) {
    const groups: number[] = [];
    let v = part;
    do {
      groups.unshift(v & 0x7f);
      v = Math.floor(v / 128);
    } while (v > 0);
    for (let i = 0; i < groups.length - 1; i++) groups[i]! |= 0x80;
    bytes.push(...groups);
  }
  return tlv(0x06, Buffer.from(bytes));
}

export function decodeOid(content: Uint8Array): string {
  const parts: number[] = [Math.floor(content[0]! / 40), content[0]! % 40];
  let value = 0;
  for (const byte of content.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

export interface Node extends DerNode {
  bytes: Uint8Array;
}

export function parse(bytes: Uint8Array, offset = 0): Node {
  return { ...readDer(bytes, offset), bytes };
}

export function children(node: Node): Node[] {
  return derChildren(node.bytes, node).map((c) => ({ ...c, bytes: node.bytes }));
}

export const content = (node: Node) => node.bytes.subarray(node.contentStart, node.end);
export const raw = (node: Node) => node.bytes.subarray(node.start, node.end);

/** GeneralizedTime (YYYYMMDDHHMMSS[.fff]Z) → Date. */
export function parseGeneralizedTime(node: Node): Date {
  const text = Buffer.from(content(node)).toString("ascii");
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z$/.exec(text);
  if (node.tag !== 0x18 || !m) throw new Error(`Ongeldige GeneralizedTime: ${text}`);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
}

/** Velden van een certificaat die we voor OCSP nodig hebben. */
export function certificateParts(der: Uint8Array) {
  const cert = parse(der);
  const [tbs] = children(cert);
  const fields = children(tbs!);
  const o = fields[0]?.tag === 0xa0 ? 1 : 0;
  const serial = fields[o]!;
  const subject = fields[o + 4]!;
  const spki = fields[o + 5]!;
  const [, subjectPublicKey] = children(spki);
  return {
    serialContent: content(serial),
    subjectRaw: raw(subject),
    /** Inhoud van de BIT STRING zonder het byte met ongebruikte bits. */
    publicKeyBits: content(subjectPublicKey!).subarray(1),
  };
}
