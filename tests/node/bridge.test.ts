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
function call(bridge: Bridge, path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Res> {
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
    req.end();
  });
}

const ORIGIN = { origin: "http://localhost:3000" };
let cleanup: Array<() => Promise<void>> = [];

async function setup(options: { token?: string; origins?: string[]; card?: boolean } = {}) {
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
