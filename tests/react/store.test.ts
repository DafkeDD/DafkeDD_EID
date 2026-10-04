import { describe, expect, it } from "vitest";
import { EidError, PROTOCOL_VERSION, type BridgeStatus } from "../../packages/eid/src/core";
import { MockEidClient } from "../../packages/eid/src/mock";
import { EidStore, type EidClientEvent, type EidClientLike, type EidPhase } from "../../packages/eid/src/react";

const until = async (check: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("time-out in test");
    await new Promise((r) => setTimeout(r, 5));
  }
};

function track(store: EidStore): EidPhase[] {
  const phases: EidPhase[] = [store.getSnapshot().phase];
  store.subscribe(() => {
    const phase = store.getSnapshot().phase;
    if (phases[phases.length - 1] !== phase) phases.push(phase);
  });
  return phases;
}

/** Client waarvan we de gebeurtenissen en leesresultaten zelf sturen. */
function scriptedClient() {
  let emit: (event: EidClientEvent) => void = () => {};
  const reads: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void; reader?: string }> = [];
  const client: EidClientLike = {
    status: async () => ({ name: "dafke-eid", version: "x", protocol: PROTOCOL_VERSION, readers: [] }),
    readCard: (options) =>
      new Promise((resolve, reject) => reads.push({ resolve: resolve as never, reject, ...(options?.reader ? { reader: options.reader } : {}) })),
    subscribe: (listener) => {
      emit = listener;
      return () => (emit = () => {});
    },
  };
  const status = (readers: BridgeStatus["readers"], protocol = PROTOCOL_VERSION): EidClientEvent => ({
    type: "status",
    status: { name: "dafke-eid", version: "1.2.3", protocol, readers },
  });
  return { client, emit: (e: EidClientEvent) => emit(e), reads, status };
}

describe("EidStore met MockEidClient", () => {
  it("leest automatisch bij verbinden met een kaart in de lezer", async () => {
    const client = new MockEidClient({ readDelayMs: 5 });
    const store = new EidStore({ client });
    const phases = track(store);
    store.start();
    await until(() => store.getSnapshot().phase === "done");
    expect(phases).toEqual(["connecting", "reading", "done"]);
    expect(store.getSnapshot().card?.identity.lastName).toBe("Specimen");
    expect(store.getSnapshot().reader).toBe(client.readerName);
    expect(store.getSnapshot().bridge?.protocol).toBe(PROTOCOL_VERSION);
    store.stop();
  });

  it("wist de gegevens bij uittrekken en leest opnieuw bij insteken", async () => {
    const client = new MockEidClient({ readDelayMs: 5 });
    const store = new EidStore({ client });
    store.start();
    await until(() => store.getSnapshot().phase === "done");
    client.removeCard();
    expect(store.getSnapshot()).toMatchObject({ phase: "no-card", card: null, reader: null });
    await client.insertCard();
    await until(() => store.getSnapshot().phase === "done");
    store.stop();
  });

  it("toont no-bridge als de bridge niet bereikbaar is, en herstelt", async () => {
    const client = new MockEidClient({ readDelayMs: 5, bridgeAvailable: false });
    const store = new EidStore({ client });
    store.start();
    await until(() => store.getSnapshot().phase === "no-bridge");
    client.setBridgeAvailable(true);
    await until(() => store.getSnapshot().phase === "done");
    store.stop();
  });

  it("met autoRead: false blijft de fase ready tot read()", async () => {
    const client = new MockEidClient({ readDelayMs: 5 });
    const store = new EidStore({ client, autoRead: false });
    store.start();
    await until(() => store.getSnapshot().phase === "ready");
    await store.read();
    expect(store.getSnapshot().phase).toBe("done");
    store.stop();
  });

  it("clear() wist de gegevens zonder opnieuw te lezen", async () => {
    const client = new MockEidClient({ readDelayMs: 5 });
    const store = new EidStore({ client });
    store.start();
    await until(() => store.getSnapshot().phase === "done");
    store.clear();
    await new Promise((r) => setTimeout(r, 30));
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", card: null });
    store.stop();
  });
});

describe("EidStore: randgevallen", () => {
  it("no-reader en no-card", () => {
    const s = scriptedClient();
    const store = new EidStore({ client: s.client });
    store.start();
    s.emit(s.status([]));
    expect(store.getSnapshot().phase).toBe("no-reader");
    s.emit({ type: "reader-added", reader: "A" });
    expect(store.getSnapshot()).toMatchObject({ phase: "no-card", readers: [{ name: "A", cardPresent: false }] });
    s.emit({ type: "reader-removed", reader: "A" });
    expect(store.getSnapshot().phase).toBe("no-reader");
  });

  it("negeert een leesresultaat dat binnenkomt nadat de kaart eruit ging", async () => {
    const s = scriptedClient();
    const store = new EidStore({ client: s.client });
    store.start();
    s.emit(s.status([{ name: "A", cardPresent: true }]));
    expect(store.getSnapshot().phase).toBe("reading");
    s.emit({ type: "card-removed", reader: "A" });
    s.reads[0]!.resolve({ reader: "A", card: { identity: { lastName: "Te laat" } } });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getSnapshot()).toMatchObject({ phase: "no-card", card: null });
  });

  it("leest maar één keer per insteekbeurt, ook bij een fout", async () => {
    const s = scriptedClient();
    const store = new EidStore({ client: s.client });
    store.start();
    s.emit(s.status([{ name: "A", cardPresent: true }]));
    s.reads[0]!.reject(new EidError("read-failed", "Leesfout"));
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getSnapshot()).toMatchObject({ phase: "error", error: { code: "read-failed" } });
    s.emit({ type: "reader-added", reader: "B" }); // andere gebeurtenis: geen nieuwe poging
    expect(s.reads).toHaveLength(1);
    s.emit({ type: "card-removed", reader: "A" });
    s.emit({ type: "card-inserted", reader: "A", atr: "3b" });
    expect(s.reads).toHaveLength(2);
  });

  it("gebruikt alleen de gevraagde lezer", () => {
    const s = scriptedClient();
    const store = new EidStore({ client: s.client, reader: "B" });
    store.start();
    s.emit(s.status([{ name: "A", cardPresent: true }, { name: "B", cardPresent: false }]));
    expect(store.getSnapshot().phase).toBe("no-card");
    s.emit({ type: "card-inserted", reader: "B", atr: "3b" });
    expect(s.reads[0]!.reader).toBe("B");
  });

  it("meldt bridge-outdated bij een ander protocol", () => {
    const s = scriptedClient();
    const store = new EidStore({ client: s.client });
    store.start();
    s.emit(s.status([{ name: "A", cardPresent: true }], PROTOCOL_VERSION + 1));
    expect(store.getSnapshot()).toMatchObject({ phase: "bridge-outdated", error: { code: "bridge-outdated" } });
    expect(s.reads).toHaveLength(0);
  });

  it("disconnected wist alles", async () => {
    const s = scriptedClient();
    const store = new EidStore({ client: s.client });
    store.start();
    s.emit(s.status([{ name: "A", cardPresent: true }]));
    s.reads[0]!.resolve({ reader: "A", card: { identity: {} } });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getSnapshot().phase).toBe("done");
    s.emit({ type: "disconnected" });
    expect(store.getSnapshot()).toMatchObject({ phase: "no-bridge", card: null, readers: [] });
  });

  it("stop() en opnieuw start() werkt (React StrictMode)", () => {
    const s = scriptedClient();
    const store = new EidStore({ client: s.client });
    store.start();
    store.stop();
    store.start();
    s.emit(s.status([]));
    expect(store.getSnapshot().phase).toBe("no-reader");
  });
});
