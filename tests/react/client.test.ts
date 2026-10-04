import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleCard } from "../../packages/eid/src/mock";
import { createEidReader, MockPcscBackend, startBridge, type Bridge, type EidReader } from "../../packages/eid/src/node";
import { EidClient, type EidClientEvent } from "../../packages/eid/src/react";

let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
});

async function bridgeWithCard(token?: string, authOrigins?: string[]): Promise<{ bridge: Bridge; reader: EidReader }> {
  const backend = new MockPcscBackend().addReader("Lezer");
  backend.insertCard("Lezer", await createSampleCard());
  const reader = await createEidReader({ backend, pollTimeoutMs: 20 });
  const bridge = await startBridge({ reader, port: 0, ...(token ? { token } : {}), ...(authOrigins ? { authOrigins } : {}) });
  cleanup.push(async () => {
    await bridge.close();
    await reader.close();
  });
  return { bridge, reader };
}

describe("EidClient tegen een echte bridge (mock-lezer)", () => {
  it("haalt status en kaart op", async () => {
    const { bridge } = await bridgeWithCard();
    const client = new EidClient({ url: bridge.url });
    expect((await client.status()).readers).toEqual([expect.objectContaining({ name: "Lezer", cardPresent: true })]);
    const { reader, card } = await client.readCard();
    expect(reader).toBe("Lezer");
    expect(card.identity.lastName).toBe("Specimen");
    expect(card.photo?.data).toBeInstanceOf(Uint8Array);
    expect((await client.readCard({ photo: false })).card.photo).toBeUndefined();
  });

  it("stuurt het token mee", async () => {
    const { bridge } = await bridgeWithCard("geheim");
    await expect(new EidClient({ url: bridge.url }).status()).rejects.toMatchObject({ code: "unauthorized" });
    await expect(new EidClient({ url: bridge.url, token: "geheim" }).status()).resolves.toMatchObject({ name: "dafke-eid" });
  });

  it("zet foutantwoorden om naar EidError", async () => {
    const { bridge } = await bridgeWithCard();
    await expect(new EidClient({ url: bridge.url }).readCard({ reader: "Bestaat niet" })).rejects.toMatchObject({ code: "no-reader" });
  });

  it("meldt aan met PIN (POST) en geeft triesLeft door bij een verkeerde PIN", async () => {
    const { bridge } = await bridgeWithCard(undefined, ["https://sso.voorbeeld.be"]);
    // Node's fetch stuurt geen Origin; zoals een browser doet, zetten we hem zelf.
    const withOrigin: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: "https://sso.voorbeeld.be" } });
    const client = new EidClient({ url: bridge.url, fetch: withOrigin });
    await expect(client.authenticate({ nonce: "n".repeat(44), pin: "0000" })).rejects.toMatchObject({ code: "pin-incorrect", triesLeft: 2 });
    const { token, reader } = await client.authenticate({ nonce: "n".repeat(44), pin: "1234" });
    expect(reader).toBe("Lezer");
    expect(token.format).toBe("web-eid:1.0");
  });

  it("geeft no-bridge als er niets luistert", async () => {
    await expect(new EidClient({ url: "http://127.0.0.1:1" }).status()).rejects.toMatchObject({ code: "no-bridge" });
  });
});

/** Minimale EventSource voor tests. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static last: FakeEventSource | undefined;
  readyState = FakeEventSource.CONNECTING;
  onerror: (() => void) | null = null;
  closed = false;
  readonly handlers = new Map<string, (event: { data: string }) => void>();
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, handler: (event: { data: string }) => void) {
    this.handlers.set(type, handler);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  fire(type: string, data: unknown) {
    this.readyState = FakeEventSource.OPEN;
    this.handlers.get(type)?.({ data: JSON.stringify(data) });
  }
  fail(closed = false) {
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.onerror?.();
  }
}

describe("EidClient.subscribe (EventSource)", () => {
  it("vertaalt SSE-gebeurtenissen, meldt verbroken verbindingen één keer en sluit bij uitschrijven", () => {
    const client = new EidClient({ url: "http://127.0.0.1:47820/", token: "t k", EventSource: FakeEventSource as never });
    const events: EidClientEvent[] = [];
    const stop = client.subscribe((e) => events.push(e));
    const source = FakeEventSource.last!;
    expect(source.url).toBe("http://127.0.0.1:47820/v1/events?token=t%20k");

    source.fail();
    source.fail();
    source.fire("status", { name: "dafke-eid", version: "1", protocol: 1, readers: [] });
    source.fire("card-inserted", { type: "card-inserted", reader: "A", atr: "3b" });
    source.fail();

    expect(events.map((e) => e.type)).toEqual(["disconnected", "status", "card-inserted", "disconnected"]);
    stop();
    expect(source.closed).toBe(true);
  });

  it("probeert zelf opnieuw als de browser de verbinding definitief sluit", async () => {
    const client = new EidClient({ EventSource: FakeEventSource as never, reconnectMs: 10 });
    const stop = client.subscribe(() => {});
    const first = FakeEventSource.last!;
    first.fail(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(FakeEventSource.last).not.toBe(first);
    stop();
  });

  it("meldt disconnected als EventSource niet bestaat (bv. op de server)", () => {
    vi.stubGlobal("EventSource", undefined);
    try {
      const events: EidClientEvent[] = [];
      const stop = new EidClient().subscribe((e) => events.push(e));
      expect(events).toEqual([{ type: "disconnected" }]);
      stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
