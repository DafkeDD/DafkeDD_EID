/**
 * Test met een ECHTE kaartlezer en eID. Steek je eID in en draai: npm run test:integration
 * Persoonsgegevens worden alleen gemaskeerd getoond.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkNationalNumber, type EidCardData } from "../../packages/eid/src/core";
import { formatCard } from "../../packages/eid/src/node/cli";
import { createEidReader, type EidReader } from "../../packages/eid/src/node";

let reader: EidReader;
let readerName: string;
let data: EidCardData;

beforeAll(async () => {
  reader = await createEidReader({ onError: (error) => console.error("Monitorfout:", error) });
  const readers = reader.readers();
  console.log(`Platform: ${process.platform} ${process.arch}, Node ${process.version}`);
  console.log(`Kaartlezers: ${readers.map((r) => `${r.name}${r.cardPresent ? " [kaart]" : " [leeg]"}`).join(", ") || "(geen)"}`);
  const withCard = readers.find((r) => r.cardPresent);
  if (!withCard) {
    // Even wachten: soms meldt de lezer de kaart pas na de eerste ronde.
    await new Promise((r) => setTimeout(r, 2000));
    console.log(`Na 2 s: ${reader.readers().map((r) => `${r.name}${r.cardPresent ? " [kaart]" : " [leeg]"}`).join(", ") || "(geen)"}`);
  }
  const retry = withCard ?? reader.readers().find((r) => r.cardPresent);
  if (!retry) throw new Error("Geen kaartlezer met kaart gevonden. Sluit een lezer aan, steek je eID in en probeer opnieuw.");
  readerName = retry.name;
  console.log(`ATR: ${retry.atr}`);
});

afterAll(async () => {
  await reader?.close();
});

describe("echte eID", () => {
  it("leest identiteit, adres, foto en kaartinfo", async () => {
    const start = Date.now();
    data = await reader.read(readerName);
    console.log(`Uitgelezen in ${Date.now() - start} ms\n\n${formatCard(readerName, data, false)}`);

    expect(checkNationalNumber(data.identity.nationalNumber).valid).toBe(true);
    expect(data.identity.lastName.length).toBeGreaterThan(0);
    expect(data.identity.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.identity.dateOfBirth).not.toBeNull();
    expect(data.identity.gender).not.toBe("unknown");
    expect(data.address.municipality.length).toBeGreaterThan(0);
    expect(data.photo?.data.subarray(0, 2)).toEqual(Uint8Array.of(0xff, 0xd8)); // JPEG
    expect(["1.7", "1.8"]).toContain(data.cardInfo?.appletVersion);
  });

  it("splitst het adres in straat en huisnummer", () => {
    console.log(`Adres gesplitst: straat ${data.address.street ? "ok" : "LEEG"}, huisnummer ${data.address.houseNumber ? "ok" : "LEEG"}, bus ${data.address.box ? "ja" : "nee"}`);
    expect(data.address.street.length).toBeGreaterThan(0);
  });

  it("meldt onbekende velden (nieuwere kaarten)", () => {
    console.log(`Onbekende velden: identiteit ${JSON.stringify(Object.keys(data.identity.unknownFields))}, adres ${JSON.stringify(Object.keys(data.address.unknownFields))}`);
  });

  it("leest de certificaten (DER)", async () => {
    const { certificates } = await reader.read(readerName, { photo: false, certificates: true });
    expect(certificates?.root[0]).toBe(0x30);
    expect(certificates?.ca[0]).toBe(0x30);
    expect(certificates?.rrn[0]).toBe(0x30);
    console.log(`Certificaten: auth ${certificates?.authentication ? "ja" : "nee"}, handtekening ${certificates?.signing ? "ja" : "nee"}`);
  });

  it("leest drie keer na elkaar zonder problemen", async () => {
    for (let i = 0; i < 3; i++) await reader.read(readerName, { photo: false });
  });
});

/**
 * Aanmelden met je echte PIN: alleen als EID_TEST_PIN gezet is (PowerShell: $env:EID_TEST_PIN="…").
 * Opgelet: een verkeerde PIN kost een poging; na 3 is de PIN geblokkeerd.
 */
describe.runIf(Boolean(process.env.EID_TEST_PIN))("echte eID: aanmelden met PIN", () => {
  it("geeft een web-eid-token met een geldige handtekening", async () => {
    const { createHash, verify, X509Certificate } = await import("node:crypto");
    const origin = "https://test.dafkedd.be";
    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    let asked = 0;
    const token = await reader.authenticate(readerName, {
      origin,
      nonce,
      pin: async ({ triesLeft, retry }) => {
        console.log(`PIN gevraagd (pogingen over: ${triesLeft ?? "?"}${retry ? ", na verkeerde PIN" : ""})`);
        if (retry || asked++ > 0) return null; // nooit een tweede poging met dezelfde PIN
        return process.env.EID_TEST_PIN!;
      },
    });
    const cert = new X509Certificate(Buffer.from(token.unverifiedCertificate, "base64"));
    const hash = token.algorithm === "ES384" ? "sha384" : "sha256";
    const signed = Buffer.concat([createHash(hash).update(origin).digest(), createHash(hash).update(nonce).digest()]);
    const key = token.algorithm.startsWith("ES") ? { key: cert.publicKey, dsaEncoding: "ieee-p1363" as const } : cert.publicKey;
    expect(verify(hash, signed, key, Buffer.from(token.signature, "base64"))).toBe(true);
    console.log(`Aanmelden gelukt: ${token.algorithm}, certificaat-uitgever: ${cert.issuer.split("\n").find((l) => l.startsWith("CN="))}`);
  });
});
