/**
 * De volledige keten zoals in productie, met de virtuele kaart:
 * server maakt challenge → browser (EidClient) vraagt de bridge → kaart ondertekent → server controleert.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSampleCard } from "../../packages/eid/src/mock";
import { createEidReader, MockPcscBackend, startBridge } from "../../packages/eid/src/node";
import { EidClient } from "../../packages/eid/src/react";
import { createNonce, EidAuthenticator, verifyEidToken } from "../../packages/eid/src/server";
import { hasOpenssl, opensslResponder, pem } from "./helpers";

const SSO = "https://sso.voorbeeld.be";
let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
});

async function setup(appletVersion: "1.7" | "1.8") {
  const backend = new MockPcscBackend().addReader("Lezer");
  backend.insertCard("Lezer", await createSampleCard({ appletVersion }));
  const reader = await createEidReader({ backend, pollTimeoutMs: 20 });
  const bridge = await startBridge({ reader, port: 0, authOrigins: [SSO] });
  cleanup.push(async () => {
    await bridge.close();
    await reader.close();
  });
  /** Zoals een browser op https://sso.voorbeeld.be: die zet de Origin-header. */
  const browserFetch = (origin: string): typeof fetch => (input, init) =>
    fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), origin } });
  return { bridge, browserFetch };
}

describe.runIf(hasOpenssl())("van kaart tot server", () => {
  for (const appletVersion of ["1.8", "1.7"] as const) {
    it(`applet ${appletVersion}: challenge → bridge → token → identiteit (met OCSP)`, async () => {
      const { bridge, browserFetch } = await setup(appletVersion);
      const server = new EidAuthenticator({
        origin: SSO,
        trust: { roots: [pem("root")], intermediates: [pem("citizen-ca")] },
        revocation: { fetch: opensslResponder() },
      });
      const { nonce } = await server.createChallenge();
      const { token } = await new EidClient({ url: bridge.url, fetch: browserFetch(SSO) }).authenticate({ nonce, pin: "1234" });
      const who = await server.verify(JSON.parse(JSON.stringify(token)), nonce);
      expect(who).toMatchObject({ nationalNumber: "85031512369", firstNames: "Jan Pieter", lastName: "Specimen" });
    });
  }

  it("een andere website krijgt geen token, en een token voor jouw site werkt nergens anders", async () => {
    const { bridge, browserFetch } = await setup("1.8");
    const nonce = createNonce();
    // De bridge weigert evil.example (in een browser ziet die site zelfs geen antwoord: geen CORS).
    await expect(new EidClient({ url: bridge.url, fetch: browserFetch("https://evil.example") }).authenticate({ nonce, pin: "1234" })).rejects.toMatchObject({
      code: "origin-not-allowed",
    });
    // Een echt token voor sso.voorbeeld.be, aangeboden aan een andere server: handtekening klopt niet.
    const { token } = await new EidClient({ url: bridge.url, fetch: browserFetch(SSO) }).authenticate({ nonce, pin: "1234" });
    const trust = { roots: [pem("root")], intermediates: [pem("citizen-ca")] };
    await expect(verifyEidToken({ token, origin: "https://andere-site.be", nonce, trust, revocation: false })).rejects.toMatchObject({ code: "signature-invalid" });
    await expect(verifyEidToken({ token, origin: SSO, nonce, trust, revocation: false })).resolves.toMatchObject({ lastName: "Specimen" });
  });
});
