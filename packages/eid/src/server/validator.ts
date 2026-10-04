/**
 * Een web-eid:1.0-token controleren op de server:
 *   1. vorm van het token
 *   2. certificaat leesbaar, geldig op dit moment, juist sleuteltype voor het algoritme
 *   3. handtekening over hash(origin) ‖ hash(nonce) — met JOUW origin en de nonce die JIJ uitgaf
 *   4. keten tot een vertrouwde (Belgische) root
 *   5. OCSP: niet ingetrokken (fail closed)
 * De nonce zelf (uniek, één keer, niet verlopen) controleert EidAuthenticator.
 */
import { createHash, verify, X509Certificate } from "node:crypto";
import { WEB_EID_TOKEN_FORMAT, type EidAuthToken } from "../core/auth";
import { buildChain, toCertificate, type CertificateInput, type IssuerFetch } from "./chain";
import { EidVerifyError } from "./errors";
import { subjectFields, type EidLoginIdentity } from "./identity";
import { checkOcsp, type OcspOptions } from "./ocsp";
import { BELGIUM_ROOT_CAS } from "./roots";

export interface EidTrustOptions {
  /** Vertrouwde roots. Standaard de Belgium Root CA's (BELGIUM_ROOT_CAS). */
  roots?: readonly CertificateInput[];
  /** Gekende tussencertificaten (Citizen CA's). Ontbrekende worden via AIA opgehaald. */
  intermediates?: readonly CertificateInput[];
  /** Tussencertificaten ophalen via AIA. `false` = uit. */
  fetchIssuer?: IssuerFetch | false;
}

export interface VerifyEidTokenOptions {
  /** Het token zoals de browser het opstuurde (geparste JSON). */
  token: unknown;
  /** Jouw eigen origin, bv. "https://sso.voorbeeld.be". */
  origin: string;
  /** De nonce die je voor deze login uitgaf. */
  nonce: string;
  trust?: EidTrustOptions;
  /** OCSP-instellingen, of `false` om intrekking NIET te controleren (alleen voor tests!). */
  revocation?: OcspOptions | false;
  now?: () => Date;
}

const ALGORITHMS = {
  ES256: { hash: "sha256", key: "ec", curve: "prime256v1" },
  ES384: { hash: "sha384", key: "ec", curve: "secp384r1" },
  ES512: { hash: "sha512", key: "ec", curve: "secp521r1" },
  RS256: { hash: "sha256", key: "rsa", curve: undefined },
} as const;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function parseToken(token: unknown): EidAuthToken {
  const t = token as Partial<EidAuthToken> | null;
  if (!t || typeof t !== "object") throw new EidVerifyError("token-invalid", "Token ontbreekt");
  if (t.format !== WEB_EID_TOKEN_FORMAT) throw new EidVerifyError("token-invalid", `Onbekend tokenformaat (verwacht ${WEB_EID_TOKEN_FORMAT})`);
  if (typeof t.algorithm !== "string" || !(t.algorithm in ALGORITHMS)) throw new EidVerifyError("token-invalid", "Onbekend algoritme");
  if (typeof t.unverifiedCertificate !== "string" || !BASE64.test(t.unverifiedCertificate) || t.unverifiedCertificate.length > 16_384) {
    throw new EidVerifyError("token-invalid", "Ongeldig certificaat in het token");
  }
  if (typeof t.signature !== "string" || !BASE64.test(t.signature) || t.signature.length > 2048) {
    throw new EidVerifyError("token-invalid", "Ongeldige handtekening in het token");
  }
  return t as EidAuthToken;
}

/** @throws EidVerifyError */
export async function verifyEidToken(options: VerifyEidTokenOptions): Promise<EidLoginIdentity> {
  const now = (options.now ?? (() => new Date()))();
  const token = parseToken(options.token);
  const spec = ALGORITHMS[token.algorithm];

  // 2. Certificaat
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(Buffer.from(token.unverifiedCertificate, "base64"));
  } catch (error) {
    throw new EidVerifyError("certificate-invalid", "Certificaat onleesbaar", { cause: error });
  }
  if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) throw new EidVerifyError("certificate-expired", "Certificaat is niet geldig op dit moment");
  if (cert.ca) throw new EidVerifyError("certificate-invalid", "Een CA-certificaat kan niet aanmelden");
  const key = cert.publicKey;
  if (key.asymmetricKeyType !== spec.key || (spec.curve && key.asymmetricKeyDetails?.namedCurve !== spec.curve)) {
    throw new EidVerifyError("certificate-invalid", `Sleutel van het certificaat past niet bij ${token.algorithm}`);
  }

  // 3. Handtekening (de origin zit erin: een token voor een andere website faalt hier)
  const origin = options.origin.trim().toLowerCase().replace(/\/+$/, "");
  const signed = Buffer.concat([createHash(spec.hash).update(origin).digest(), createHash(spec.hash).update(options.nonce).digest()]);
  const signature = Buffer.from(token.signature, "base64");
  const ok = verify(spec.hash, signed, spec.key === "ec" ? { key, dsaEncoding: "ieee-p1363" } : key, signature);
  if (!ok) throw new EidVerifyError("signature-invalid", "Handtekening klopt niet (verkeerde origin, nonce of sleutel)");

  // 4. Keten
  const rootsInput = options.trust?.roots ?? BELGIUM_ROOT_CAS;
  if (rootsInput.length === 0) {
    throw new EidVerifyError("config-invalid", "Geen vertrouwde roots: draai scripts/fetch-belgium-roots.mjs of geef trust.roots mee");
  }
  const chain = await buildChain(cert, {
    roots: rootsInput.map(toCertificate),
    intermediates: (options.trust?.intermediates ?? []).map(toCertificate),
    ...(options.trust?.fetchIssuer !== undefined ? { fetchIssuer: options.trust.fetchIssuer } : {}),
    now,
  });

  // 5. Intrekking (fail closed)
  if (options.revocation !== false) await checkOcsp(cert, chain[1]!, { ...options.revocation, now: () => now });

  const subject = subjectFields(cert.subject);
  const nationalNumber = subject.serialNumber ?? "";
  if (!/^\d{11}$/.test(nationalNumber)) throw new EidVerifyError("certificate-invalid", "Geen rijksregisternummer in het certificaat");
  return {
    nationalNumber,
    firstNames: subject.GN ?? "",
    lastName: subject.SN ?? "",
    commonName: subject.CN ?? "",
    country: subject.C ?? "",
    certificateSerial: cert.serialNumber,
    certificateValidUntil: new Date(cert.validTo),
    algorithm: token.algorithm,
    certificate: cert,
  };
}
