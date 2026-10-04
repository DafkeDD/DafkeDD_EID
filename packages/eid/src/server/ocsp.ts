/**
 * OCSP (RFC 6960): vraagt de uitgever of een certificaat ingetrokken is. Fail closed: elk probleem
 * (geen antwoord, onleesbaar, verkeerde handtekening, te oud) geeft `revocation-unavailable`.
 * Geen afhankelijkheden: eigen DER-encoder (asn1.ts) en Node's crypto voor de handtekening.
 */
import { createHash, randomBytes, verify, X509Certificate } from "node:crypto";
import { EidVerifyError } from "./errors";
import { certificateParts, children, content, decodeOid, explicit, integerRaw, nullValue, octets, oid, parse, parseGeneralizedTime, raw, seq, tlv, type Node } from "./asn1";

const OID = {
  sha1: "1.3.14.3.2.26",
  sha256: "2.16.840.1.101.3.4.2.1",
  basicResponse: "1.3.6.1.5.5.7.48.1.1",
  nonce: "1.3.6.1.5.5.7.48.1.2",
  ocspSigning: "1.3.6.1.5.5.7.3.9",
};

/** Handtekeningalgoritmen van OCSP-antwoorden → hash voor crypto.verify. */
const SIGNATURE_HASH: Record<string, string> = {
  "1.2.840.113549.1.1.5": "sha1",
  "1.2.840.113549.1.1.11": "sha256",
  "1.2.840.113549.1.1.12": "sha384",
  "1.2.840.113549.1.1.13": "sha512",
  "1.2.840.10045.4.3.2": "sha256",
  "1.2.840.10045.4.3.3": "sha384",
  "1.2.840.10045.4.3.4": "sha512",
};

export type OcspFetch = (url: string, request: Uint8Array) => Promise<Uint8Array>;

export interface OcspOptions {
  /** Eigen transport (tests, proxy). Standaard: HTTP POST met fetch. */
  fetch?: OcspFetch;
  /** Time-out van de aanvraag. Standaard 5000 ms. */
  timeoutMs?: number;
  /** Nonce meesturen (en controleren als de responder hem terugstuurt). Standaard true. */
  nonce?: boolean;
  /** Toegelaten klokverschil. Standaard 5 minuten. */
  clockSkewMs?: number;
  /** Maximale ouderdom van een antwoord zonder nextUpdate. Standaard 24 uur. */
  maxAgeMs?: number;
  now?: () => Date;
}

/** OCSP-adres uit de Authority Information Access van het certificaat. */
export function ocspUrl(cert: X509Certificate): string | undefined {
  return /OCSP - URI:(\S+)/.exec(cert.infoAccess ?? "")?.[1];
}

/** CA Issuers-adres (het certificaat van de uitgever) uit de Authority Information Access. */
export function caIssuersUrl(cert: X509Certificate): string | undefined {
  return /CA Issuers - URI:(\S+)/.exec(cert.infoAccess ?? "")?.[1];
}

function certId(cert: X509Certificate, issuer: X509Certificate): Buffer {
  const c = certificateParts(cert.raw);
  const i = certificateParts(issuer.raw);
  const sha1 = (data: Uint8Array) => createHash("sha1").update(data).digest();
  return seq(seq(oid(OID.sha1), nullValue()), octets(sha1(i.subjectRaw)), octets(sha1(i.publicKeyBits)), integerRaw(c.serialContent));
}

/** OCSPRequest voor één certificaat, optioneel met nonce-extensie. */
export function buildOcspRequest(cert: X509Certificate, issuer: X509Certificate, nonce?: Uint8Array): Buffer {
  const request = seq(certId(cert, issuer));
  const extensions = nonce ? [explicit(2, seq(seq(oid(OID.nonce), octets(octets(nonce)))))] : [];
  return seq(seq(seq(request), ...extensions));
}

const defaultFetch =
  (timeoutMs: number): OcspFetch =>
  async (url, request) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/ocsp-request", accept: "application/ocsp-response" },
      body: request.slice(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`OCSP-responder antwoordde ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };

const unavailable = (message: string, cause?: unknown) =>
  new EidVerifyError("revocation-unavailable", `Intrekking kon niet gecontroleerd worden: ${message}`, cause === undefined ? {} : { cause });

function findExtension(extensionsWrapper: Node | undefined, wanted: string): Uint8Array | undefined {
  if (!extensionsWrapper) return undefined;
  const [list] = children(extensionsWrapper);
  for (const ext of list ? children(list) : []) {
    const parts = children(ext);
    if (decodeOid(content(parts[0]!)) === wanted) return content(parts[parts.length - 1]!);
  }
  return undefined;
}

/**
 * Controleert de status van `cert` (uitgegeven door `issuer`) via OCSP.
 * @throws EidVerifyError `certificate-revoked` of `revocation-unavailable`
 */
export async function checkOcsp(cert: X509Certificate, issuer: X509Certificate, options: OcspOptions = {}): Promise<void> {
  const url = ocspUrl(cert);
  if (!url) throw unavailable("het certificaat vermeldt geen OCSP-adres");
  const now = (options.now ?? (() => new Date()))();
  const skew = options.clockSkewMs ?? 5 * 60_000;
  const nonce = options.nonce === false ? undefined : randomBytes(16);
  const request = buildOcspRequest(cert, issuer, nonce);

  let bytes: Uint8Array;
  try {
    bytes = await (options.fetch ?? defaultFetch(options.timeoutMs ?? 5000))(url, request);
  } catch (error) {
    throw unavailable("geen antwoord van de OCSP-responder", error);
  }

  let status: "good" | "revoked" | "unknown";
  try {
    // OCSPResponse
    const [responseStatus, responseBytes] = children(parse(bytes));
    if (responseStatus?.tag !== 0x0a || content(responseStatus)[0] !== 0) {
      throw new Error(`responseStatus ${responseStatus ? content(responseStatus)[0] : "?"}`);
    }
    const [typeAndValue] = children(responseBytes!);
    const [type, value] = children(typeAndValue!);
    if (decodeOid(content(type!)) !== OID.basicResponse) throw new Error("geen BasicOCSPResponse");

    // BasicOCSPResponse
    const [tbs, signatureAlgorithm, signatureBits, certsWrapper] = children(parse(content(value!)));
    const hash = SIGNATURE_HASH[decodeOid(content(children(signatureAlgorithm!)[0]!))];
    if (!hash) throw new Error("onbekend handtekeningalgoritme");
    const signature = content(signatureBits!).subarray(1);

    // Wie tekende: de uitgever zelf, of een gedelegeerde responder die de uitgever ondertekende.
    const candidates: X509Certificate[] = [issuer];
    if (certsWrapper?.tag === 0xa0) {
      const [list] = children(certsWrapper);
      for (const c of list ? children(list) : []) {
        const responder = new X509Certificate(raw(c));
        const valid = new Date(responder.validFrom) <= now && now <= new Date(responder.validTo);
        if (valid && responder.verify(issuer.publicKey) && (responder.keyUsage ?? []).includes(OID.ocspSigning)) candidates.unshift(responder);
      }
    }
    if (!candidates.some((c) => verify(hash, raw(tbs!), c.publicKey, signature))) throw new Error("handtekening van het antwoord klopt niet");

    // ResponseData
    const fields = children(tbs!);
    const o = fields[0]?.tag === 0xa0 ? 1 : 0; // versie
    const responses = fields[o + 2]!;
    const extensions = fields.find((f, i) => i > o + 2 && f.tag === 0xa1);
    if (nonce) {
      const echoed = findExtension(extensions, OID.nonce);
      if (echoed && !Buffer.from(echoed).equals(octets(nonce)) && !Buffer.from(echoed).equals(Buffer.from(nonce))) throw new Error("nonce klopt niet");
    }

    const mine = certificateParts(cert.raw);
    const issuerKeyHash = (alg: string) =>
      createHash(alg === OID.sha256 ? "sha256" : "sha1").update(certificateParts(issuer.raw).publicKeyBits).digest();
    const single = children(responses).find((r) => {
      const [id] = children(r);
      const [algorithm, , keyHash, serial] = children(id!);
      const alg = decodeOid(content(children(algorithm!)[0]!));
      return Buffer.from(content(serial!)).equals(Buffer.from(mine.serialContent)) && Buffer.from(content(keyHash!)).equals(issuerKeyHash(alg));
    });
    if (!single) throw new Error("antwoord gaat niet over dit certificaat");

    const parts = children(single);
    const certStatus = parts[1]!;
    const thisUpdate = parseGeneralizedTime(parts[2]!);
    const nextWrapper = parts.find((p, i) => i > 2 && p.tag === 0xa0);
    const nextUpdate = nextWrapper ? parseGeneralizedTime(children(nextWrapper)[0]!) : undefined;
    if (thisUpdate.getTime() > now.getTime() + skew) throw new Error("antwoord uit de toekomst");
    if (nextUpdate ? now.getTime() > nextUpdate.getTime() + skew : now.getTime() - thisUpdate.getTime() > (options.maxAgeMs ?? 24 * 3600_000)) {
      throw new Error("antwoord te oud");
    }
    status = certStatus.tag === 0x80 ? "good" : certStatus.tag === 0xa1 ? "revoked" : "unknown";
  } catch (error) {
    if (EidVerifyError.is(error)) throw error;
    throw unavailable(error instanceof Error ? error.message : "onleesbaar antwoord", error);
  }

  if (status === "revoked") throw new EidVerifyError("certificate-revoked", "Het certificaat is ingetrokken");
  if (status !== "good") throw unavailable("de responder kent dit certificaat niet");
}
