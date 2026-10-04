import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";

export const PKI = "tests/fixtures/pki";
export const pem = (name: string) => readFileSync(join(PKI, `${name}.pem`), "utf8");
export const cert = (name: string) => new X509Certificate(pem(name));

export function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * OCSP-responder via `openssl ocsp` (onafhankelijke implementatie), zodat we onze eigen
 * DER-encoder en -parser tegen iets echts testen.
 */
export function opensslResponder(options: { signer?: string; signerKey?: string; ca?: string; ndays?: number; seen?: string[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ocsp-"));
  return async (url: string, request: Uint8Array): Promise<Uint8Array> => {
    options.seen?.push(url);
    const req = join(dir, "req.der");
    const resp = join(dir, "resp.der");
    writeFileSync(req, request);
    execFileSync(
      "openssl",
      [
        "ocsp",
        "-index", join(PKI, "index.txt"),
        "-CA", join(PKI, `${options.ca ?? "citizen-ca"}.pem`),
        "-rsigner", join(PKI, `${options.signer ?? "ocsp"}.pem`),
        "-rkey", join(PKI, `${options.signerKey ?? options.signer ?? "ocsp"}.key.pem`),
        "-reqin", req,
        "-respout", resp,
        "-ndays", String(options.ndays ?? 1),
      ],
      { stdio: "ignore" },
    );
    return new Uint8Array(readFileSync(resp));
  };
}

/** Tekst van een OCSP-aanvraag volgens openssl. */
export function describeRequest(request: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "ocspreq-"));
  const file = join(dir, "req.der");
  writeFileSync(file, request);
  return execFileSync("openssl", ["ocsp", "-reqin", file, "-req_text"], { encoding: "utf8" });
}
