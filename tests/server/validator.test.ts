import { describe, expect, it } from "vitest";
import { authenticateWithCard, type EidAuthToken } from "../../packages/eid/src/core";
import { createSampleCard, SAMPLE_PIN } from "../../packages/eid/src/mock";
import {
  BELGIUM_ROOT_CAS,
  buildChain,
  clearIssuerCache,
  createNonce,
  EidAuthenticator,
  EidVerifyError,
  MemoryNonceStore,
  verifyEidToken,
} from "../../packages/eid/src/server";
import { cert, hasOpenssl, opensslResponder, pem } from "./helpers";

const ORIGIN = "https://sso.voorbeeld.be";
const TRUST = { roots: [pem("root")], intermediates: [pem("citizen-ca")] };

async function tokenFor(options: { appletVersion?: "1.7" | "1.8"; origin?: string; nonce: string }): Promise<EidAuthToken> {
  const card = await createSampleCard({ appletVersion: options.appletVersion ?? "1.8" });
  return authenticateWithCard(card, { origin: options.origin ?? ORIGIN, nonce: options.nonce, pin: async () => SAMPLE_PIN });
}

const fails = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(EidVerifyError.is(error), String(error)).toBe(true);
  expect((error as EidVerifyError).code).toBe(code);
};

describe("verifyEidToken (zonder OCSP)", () => {
  it("aanvaardt een token van de virtuele kaart (ES384 en RS256) en geeft de identiteit", async () => {
    for (const appletVersion of ["1.8", "1.7"] as const) {
      const nonce = createNonce();
      const token = await tokenFor({ appletVersion, nonce });
      const who = await verifyEidToken({ token, origin: ORIGIN, nonce, trust: TRUST, revocation: false });
      expect(who).toMatchObject({
        nationalNumber: "85031512369",
        firstNames: "Jan Pieter",
        lastName: "Specimen",
        commonName: "Jan Specimen (Authentication)",
        country: "BE",
        algorithm: appletVersion === "1.8" ? "ES384" : "RS256",
      });
    }
  });

  it("accepteert de origin met hoofdletters of een slash op het einde", async () => {
    const nonce = createNonce();
    const token = await tokenFor({ nonce });
    await expect(verifyEidToken({ token, origin: "https://SSO.voorbeeld.be/", nonce, trust: TRUST, revocation: false })).resolves.toBeDefined();
  });

  it("weigert een token voor een andere website of met een andere nonce", async () => {
    const nonce = createNonce();
    const token = await tokenFor({ nonce, origin: "https://evil.example" });
    await fails(verifyEidToken({ token, origin: ORIGIN, nonce, trust: TRUST, revocation: false }), "signature-invalid");
    const good = await tokenFor({ nonce });
    await fails(verifyEidToken({ token: good, origin: ORIGIN, nonce: createNonce(), trust: TRUST, revocation: false }), "signature-invalid");
  });

  it("weigert een aangepaste handtekening of een verwisseld certificaat", async () => {
    const nonce = createNonce();
    const token = await tokenFor({ nonce });
    const sig = Buffer.from(token.signature, "base64");
    sig[10]! ^= 1;
    await fails(verifyEidToken({ token: { ...token, signature: sig.toString("base64") }, origin: ORIGIN, nonce, trust: TRUST, revocation: false }), "signature-invalid");
    const rsa = await tokenFor({ nonce, appletVersion: "1.7" });
    await fails(
      verifyEidToken({ token: { ...token, unverifiedCertificate: rsa.unverifiedCertificate }, origin: ORIGIN, nonce, trust: TRUST, revocation: false }),
      "certificate-invalid",
    );
  });

  it("weigert rommel als token", async () => {
    const nonce = createNonce();
    const token = await tokenFor({ nonce });
    for (const bad of [null, "x", {}, { ...token, format: "web-eid:2.0" }, { ...token, algorithm: "HS256" }, { ...token, signature: "%%%" }]) {
      await fails(verifyEidToken({ token: bad, origin: ORIGIN, nonce, trust: TRUST, revocation: false }), "token-invalid");
    }
    await fails(verifyEidToken({ token: { ...token, unverifiedCertificate: "AAAA" }, origin: ORIGIN, nonce, trust: TRUST, revocation: false }), "certificate-invalid");
  });

  it("weigert een certificaat van een vreemde root (ook met een echte handtekening)", async () => {
    const nonce = createNonce();
    const token = await tokenFor({ nonce });
    await fails(verifyEidToken({ token, origin: ORIGIN, nonce, trust: { roots: [pem("rogue-root")], intermediates: [pem("citizen-ca")] }, revocation: false }), "chain-untrusted");
    await fails(verifyEidToken({ token, origin: ORIGIN, nonce, trust: { roots: [pem("root")], fetchIssuer: false }, revocation: false }), "chain-untrusted");
  });

  it("weigert buiten de geldigheid van het certificaat", async () => {
    const nonce = createNonce();
    const token = await tokenFor({ nonce });
    const later = new Date("2099-01-01T00:00:00Z");
    await fails(verifyEidToken({ token, origin: ORIGIN, nonce, trust: TRUST, revocation: false, now: () => later }), "certificate-expired");
  });

  it("zonder roots: duidelijke configuratiefout", async () => {
    const nonce = createNonce();
    const token = await tokenFor({ nonce });
    // Expliciet leeg, los van of de Belgische roots al opgehaald zijn.
    await fails(verifyEidToken({ token, origin: ORIGIN, nonce, trust: { roots: [] }, revocation: false }), "config-invalid");
  });

  it("de echte Belgische roots vertrouwen de test-PKI niet", async () => {
    const nonce = createNonce();
    const token = await tokenFor({ nonce });
    const code = BELGIUM_ROOT_CAS.length === 0 ? "config-invalid" : "chain-untrusted";
    await fails(verifyEidToken({ token, origin: ORIGIN, nonce, trust: { intermediates: [pem("citizen-ca")], fetchIssuer: false }, revocation: false }), code);
  });

  it("haalt een ontbrekend tussencertificaat op via AIA", async () => {
    clearIssuerCache();
    const nonce = createNonce();
    const token = await tokenFor({ nonce });
    const urls: string[] = [];
    const who = await verifyEidToken({
      token,
      origin: ORIGIN,
      nonce,
      trust: {
        roots: [pem("root")],
        fetchIssuer: async (url) => {
          urls.push(url);
          return new Uint8Array(cert("citizen-ca").raw);
        },
      },
      revocation: false,
    });
    expect(who.nationalNumber).toBe("85031512369");
    expect(urls).toEqual(["http://certs.test.invalid/citizen-ca.crt"]);
    // Een opgehaald certificaat dat niet tot de root leidt, helpt niet.
    clearIssuerCache();
    await fails(
      verifyEidToken({ token, origin: ORIGIN, nonce, trust: { roots: [pem("root")], fetchIssuer: async () => new Uint8Array(cert("rogue-root").raw) }, revocation: false }),
      "chain-untrusted",
    );
  });

  it("buildChain geeft blad → CA → root", async () => {
    const chain = await buildChain(cert("auth-ec"), { roots: [cert("root")], intermediates: [cert("citizen-ca")], now: new Date() });
    expect(chain.map((c) => c.subject.split("\n").find((l) => l.startsWith("CN=")))).toEqual([
      "CN=Jan Specimen (Authentication)",
      "CN=DafkeDD TEST Citizen CA",
      "CN=DafkeDD TEST Root CA",
    ]);
  });
});

describe.runIf(hasOpenssl())("verifyEidToken met OCSP", () => {
  it("controleert intrekking via de responder (fail closed)", async () => {
    const nonce = createNonce();
    const token = await tokenFor({ nonce });
    await expect(verifyEidToken({ token, origin: ORIGIN, nonce, trust: TRUST, revocation: { fetch: opensslResponder() } })).resolves.toBeDefined();
    await fails(
      verifyEidToken({
        token,
        origin: ORIGIN,
        nonce,
        trust: TRUST,
        revocation: {
          fetch: async () => {
            throw new Error("down");
          },
        },
      }),
      "revocation-unavailable",
    );
  });
});

describe("EidAuthenticator", () => {
  it("challenge → token → identiteit; de nonce werkt maar één keer", async () => {
    const eid = new EidAuthenticator({ origin: ORIGIN, trust: TRUST, revocation: false });
    const { nonce, expiresAt } = await eid.createChallenge();
    expect(nonce).toHaveLength(44);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const token = await tokenFor({ nonce });
    expect((await eid.verify(token, nonce)).nationalNumber).toBe("85031512369");
    await fails(eid.verify(token, nonce), "nonce-invalid");
  });

  it("weigert een verlopen of onbekende nonce, en verbruikt hem ook bij een fout", async () => {
    let now = new Date();
    const eid = new EidAuthenticator({ origin: ORIGIN, trust: TRUST, revocation: false, nonceTtlMs: 1000, now: () => now });
    const { nonce } = await eid.createChallenge();
    const token = await tokenFor({ nonce });
    now = new Date(now.getTime() + 2000);
    await fails(eid.verify(token, nonce), "nonce-invalid");
    await fails(eid.verify(token, createNonce()), "nonce-invalid");
    await fails(eid.verify(token, "kort"), "nonce-invalid");

    now = new Date();
    const second = await eid.createChallenge();
    const wrong = await tokenFor({ nonce: second.nonce, origin: "https://evil.example" });
    await fails(eid.verify(wrong, second.nonce), "signature-invalid");
    const right = await tokenFor({ nonce: second.nonce });
    await fails(eid.verify(right, second.nonce), "nonce-invalid"); // al verbruikt
  });

  it("weigert een ongeldige origin in de instellingen", () => {
    expect(() => new EidAuthenticator({ origin: "sso.voorbeeld.be" })).toThrow(/Ongeldige origin/);
    expect(() => new EidAuthenticator({ origin: "https://sso.voorbeeld.be/login" })).toThrow(/Ongeldige origin/);
  });
});

describe("MemoryNonceStore", () => {
  it("vergeet de oudste als hij vol zit", () => {
    const store = new MemoryNonceStore({ maxSize: 2 });
    const later = new Date(Date.now() + 60_000);
    store.save("a", later);
    store.save("b", later);
    store.save("c", later);
    expect(store.size).toBe(2);
    expect(store.consume("a", new Date())).toBe(false);
    expect(store.consume("c", new Date())).toBe(true);
  });
});
