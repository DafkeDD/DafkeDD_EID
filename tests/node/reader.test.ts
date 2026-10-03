import { afterEach, describe, expect, it } from "vitest";
import { EidError, type CardTransport } from "../../packages/eid/src/core";
import { createSampleCard } from "../../packages/eid/src/mock";
import { createEidReader, MockPcscBackend, type EidReader, type ReaderEvent } from "../../packages/eid/src/node";

const POLL = 20;
let open: EidReader[] = [];

async function setup(backend = new MockPcscBackend()) {
  const events: ReaderEvent[] = [];
  const reader = await createEidReader({ backend, pollTimeoutMs: POLL });
  reader.on((event) => events.push(event));
  open.push(reader);
  return { backend, reader, events };
}

const until = async (check: () => boolean, ms = 1000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("time-out in test");
    await new Promise((r) => setTimeout(r, 5));
  }
};

afterEach(async () => {
  await Promise.all(open.map((r) => r.close()));
  open = [];
});

describe("EidReader / monitor", () => {
  it("kent na ready() de lezers en kaarten die er al waren", async () => {
    const backend = new MockPcscBackend().addReader("A").addReader("B");
    backend.insertCard("A", await createSampleCard());
    const { reader } = await setup(backend);
    expect(reader.readers()).toEqual([
      { name: "A", cardPresent: true, atr: expect.stringMatching(/^3b7f/) },
      { name: "B", cardPresent: false },
    ]);
  });

  it("meldt lezers en kaarten die erbij komen en weggaan", async () => {
    const { backend, events } = await setup();
    backend.addReader("A");
    await until(() => events.some((e) => e.type === "reader-added"));
    backend.insertCard("A", await createSampleCard());
    await until(() => events.some((e) => e.type === "card-inserted"));
    backend.removeCard("A");
    await until(() => events.some((e) => e.type === "card-removed"));
    backend.insertCard("A", await createSampleCard());
    await until(() => events.filter((e) => e.type === "card-inserted").length === 2);
    backend.removeReader("A");
    await until(() => events.some((e) => e.type === "reader-removed"));
    expect(events.map((e) => e.type)).toEqual([
      "reader-added",
      "card-inserted",
      "card-removed",
      "card-inserted",
      "card-removed",
      "reader-removed",
    ]);
  });

  it("merkt een snelle kaartwissel op (zelfde lezer, nieuwe kaart)", async () => {
    const backend = new MockPcscBackend().addReader("A");
    backend.insertCard("A", await createSampleCard());
    const { events } = await setup(backend);
    backend.insertCard("A", await createSampleCard()); // zonder tussenliggende "leeg"
    await until(() => events.length >= 2);
    expect(events.map((e) => e.type)).toEqual(["card-removed", "card-inserted"]);
  });

  it("leest de eID in de eerste lezer met een kaart", async () => {
    const backend = new MockPcscBackend().addReader("Leeg").addReader("Met kaart");
    backend.insertCard("Met kaart", await createSampleCard());
    const { reader } = await setup(backend);
    const data = await reader.read();
    expect(data.identity.lastName).toBe("Specimen");
  });

  it("geeft no-reader en no-card", async () => {
    const { reader } = await setup();
    await expect(reader.read()).rejects.toMatchObject({ code: "no-reader" });
    const withEmpty = await setup(new MockPcscBackend().addReader("A"));
    await expect(withEmpty.reader.read()).rejects.toMatchObject({ code: "no-card" });
    await expect(withEmpty.reader.read("Bestaat niet")).rejects.toMatchObject({ code: "no-reader" });
  });

  it("voert operaties op dezelfde lezer na elkaar uit (geen card-busy)", async () => {
    const backend = new MockPcscBackend().addReader("A");
    backend.insertCard("A", await createSampleCard());
    const { reader } = await setup(backend);
    const results = await Promise.all([reader.read(), reader.read(), reader.read()]);
    expect(results.map((r) => r.identity.lastName)).toEqual(["Specimen", "Specimen", "Specimen"]);
  });

  it("breekt een lopende operatie af met card-removed als de kaart eruit gaat", async () => {
    const backend = new MockPcscBackend().addReader("A");
    const sample = await createSampleCard();
    // Trage kaart: elke APDU duurt 15 ms, zodat we halverwege kunnen uittrekken.
    const slow: CardTransport = { transmit: async (c) => (await new Promise((r) => setTimeout(r, 15)), sample.transmit(c)) };
    backend.insertCard("A", slow);
    const { reader } = await setup(backend);
    const reading = reader.read();
    setTimeout(() => backend.removeCard("A"), 40);
    await expect(reading).rejects.toMatchObject({ code: "card-removed" });
  });

  it("zet PC/SC-fouten om naar EidError", async () => {
    const backend = new MockPcscBackend().addReader("A");
    backend.insertCard("A", await createSampleCard());
    const { reader } = await setup(backend);
    const error = await reader.withCard(undefined, async () => {
      throw new Error("boem");
    }).catch((e: unknown) => e);
    expect(EidError.is(error, "internal")).toBe(true);
  });

  it("geeft de transactie vrij, ook na een fout", async () => {
    const backend = new MockPcscBackend().addReader("A");
    backend.insertCard("A", await createSampleCard());
    const { reader } = await setup(backend);
    await reader.withCard(undefined, async () => Promise.reject(new Error("x"))).catch(() => {});
    await expect(reader.read()).resolves.toBeDefined();
  });

  it("respecteert een AbortSignal van de aanroeper", async () => {
    const backend = new MockPcscBackend().addReader("A");
    backend.insertCard("A", await createSampleCard());
    const { reader } = await setup(backend);
    const controller = new AbortController();
    controller.abort();
    await expect(reader.read(undefined, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
  });

  it("close() stopt de monitor snel", async () => {
    const backend = new MockPcscBackend().addReader("A");
    const reader = await createEidReader({ backend, pollTimeoutMs: 10_000 });
    const start = Date.now();
    await reader.close();
    expect(Date.now() - start).toBeLessThan(500);
    await expect(reader.read()).rejects.toMatchObject({ code: "internal" });
  });
});
