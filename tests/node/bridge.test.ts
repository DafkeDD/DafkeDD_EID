import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { decodeCardData, readEid, type CardResponse } from "../../packages/eid/src/core";
import { createSampleCard, type VirtualCard } from "../../packages/eid/src/mock";
import { createEidReader, MockPcscBackend, startBridge, type Bridge, type EidReader } from "../../packages/eid/src/node";

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: any;
}

/** node:http in plaats van fetch: zo kunnen we ook Host en Origin vrij kiezen. */
function call(bridge: Bridge, path: string, headers: Record<string, string> = {}, method = "GET", body?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: bridge.port, path, method, headers: { host: `127.0.0.1:${bridge.port}`, ...headers } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          let json: unknown;
          try {
            json = JSON.parse(body);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

const ORIGIN = { origin: "http://localhost:3000" };
let cleanup: Array<() => Promise<void>> = [];

async function setup(options: { token?: string; origins?: string[]; authOrigins?: string[]; card?: boolean; testpage?: boolean } = {}) {
  const backend = new MockPcscBackend().addReader("Lezer");
  let card: VirtualCard | undefined;
  if (options.card !== false) {
    card = await createSampleCard();
    backend.insertCard("Lezer", card);
  }
  const reader: EidReader = await createEidReader({ backend, pollTimeoutMs: 20 });
  const bridge = await startBridge({
    reader,
    port: 0,
    ...(options.token ? { token: options.token } : {}),
    ...(options.origins ? { origins: options.origins } : {}),
    ...(options.testpage !== undefined ? { testpage: options.testpage } : {}),
    ...(options.authOrigins ? { authOrigins: options.authOrigins } : {}),
  });
  cleanup.push(async () => {
    await bridge.close();
    await reader.close();
  });
  return { backend, reader, bridge, card };
}

const until = async (check: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("time-out in test");
    await new Promise((r) => setTimeout(r, 5));
  }
};

afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
});

describe("bridge: toegang", () => {
  it("geeft status aan een toegelaten website, met CORS-headers en no-store", async () => {
    const { bridge } = await setup();
    const res = await call(bridge, "/v1/status", ORIGIN);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ name: "dafke-eid", protocol: 1, readers: [{ name: "Lezer", cardPresent: true }] });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("weigert een vreemde website zonder CORS-headers", async () => {
    const { bridge } = await setup();
    const res = await call(bridge, "/v1/card", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("origin-not-allowed");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("weigert een vreemde Host-header (DNS-rebinding)", async () => {
    const { bridge } = await setup();
    const res = await call(bridge, "/v1/status", { ...ORIGIN, host: `evil.example:${bridge.port}` });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("unauthorized");
  });

  it("aanvaardt localhost en [::1] als Host", async () => {
    const { bridge } = await setup();
    expect((await call(bridge, "/v1/status", { host: `localhost:${bridge.port}` })).status).toBe(200);
    expect((await call(bridge, "/v1/status", { host: `[::1]:${bridge.port}` })).status).toBe(200);
  });

  it("zonder Origin: wel voor gewone programma's, niet voor cross-site browserverzoeken", async () => {
    const { bridge } = await setup();
    expect((await call(bridge, "/v1/status")).status).toBe(200);
    expect((await call(bridge, "/v1/status", { "sec-fetch-site": "none" })).status).toBe(200);
    expect((await call(bridge, "/v1/card", { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  it("beantwoordt een preflight, inclusief Private Network Access", async () => {
    const { bridge } = await setup();
    const res = await call(bridge, "/v1/card", { ...ORIGIN, "access-control-request-private-network": "true", "access-control-request-method": "GET" }, "OPTIONS");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-private-network"]).toBe("true");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const evil = await call(bridge, "/v1/card", { origin: "https://evil.example", "access-control-request-private-network": "true" }, "OPTIONS");
    expect(evil.status).toBe(403);
    expect(evil.headers["access-control-allow-private-network"]).toBeUndefined();
  });

  it("gebruikt de eigen allowlist", async () => {
    const { bridge } = await setup({ origins: ["https://app.voorbeeld.be"] });
    expect((await call(bridge, "/v1/status", { origin: "https://app.voorbeeld.be" })).status).toBe(200);
    expect((await call(bridge, "/v1/status", ORIGIN)).status).toBe(403);
  });

  it("vraagt het token als het ingesteld is", async () => {
    const { bridge } = await setup({ token: "geheim" });
    expect((await call(bridge, "/v1/status", ORIGIN)).status).toBe(401);
    expect((await call(bridge, "/v1/status", { ...ORIGIN, authorization: "Bearer fout" })).status).toBe(401);
    expect((await call(bridge, "/v1/status", { ...ORIGIN, authorization: "Bearer geheim" })).status).toBe(200);
    expect((await call(bridge, "/v1/status", { ...ORIGIN, "x-dafke-eid-token": "geheim" })).status).toBe(200);
    // Token in de URL alleen voor /v1/events (EventSource kan geen headers zetten).
    expect((await call(bridge, "/v1/status?token=geheim", ORIGIN)).status).toBe(401);
  });

  it("weigert andere adressen dan loopback en ongeldige origin-patronen", async () => {
    const reader = await createEidReader({ backend: new MockPcscBackend() });
    cleanup.push(() => reader.close());
    await expect(startBridge({ reader, port: 0, host: "0.0.0.0" as never })).rejects.toThrow(/loopback/);
    await expect(startBridge({ reader, port: 0, origins: ["*"] })).rejects.toThrow(/Ongeldig origin-patroon/);
  });

  it("meldt een bezette poort duidelijk", async () => {
    const { bridge, reader } = await setup();
    await expect(startBridge({ reader, port: bridge.port })).rejects.toThrow(/al in gebruik/);
  });

  it("geeft 404 not-found voor onbekende adressen en methodes", async () => {
    const { bridge } = await setup();
    expect((await call(bridge, "/v1/bestaat-niet", ORIGIN)).json.error.code).toBe("not-found");
    expect((await call(bridge, "/v1/status", ORIGIN, "POST")).status).toBe(404);
  });
});

describe("bridge: kaart", () => {
  it("leest de kaart en geeft dezelfde gegevens als readEid", async () => {
    const { bridge } = await setup();
    const res = await call(bridge, "/v1/card", ORIGIN);
    expect(res.status).toBe(200);
    const body = res.json as CardResponse;
    expect(body.reader).toBe("Lezer");
    const expected = await readEid(await createSampleCard());
    expect(decodeCardData(body.card)).toEqual(expected);
  });

  it("laat de foto weg met photo=0", async () => {
    const { bridge } = await setup();
    const body = (await call(bridge, "/v1/card?photo=0", ORIGIN)).json as CardResponse;
    expect(body.card.photo).toBeUndefined();
    expect(body.card.identity.lastName).toBe("Specimen");
  });

  it("onthoudt de kaart tot ze eruit gaat", async () => {
    const { bridge, backend, card } = await setup();
    await call(bridge, "/v1/card", ORIGIN);
    const after1 = card!.commands.length;
    await call(bridge, "/v1/card", ORIGIN);
    expect(card!.commands.length).toBe(after1); // niets opnieuw gelezen

    backend.removeCard("Lezer");
    const fresh = await createSampleCard({ identity: { lastName: "Nieuw" } });
    backend.insertCard("Lezer", fresh);
    await new Promise((r) => setTimeout(r, 100)); // monitor (20 ms per ronde) merkt de wissel op
    const body = (await call(bridge, "/v1/card", ORIGIN)).json as CardResponse;
    expect(body.card.identity.lastName).toBe("Nieuw");
  });

  it("geeft 409 no-card zonder kaart", async () => {
    const { bridge } = await setup({ card: false });
    const res = await call(bridge, "/v1/card", ORIGIN);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("no-card");
  });

  it("geeft 409 no-reader voor een onbekende lezer", async () => {
    const { bridge } = await setup();
    expect((await call(bridge, `/v1/card?reader=${encodeURIComponent("Andere")}`, ORIGIN)).json.error.code).toBe("no-reader");
  });
});

describe("bridge: events (SSE)", () => {
  it("stuurt eerst de status en daarna kaartgebeurtenissen", async () => {
    const { bridge, backend } = await setup();
    const received: string[] = [];
    const req = request({
      host: "127.0.0.1",
      port: bridge.port,
      path: "/v1/events",
      headers: { host: `127.0.0.1:${bridge.port}`, ...ORIGIN },
    });
    req.on("response", (res) => {
      expect(res.headers["content-type"]).toContain("text/event-stream");
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
      res.on("data", (chunk) => received.push(String(chunk)));
    });
    req.end();
    await until(() => received.join("").includes("event: status"));
    backend.removeCard("Lezer");
    await until(() => received.join("").includes("event: card-removed"));
    const text = received.join("");
    expect(text).toContain('data: {"type":"card-removed","reader":"Lezer"}');
    backend.insertCard("Lezer", await createSampleCard());
    await until(() => received.join("").includes("event: card-inserted"));
    expect(received.join("")).toMatch(/"atr":"3b7f/);
    req.destroy();
  });

  it("aanvaardt het token in de URL voor events", async () => {
    const { bridge } = await setup({ token: "geheim" });
    const status = await new Promise<number>((resolve) => {
      const req = request({ host: "127.0.0.1", port: bridge.port, path: "/v1/events?token=geheim", headers: { host: `127.0.0.1:${bridge.port}` } });
      req.on("response", (res) => {
        resolve(res.statusCode ?? 0);
        req.destroy();
      });
      req.end();
    });
    expect(status).toBe(200);
  });
});

const OWN = { "sec-fetch-site": "same-origin" };
const PII = ["Specimen", "Jan Pieter", "85031512369", "Voorbeeldstraat"];

describe("bridge: testpagina", () => {
  it("serveert de pagina met strikte CSP en zonder framing", async () => {
    const { bridge } = await setup();
    const page = await call(bridge, "/");
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("DafkeDD eID");
    expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(page.headers["x-frame-options"]).toBe("DENY");
    expect((await call(bridge, "/testpage.js")).headers["content-type"]).toContain("javascript");
    expect((await call(bridge, "/testpage.css")).headers["content-type"]).toContain("text/css");
  });

  it("staat uit met testpage: false", async () => {
    const { bridge } = await setup({ testpage: false });
    expect((await call(bridge, "/")).status).toBe(404);
    expect((await call(bridge, "/v1/test/info", OWN)).status).toBe(404);
  });

  it("geeft info aan de eigen pagina, niet aan andere websites", async () => {
    const { bridge } = await setup({ origins: ["https://app.voorbeeld.be"] });
    const info = await call(bridge, "/v1/test/info", OWN);
    expect(info.status).toBe(200);
    expect(info.json).toMatchObject({ origins: ["https://app.voorbeeld.be"], tokenRequired: false, protocol: 1 });
    expect((await call(bridge, "/v1/test/info", { origin: "https://app.voorbeeld.be" })).status).toBe(403);
    expect((await call(bridge, "/v1/test/info", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await call(bridge, "/v1/test/info", { origin: `http://127.0.0.1:${bridge.port}` })).status).toBe(200);
    expect((await call(bridge, "/v1/test/info", { origin: `http://localhost:${bridge.port}` })).status).toBe(200);
  });

  it("laat de eigen pagina de gewone endpoints gebruiken, ook met een strikte allowlist", async () => {
    const { bridge } = await setup({ origins: ["https://app.voorbeeld.be"] });
    expect((await call(bridge, "/v1/status", { origin: `http://127.0.0.1:${bridge.port}` })).status).toBe(200);
    expect((await call(bridge, "/v1/card", OWN)).status).toBe(200);
  });

  it("vraagt het token van de eigen pagina alleen voor de kaart", async () => {
    const { bridge } = await setup({ token: "geheim" });
    expect((await call(bridge, "/v1/test/info", OWN)).json.tokenRequired).toBe(true);
    expect((await call(bridge, "/v1/status", OWN)).status).toBe(200);
    expect((await call(bridge, "/v1/card", OWN)).status).toBe(401);
    expect((await call(bridge, "/v1/card", { ...OWN, "x-dafke-eid-token": "geheim" })).status).toBe(200);
  });

  it("controleert of een website toegelaten is", async () => {
    const { bridge } = await setup({ origins: ["https://*.voorbeeld.be"] });
    const yes = await call(bridge, `/v1/test/check-origin?origin=${encodeURIComponent("https://app.voorbeeld.be/")}`, OWN);
    expect(yes.json).toMatchObject({ origin: "https://app.voorbeeld.be", allowed: true });
    const no = await call(bridge, `/v1/test/check-origin?origin=${encodeURIComponent("https://evil.example")}`, OWN);
    expect(no.json.allowed).toBe(false);
  });

  it("maakt een diagnose zonder persoonsgegevens", async () => {
    const { bridge } = await setup();
    const diag = await call(bridge, "/v1/test/diag", OWN);
    expect(diag.status).toBe(200);
    expect(diag.body).toContain('"Lezer": kaart aanwezig');
    expect(diag.body).toContain("GET CARD DATA: SW 9000, applet 1.8");
    expect(diag.body).toContain("SELECT identiteit: SW 9000 (Belgische eID)");
    for (const word of PII) expect(diag.body).not.toContain(word);
  });

  it("houdt een logboek bij zonder persoonsgegevens", async () => {
    const { bridge, backend } = await setup({ origins: ["https://app.voorbeeld.be"] });
    await call(bridge, "/v1/card", { origin: "https://app.voorbeeld.be" });
    await call(bridge, "/v1/card", { origin: "https://evil.example" });
    backend.removeCard("Lezer");
    await until(() => bridge.logbook.entries().some((e) => e.message.includes("Kaart verwijderd")));
    const log = await call(bridge, "/v1/test/log", OWN);
    const messages = (log.json.entries as Array<{ message: string }>).map((e) => e.message).join("\n");
    expect(messages).toContain("gestart op");
    expect(messages).toContain("GET /v1/card → 200");
    expect(messages).toContain("van https://app.voorbeeld.be");
    expect(messages).toContain("Geweigerd: https://evil.example");
    expect(messages).toContain('Kaart verwijderd uit "Lezer"');
    for (const word of PII) expect(messages).not.toContain(word);
  });
});

const SSO = "https://sso.voorbeeld.be";
const NONCE = "n".repeat(44);
const post = (bridge: Bridge, body: unknown, headers: Record<string, string> = { origin: SSO }) =>
  call(bridge, "/v1/authenticate", { "content-type": "application/json", ...headers }, "POST", typeof body === "string" ? body : JSON.stringify(body));

describe("bridge: aanmelden met PIN", () => {
  it("geeft een web-eid-token aan een website in authOrigins, met de Origin-header ondertekend", async () => {
    const { bridge } = await setup({ authOrigins: [SSO] });
    const res = await post(bridge, { nonce: NONCE, pin: "1234" });
    expect(res.status).toBe(200);
    expect(res.json.reader).toBe("Lezer");
    expect(res.json.token).toMatchObject({ format: "web-eid:1.0", algorithm: "ES384" });
    const { createHash, verify, X509Certificate } = await import("node:crypto");
    const cert = new X509Certificate(Buffer.from(res.json.token.unverifiedCertificate, "base64"));
    const signed = Buffer.concat([createHash("sha384").update(SSO).digest(), createHash("sha384").update(NONCE).digest()]);
    expect(verify("sha384", signed, { key: cert.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(res.json.token.signature, "base64"))).toBe(true);
    expect(res.headers["access-control-allow-origin"]).toBe(SSO);
  });

  it("weigert aanmelden voor websites die alleen mogen lezen, of helemaal niet toegelaten zijn", async () => {
    const { bridge } = await setup({ origins: ["https://app.voorbeeld.be"], authOrigins: [SSO] });
    const readOnly = await post(bridge, { nonce: NONCE, pin: "1234" }, { origin: "https://app.voorbeeld.be" });
    expect(readOnly.status).toBe(403);
    expect(readOnly.json.error.code).toBe("auth-not-allowed");
    expect((await post(bridge, { nonce: NONCE, pin: "1234" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(bridge, { nonce: NONCE, pin: "1234" }, {})).json.error.code).toBe("auth-not-allowed");
  });

  it("standaard mag niemand aanmelden (authOrigins leeg)", async () => {
    const { bridge } = await setup();
    expect((await post(bridge, { nonce: NONCE, pin: "1234" }, { origin: "http://localhost:3000" })).json.error.code).toBe("auth-not-allowed");
  });

  it("een website die alleen mag aanmelden, kan de kaart niet lezen", async () => {
    const { bridge } = await setup({ origins: ["https://app.voorbeeld.be"], authOrigins: [SSO] });
    expect((await call(bridge, "/v1/status", { origin: SSO })).status).toBe(200);
    const card = await call(bridge, "/v1/card", { origin: SSO });
    expect(card.status).toBe(403);
    expect(card.json.error.message).toContain("alleen aanmelden");
  });

  it("verkeerde PIN: 409 pin-incorrect met resterende pogingen, en daarna lukt het", async () => {
    const { bridge } = await setup({ authOrigins: [SSO] });
    const wrong = await post(bridge, { nonce: NONCE, pin: "0000" });
    expect(wrong.status).toBe(409);
    expect(wrong.json.error).toMatchObject({ code: "pin-incorrect", triesLeft: 2 });
    expect((await post(bridge, { nonce: NONCE, pin: "1234" })).status).toBe(200);
  });

  it("geblokkeerde PIN: pin-blocked", async () => {
    const { bridge } = await setup({ authOrigins: [SSO] });
    for (const pin of ["0000", "1111"]) await post(bridge, { nonce: NONCE, pin });
    const blocked = await post(bridge, { nonce: NONCE, pin: "2222" });
    expect(blocked.json.error).toMatchObject({ code: "pin-blocked", triesLeft: 0 });
  });

  it("controleert de aanvraag vóór de kaart aan te spreken", async () => {
    const { bridge, card } = await setup({ authOrigins: [SSO] });
    const before = card!.commands.length;
    expect((await post(bridge, { nonce: NONCE, pin: "12" })).json.error.code).toBe("bad-request");
    expect((await post(bridge, { nonce: "kort", pin: "1234" })).json.error.code).toBe("bad-request");
    expect((await post(bridge, "{kapot")).json.error.code).toBe("bad-request");
    expect((await post(bridge, "x".repeat(5000))).json.error.code).toBe("bad-request");
    expect((await call(bridge, "/v1/authenticate", { origin: SSO, "content-type": "text/plain" }, "POST", "{}")).json.error.code).toBe("bad-request");
    expect(card!.commands.length).toBe(before);
    expect(card!.pinTriesLeft).toBe(3);
  });

  it("vraagt het token, ook om aan te melden", async () => {
    const { bridge } = await setup({ authOrigins: [SSO], token: "geheim" });
    expect((await post(bridge, { nonce: NONCE, pin: "1234" })).status).toBe(401);
    expect((await post(bridge, { nonce: NONCE, pin: "1234" }, { origin: SSO, "x-dafke-eid-token": "geheim" })).status).toBe(200);
  });

  it("staat POST toe in de preflight", async () => {
    const { bridge } = await setup({ authOrigins: [SSO] });
    const res = await call(bridge, "/v1/authenticate", { origin: SSO, "access-control-request-method": "POST" }, "OPTIONS");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("de eigen testpagina mag aanmelden (met haar eigen origin)", async () => {
    const { bridge } = await setup();
    const res = await post(bridge, { nonce: NONCE, pin: "1234" }, { origin: `http://127.0.0.1:${bridge.port}` });
    expect(res.status).toBe(200);
  });

  it("logt nooit PIN of nonce", async () => {
    const { bridge } = await setup({ authOrigins: [SSO] });
    await post(bridge, { nonce: NONCE, pin: "0000" });
    await post(bridge, { nonce: NONCE, pin: "1234" });
    // Poortnummer eruit: een willekeurige poort kan "1234" bevatten.
    const text = bridge.logbook.entries().map((e) => e.message).join("\n").replaceAll(String(bridge.port), "<poort>");
    expect(text).toContain(`Aanmelden gevraagd door ${SSO}`);
    expect(text).toContain("Aanmelden mislukt");
    expect(text).toContain("pin-incorrect (nog 2)");
    expect(text).toContain("Aanmelden gelukt");
    expect(text).not.toContain("1234");
    expect(text).not.toContain("0000");
    expect(text).not.toContain(NONCE);
  });

  it("GET op /v1/authenticate kan niet", async () => {
    const { bridge } = await setup({ authOrigins: [SSO] });
    expect((await call(bridge, "/v1/authenticate", { origin: SSO })).status).toBe(404);
  });
});
