/**
 * Minimale DER-lezer: genoeg om een certificaat af te knippen (het bestand op de kaart is opgevuld)
 * en het type publieke sleutel te bepalen. Geen volledige ASN.1-parser; de server gebruikt Node's
 * X509Certificate voor de echte controles.
 */
import { EidError } from "./errors";
import { equalBytes, fromHex } from "./bytes";

export interface DerNode {
  tag: number;
  /** Positie van de tag. */
  start: number;
  /** Positie van de inhoud. */
  contentStart: number;
  /** Positie na het element. */
  end: number;
}

export function readDer(bytes: Uint8Array, offset = 0): DerNode {
  const tag = bytes[offset];
  let length = bytes[offset + 1];
  if (tag === undefined || length === undefined) throw new EidError("invalid-data", "DER: afgekapt");
  let contentStart = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) throw new EidError("invalid-data", "DER: ongeldige lengte");
    length = 0;
    for (let i = 0; i < count; i++) {
      const b = bytes[contentStart + i];
      if (b === undefined) throw new EidError("invalid-data", "DER: afgekapt");
      length = length * 256 + b;
    }
    contentStart += count;
  }
  const end = contentStart + length;
  if (end > bytes.length) throw new EidError("invalid-data", "DER: element loopt voorbij het einde");
  return { tag, start: offset, contentStart, end };
}

export function derChildren(bytes: Uint8Array, node: DerNode): DerNode[] {
  const out: DerNode[] = [];
  for (let offset = node.contentStart; offset < node.end; ) {
    const child = readDer(bytes, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
}

/** Knipt een DER-element (bv. een certificaat in een opgevuld kaartbestand) op zijn echte lengte af. */
export function trimDer(bytes: Uint8Array): Uint8Array {
  const node = readDer(bytes);
  if (node.tag !== 0x30) throw new EidError("invalid-data", "Geen DER-SEQUENCE");
  return bytes.slice(0, node.end);
}

export type PublicKeyInfo = { type: "rsa" } | { type: "ec"; curve: "P-256" | "P-384" | "P-521" | "onbekend" };

const OID = {
  rsaEncryption: fromHex("2a864886f70d010101"),
  ecPublicKey: fromHex("2a8648ce3d0201"),
  p256: fromHex("2a8648ce3d030107"),
  p384: fromHex("2b81040022"),
  p521: fromHex("2b81040023"),
};

/** Type publieke sleutel uit een X.509-certificaat (SubjectPublicKeyInfo). */
export function certificatePublicKey(certificate: Uint8Array): PublicKeyInfo {
  const cert = readDer(certificate);
  const [tbs] = derChildren(certificate, cert);
  if (!tbs) throw new EidError("invalid-data", "Certificaat zonder inhoud");
  const fields = derChildren(certificate, tbs);
  const offset = fields[0]?.tag === 0xa0 ? 1 : 0; // [0] versie is optioneel
  const spki = fields[offset + 5];
  if (!spki) throw new EidError("invalid-data", "Certificaat zonder publieke sleutel");
  const [algorithm] = derChildren(certificate, spki);
  if (!algorithm) throw new EidError("invalid-data", "Certificaat zonder sleutelalgoritme");
  const [oid, params] = derChildren(certificate, algorithm);
  const value = (node: DerNode | undefined) => (node ? certificate.subarray(node.contentStart, node.end) : new Uint8Array());
  if (oid?.tag !== 0x06) throw new EidError("invalid-data", "Certificaat: ongeldig sleutelalgoritme");
  if (equalBytes(value(oid), OID.rsaEncryption)) return { type: "rsa" };
  if (equalBytes(value(oid), OID.ecPublicKey)) {
    const curve = value(params);
    if (equalBytes(curve, OID.p256)) return { type: "ec", curve: "P-256" };
    if (equalBytes(curve, OID.p384)) return { type: "ec", curve: "P-384" };
    if (equalBytes(curve, OID.p521)) return { type: "ec", curve: "P-521" };
    return { type: "ec", curve: "onbekend" };
  }
  throw new EidError("invalid-data", "Certificaat: onbekend sleuteltype");
}
