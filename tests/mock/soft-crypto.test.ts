import { createHash, verify, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ecdsaP384SignHash, rsaPkcs1Sha256SignHash } from "../../packages/eid/src/mock/soft-crypto";
import { TEST_AUTH_KEY_EC_D, TEST_AUTH_KEY_RSA_D, TEST_AUTH_KEY_RSA_N } from "../../packages/eid/src/mock/test-pki";

const cert = (name: string) => new X509Certificate(readFileSync(`tests/fixtures/pki/${name}.pem`));

describe("software-ondertekening (virtuele kaart)", () => {
  it("ECDSA P-384 geeft een handtekening die Node met de publieke sleutel aanvaardt", () => {
    const data = Buffer.from("hash(origin) ‖ hash(nonce)");
    const hash = createHash("sha384").update(data).digest();
    for (let i = 0; i < 3; i++) {
      const signature = ecdsaP384SignHash(hash, TEST_AUTH_KEY_EC_D);
      expect(signature).toHaveLength(96);
      expect(verify("sha384", data, { key: cert("auth-ec").publicKey, dsaEncoding: "ieee-p1363" }, signature)).toBe(true);
    }
    const wrong = ecdsaP384SignHash(createHash("sha384").update("iets anders").digest(), TEST_AUTH_KEY_EC_D);
    expect(verify("sha384", data, { key: cert("auth-ec").publicKey, dsaEncoding: "ieee-p1363" }, wrong)).toBe(false);
  });

  it("RSA PKCS#1 v1.5 met SHA-256 geeft een handtekening die Node aanvaardt", () => {
    const data = Buffer.from("hash(origin) ‖ hash(nonce)");
    const hash = createHash("sha256").update(data).digest();
    const signature = rsaPkcs1Sha256SignHash(hash, TEST_AUTH_KEY_RSA_N, TEST_AUTH_KEY_RSA_D);
    expect(signature).toHaveLength(256);
    expect(verify("sha256", data, cert("auth-rsa").publicKey, signature)).toBe(true);
  });

  it("weigert een hash van de verkeerde lengte", () => {
    expect(() => ecdsaP384SignHash(new Uint8Array(32), TEST_AUTH_KEY_EC_D)).toThrow(/48 bytes/);
    expect(() => rsaPkcs1Sha256SignHash(new Uint8Array(48), TEST_AUTH_KEY_RSA_N, TEST_AUTH_KEY_RSA_D)).toThrow(/32 bytes/);
  });

  it("de test-certificaten vormen een keten tot de test-root", () => {
    const root = cert("root");
    const ca = cert("citizen-ca");
    expect(ca.verify(root.publicKey)).toBe(true);
    expect(cert("auth-ec").verify(ca.publicKey)).toBe(true);
    expect(cert("auth-rsa").verify(ca.publicKey)).toBe(true);
    expect(cert("auth-rogue").verify(ca.publicKey)).toBe(false);
    expect(cert("auth-ec").subject).toContain("serialNumber=85031512369");
  });
});
