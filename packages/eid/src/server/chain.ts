/**
 * Keten bouwen van het authenticatiecertificaat tot een vertrouwde root: via opgegeven
 * tussencertificaten (Citizen CA's) of via het CA Issuers-adres in het certificaat (AIA).
 * Een opgehaald certificaat wordt pas vertrouwd als de hele keten tot een vertrouwde root klopt.
 */
import { X509Certificate } from "node:crypto";
import { EidVerifyError } from "./errors";
import { caIssuersUrl } from "./ocsp";

export type CertificateInput = string | Uint8Array | X509Certificate;

export function toCertificate(input: CertificateInput): X509Certificate {
  if (input instanceof X509Certificate) return input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    return new X509Certificate(trimmed.startsWith("-----BEGIN") ? trimmed : Buffer.from(trimmed, "base64"));
  }
  return new X509Certificate(Buffer.from(input));
}

export type IssuerFetch = (url: string) => Promise<Uint8Array>;

export interface ChainOptions {
  roots: readonly X509Certificate[];
  intermediates?: readonly X509Certificate[];
  /** Ontbrekende tussencertificaten ophalen via AIA. `false` = uit. Standaard: HTTP GET (5 s). */
  fetchIssuer?: IssuerFetch | false;
  now: Date;
}

const MAX_DEPTH = 5;
const issuerCache = new Map<string, Promise<X509Certificate>>();

const defaultIssuerFetch: IssuerFetch = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

function validAt(cert: X509Certificate, now: Date): boolean {
  return new Date(cert.validFrom) <= now && now <= new Date(cert.validTo);
}

function issued(issuer: X509Certificate, cert: X509Certificate): boolean {
  return cert.checkIssued(issuer) && cert.verify(issuer.publicKey);
}

/** Geeft [blad, …, root]. @throws EidVerifyError `chain-untrusted` */
export async function buildChain(leaf: X509Certificate, options: ChainOptions): Promise<X509Certificate[]> {
  const chain = [leaf];
  let current = leaf;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const root = options.roots.find((r) => issued(r, current));
    if (root) {
      if (!validAt(root, options.now)) throw new EidVerifyError("chain-untrusted", "De root is niet (meer) geldig");
      chain.push(root);
      return chain;
    }
    let issuer = options.intermediates?.find((c) => c.ca && issued(c, current));
    if (!issuer && options.fetchIssuer !== false) {
      const url = caIssuersUrl(current);
      if (url) {
        const fetchIssuer = options.fetchIssuer ?? defaultIssuerFetch;
        let pending = issuerCache.get(url);
        if (!pending) {
          pending = fetchIssuer(url).then((bytes) => {
            const buffer = Buffer.from(bytes);
            return toCertificate(buffer.includes("-----BEGIN") ? buffer.toString("utf8") : buffer);
          });
          issuerCache.set(url, pending);
          pending.catch(() => issuerCache.delete(url));
        }
        try {
          const fetched = await pending;
          if (fetched.ca && issued(fetched, current)) issuer = fetched;
        } catch {
          // Niet bereikbaar: dan is de keten niet te bouwen.
        }
      }
    }
    if (!issuer) throw new EidVerifyError("chain-untrusted", "Geen vertrouwde keten tot een Belgische root gevonden");
    if (!validAt(issuer, options.now)) throw new EidVerifyError("chain-untrusted", "Een tussencertificaat is niet (meer) geldig");
    chain.push(issuer);
    current = issuer;
  }
  throw new EidVerifyError("chain-untrusted", "Keten te lang");
}

/** Leegt de cache van opgehaalde tussencertificaten (tests). */
export function clearIssuerCache(): void {
  issuerCache.clear();
}
