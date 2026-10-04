import { describe, expect, it } from "vitest";
import { buildOcspRequest, checkOcsp, ocspUrl, caIssuersUrl } from "../../packages/eid/src/server";
import { cert, describeRequest, hasOpenssl, opensslResponder } from "./helpers";

const issuer = () => cert("citizen-ca");

describe("OCSP: adressen", () => {
  it("leest OCSP- en CA Issuers-adres uit het certificaat", () => {
    expect(ocspUrl(cert("auth-ec"))).toBe("http://ocsp.test.invalid");
    expect(caIssuersUrl(cert("auth-ec"))).toBe("http://certs.test.invalid/citizen-ca.crt");
    expect(ocspUrl(cert("root"))).toBeUndefined();
  });
});

describe.runIf(hasOpenssl())("OCSP tegen openssl", () => {
  it("bouwt een aanvraag die openssl begrijpt (serienummer, nonce)", () => {
    const text = describeRequest(buildOcspRequest(cert("auth-ec"), issuer(), new Uint8Array(16).fill(7)));
    expect(text).toContain(`Serial Number: ${cert("auth-ec").serialNumber}`);
    expect(text).toContain("Hash Algorithm: sha1");
    expect(text).toMatch(/OCSP Nonce:\s*\n\s*0410(07){16}/i);
  });

  it("aanvaardt een geldig certificaat (EC en RSA), ook met gedelegeerde responder", async () => {
    const seen: string[] = [];
    await expect(checkOcsp(cert("auth-ec"), issuer(), { fetch: opensslResponder({ seen }) })).resolves.toBeUndefined();
    await expect(checkOcsp(cert("auth-rsa"), issuer(), { fetch: opensslResponder() })).resolves.toBeUndefined();
    expect(seen).toEqual(["http://ocsp.test.invalid"]);
  });

  it("aanvaardt een antwoord dat de uitgever zelf ondertekende", async () => {
    await expect(checkOcsp(cert("auth-ec"), issuer(), { fetch: opensslResponder({ signer: "citizen-ca" }) })).resolves.toBeUndefined();
  });

  it("weigert een ingetrokken certificaat", async () => {
    await expect(checkOcsp(cert("auth-revoked"), issuer(), { fetch: opensslResponder() })).rejects.toMatchObject({ code: "certificate-revoked" });
  });

  it("fail closed: vervalste responder, onbekend certificaat, oud antwoord, rommel of geen antwoord", async () => {
    const reject = (p: Promise<void>) => expect(p).rejects.toMatchObject({ code: "revocation-unavailable" });
    await reject(checkOcsp(cert("auth-ec"), issuer(), { fetch: opensslResponder({ signer: "rogue-root" }) }));
    await reject(checkOcsp(cert("ocsp"), issuer(), { fetch: opensslResponder() })); // niet in de index: unknown
    const future = new Date(Date.now() + 3 * 24 * 3600_000);
    await reject(checkOcsp(cert("auth-ec"), issuer(), { fetch: opensslResponder(), now: () => future }));
    await reject(checkOcsp(cert("auth-ec"), issuer(), { fetch: async () => Uint8Array.of(0x30, 0x03, 0x0a, 0x01, 0x01) })); // malformedRequest
    await reject(checkOcsp(cert("auth-ec"), issuer(), { fetch: async () => Uint8Array.of(1, 2, 3) }));
    await reject(
      checkOcsp(cert("auth-ec"), issuer(), {
        fetch: async () => {
          throw new Error("time-out");
        },
      }),
    );
  });

  it("weigert een antwoord over een ander certificaat", async () => {
    const forRsa = opensslResponder();
    // Antwoord voor auth-rsa teruggeven op een vraag over auth-ec.
    const fetch = async (url: string) => forRsa(url, buildOcspRequest(cert("auth-rsa"), issuer()));
    await expect(checkOcsp(cert("auth-ec"), issuer(), { fetch, nonce: false })).rejects.toMatchObject({ code: "revocation-unavailable" });
  });
});

describe("OCSP zonder adres", () => {
  it("is fail closed", async () => {
    await expect(checkOcsp(cert("citizen-ca"), cert("root"))).rejects.toMatchObject({ code: "revocation-unavailable" });
  });
});
