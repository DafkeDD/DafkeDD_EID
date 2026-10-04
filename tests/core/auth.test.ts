import { createHash, verify, X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authenticateWithCard,
  certificatePublicKey,
  encodePinBlock,
  fromBase64,
  isValidPin,
  toHex,
  trimDer,
  type EidAuthToken,
  type PinRequest,
} from "../../packages/eid/src/core";
import { createSampleCard, SAMPLE_PIN, TEST_AUTH_CERT_EC, TEST_AUTH_CERT_RSA } from "../../packages/eid/src/mock";

const ORIGIN = "https://sso.voorbeeld.be";
const NONCE = "a".repeat(44);

/** Controleert het token zoals een server dat zou doen (zonder keten; dat is fase 7). */
function verifyToken(token: EidAuthToken, origin = ORIGIN, nonce = NONCE): boolean {
  const cert = new X509Certificate(Buffer.from(token.unverifiedCertificate, "base64"));
  const hash = token.algorithm === "ES384" ? "sha384" : "sha256";
  const signed = Buffer.concat([createHash(hash).update(origin).digest(), createHash(hash).update(nonce).digest()]);
  const key = token.algorithm === "ES384" ? { key: cert.publicKey, dsaEncoding: "ieee-p1363" as const } : cert.publicKey;
  return verify(hash, signed, key, Buffer.from(token.signature, "base64"));
}

const pins = (...values: Array<string | null>) => {
  const requests: PinRequest[] = [];
  return {
    requests,
    provider: async (request: PinRequest) => {
      requests.push(request);
      return values.shift() ?? null;
    },
  };
};

describe("PIN-blok", () => {
  it("codeert volgens Belpic", () => {
    expect(toHex(encodePinBlock("1234"))).toBe("241234ffffffffff");
    expect(toHex(encodePinBlock("123456789012"))).toBe("2c123456789012ff");
    expect(toHex(encodePinBlock("12345"))).toBe("2512345fffffffff");
  });

  it("weigert ongeldige PIN's", () => {
    for (const pin of ["123", "1234567890123", "12a4", ""]) {
      expect(isValidPin(pin)).toBe(false);
      expect(() => encodePinBlock(pin)).toThrow(expect.objectContaining({ code: "bad-request" }));
    }
  });
});

describe("certificaten", () => {
  it("herkent EC P-384 en RSA, en knipt opvulling af", () => {
    const ec = fromBase64(TEST_AUTH_CERT_EC);
    const padded = new Uint8Array(ec.length + 100);
    padded.set(ec);
    expect(trimDer(padded)).toEqual(ec);
    expect(certificatePublicKey(ec)).toEqual({ type: "ec", curve: "P-384" });
    expect(certificatePublicKey(fromBase64(TEST_AUTH_CERT_RSA))).toEqual({ type: "rsa" });
    expect(() => trimDer(Uint8Array.of(0x04, 0x01, 0x00))).toThrow(expect.objectContaining({ code: "invalid-data" }));
  });
});

describe("authenticate", () => {
  it("applet 1.8: ES384-token dat een server kan controleren", async () => {
    const card = await createSampleCard();
    const { provider, requests } = pins(SAMPLE_PIN);
    const token = await authenticateWithCard(card, { origin: ORIGIN, nonce: NONCE, pin: provider });
    expect(token).toMatchObject({ algorithm: "ES384", format: "web-eid:1.0", appVersion: "https://github.com/DafkeDD/DafkeDD_EID" });
    expect(token.unverifiedCertificate).toBe(TEST_AUTH_CERT_EC); // opvulling afgeknipt
    expect(Buffer.from(token.signature, "base64")).toHaveLength(96);
    expect(verifyToken(token)).toBe(true);
    expect(verifyToken(token, "https://evil.example")).toBe(false);
    expect(verifyToken(token, ORIGIN, "b".repeat(44))).toBe(false);
    expect(requests).toEqual([{ triesLeft: 3, retry: false }]);
  });

  it("applet 1.7: RS256-token", async () => {
    const token = await authenticateWithCard(await createSampleCard({ appletVersion: "1.7" }), { origin: ORIGIN, nonce: NONCE, pin: pins(SAMPLE_PIN).provider });
    expect(token.algorithm).toBe("RS256");
    expect(Buffer.from(token.signature, "base64")).toHaveLength(256);
    expect(verifyToken(token)).toBe(true);
  });

  it("werkt ook met T=0-gedrag (61xx) en 6Cxx", async () => {
    for (const appletVersion of ["1.7", "1.8"] as const) {
      const card = await createSampleCard({ appletVersion, t0: true, strictLe: true });
      const token = await authenticateWithCard(card, { origin: ORIGIN, nonce: NONCE, pin: pins(SAMPLE_PIN).provider });
      expect(verifyToken(token)).toBe(true);
    }
  });

  it("vraagt opnieuw na een verkeerde PIN, met het aantal resterende pogingen", async () => {
    const card = await createSampleCard();
    const { provider, requests } = pins("0000", SAMPLE_PIN);
    const token = await authenticateWithCard(card, { origin: ORIGIN, nonce: NONCE, pin: provider });
    expect(verifyToken(token)).toBe(true);
    expect(requests).toEqual([
      { triesLeft: 3, retry: false },
      { triesLeft: 2, retry: true },
    ]);
    expect(card.pinTriesLeft).toBe(3); // juiste PIN zet de teller terug
  });

  it("geeft pin-blocked na te veel verkeerde PIN's, en daarna meteen", async () => {
    const card = await createSampleCard();
    await expect(authenticateWithCard(card, { origin: ORIGIN, nonce: NONCE, pin: pins("0000", "1111", "2222").provider })).rejects.toMatchObject({
      code: "pin-blocked",
      triesLeft: 0,
    });
    const again = pins(SAMPLE_PIN);
    await expect(authenticateWithCard(card, { origin: ORIGIN, nonce: NONCE, pin: again.provider })).rejects.toMatchObject({ code: "pin-blocked" });
    expect(again.requests).toEqual([]); // niet eens gevraagd
  });

  it("geeft pin-cancelled als de gebruiker annuleert", async () => {
    await expect(authenticateWithCard(await createSampleCard(), { origin: ORIGIN, nonce: NONCE, pin: pins(null).provider })).rejects.toMatchObject({
      code: "pin-cancelled",
    });
  });

  it("weigert een ongeldige nonce of origin", async () => {
    const card = await createSampleCard();
    const pin = pins(SAMPLE_PIN).provider;
    await expect(authenticateWithCard(card, { origin: ORIGIN, nonce: "kort", pin })).rejects.toMatchObject({ code: "bad-request" });
    await expect(authenticateWithCard(card, { origin: `${ORIGIN}/pad`, nonce: NONCE, pin })).rejects.toMatchObject({ code: "bad-request" });
    await expect(authenticateWithCard(card, { origin: "javascript:alert(1)", nonce: NONCE, pin })).rejects.toMatchObject({ code: "bad-request" });
  });

  it("weigert een te oude kaart (applet 1.1) zonder een PIN-poging te kosten", async () => {
    const cardData = new Uint8Array(28);
    cardData[21] = 0x11;
    const card = await createSampleCard({ cardData });
    const { provider, requests } = pins(SAMPLE_PIN);
    await expect(authenticateWithCard(card, { origin: ORIGIN, nonce: NONCE, pin: provider })).rejects.toMatchObject({ code: "unsupported-card" });
    expect(requests).toEqual([]);
    expect(card.pinTriesLeft).toBe(3);
  });

  it("bewaart de PIN nergens in de commandogeschiedenis", async () => {
    const card = await createSampleCard();
    await authenticateWithCard(card, { origin: ORIGIN, nonce: NONCE, pin: pins(SAMPLE_PIN).provider });
    expect(card.commands.map((c) => toHex(c)).join(" ")).not.toContain("241234");
  });

  it("stopt met aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      authenticateWithCard(await createSampleCard(), { origin: ORIGIN, nonce: NONCE, pin: pins(SAMPLE_PIN).provider, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
  });
});
