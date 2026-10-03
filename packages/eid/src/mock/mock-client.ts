/**
 * MockEidClient: doet alsof er een bridge met kaartlezer is, volledig in de browser.
 * Voor demo's, Storybook-achtige pagina's en tests zonder `dafke-eid`.
 */
import { EidError, PROTOCOL_VERSION, readEid, type BridgeStatus, type CardTransport, type ReaderInfo } from "../core";
import type { EidClientEvent, EidClientLike, ReadCardOptions, ReadCardResult } from "../react/client";
import { VERSION } from "../version";
import { createSampleCard } from "./sample-card";

export interface MockEidClientOptions {
  /** Naam van de virtuele lezer. */
  readerName?: string;
  /** Start met een kaart in de lezer. Standaard `true`. */
  cardInserted?: boolean;
  /** Start met een bereikbare bridge. Standaard `true`. */
  bridgeAvailable?: boolean;
  /** Kunstmatige leestijd in ms (zoals een echte lezer). Standaard 600. */
  readDelayMs?: number;
}

const DEFAULT_ATR = "3b7f96000080318065b085040120120fff829000";

export class MockEidClient implements EidClientLike {
  readonly readerName: string;
  readonly #listeners = new Set<(event: EidClientEvent) => void>();
  readonly #readDelayMs: number;
  #available: boolean;
  #card: CardTransport | undefined;
  #cardPromise: Promise<CardTransport> | undefined;

  constructor(options: MockEidClientOptions = {}) {
    this.readerName = options.readerName ?? "DafkeDD Virtuele Lezer";
    this.#available = options.bridgeAvailable ?? true;
    this.#readDelayMs = options.readDelayMs ?? 600;
    if (options.cardInserted ?? true) this.#cardPromise = createSampleCard().then((card) => (this.#card = card));
  }

  #readers(): ReaderInfo[] {
    const present = this.#card !== undefined || this.#cardPromise !== undefined;
    return [{ name: this.readerName, cardPresent: present, ...(present ? { atr: DEFAULT_ATR } : {}) }];
  }

  #status(): BridgeStatus {
    return { name: "dafke-eid", version: VERSION, protocol: PROTOCOL_VERSION, readers: this.#readers() };
  }

  #emit(event: EidClientEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }

  async status(): Promise<BridgeStatus> {
    if (!this.#available) throw new EidError("no-bridge", "De eID-lezer (dafke-eid) is niet bereikbaar");
    return this.#status();
  }

  async readCard(options: ReadCardOptions = {}): Promise<ReadCardResult> {
    if (!this.#available) throw new EidError("no-bridge", "De eID-lezer (dafke-eid) is niet bereikbaar");
    if (options.reader !== undefined && options.reader !== this.readerName) throw new EidError("no-reader", "Onbekende lezer");
    const card = this.#card ?? (await this.#cardPromise);
    if (!card) throw new EidError("no-card", "Geen kaart in de lezer");
    await new Promise((resolve) => setTimeout(resolve, this.#readDelayMs));
    if (options.signal?.aborted) throw new EidError("aborted", "Afgebroken");
    if (this.#card !== card) throw new EidError("card-removed", "De kaart is verwijderd");
    const data = await readEid(card, { photo: options.photo ?? true });
    return { reader: this.readerName, card: data };
  }

  subscribe(listener: (event: EidClientEvent) => void): () => void {
    this.#listeners.add(listener);
    queueMicrotask(() => {
      if (!this.#listeners.has(listener)) return;
      listener(this.#available ? { type: "status", status: this.#status() } : { type: "disconnected" });
    });
    return () => this.#listeners.delete(listener);
  }

  // --- bediening voor demo's en tests ---

  /** Steekt een kaart in (standaard de voorbeeldkaart). */
  async insertCard(card?: CardTransport): Promise<void> {
    const next = card ?? (await createSampleCard());
    this.#card = next;
    this.#cardPromise = undefined;
    if (this.#available) this.#emit({ type: "card-inserted", reader: this.readerName, atr: DEFAULT_ATR });
  }

  removeCard(): void {
    this.#card = undefined;
    this.#cardPromise = undefined;
    if (this.#available) this.#emit({ type: "card-removed", reader: this.readerName });
  }

  /** Bridge aan/uit, om "dafke-eid draait niet" te tonen. */
  setBridgeAvailable(available: boolean): void {
    if (this.#available === available) return;
    this.#available = available;
    this.#emit(available ? { type: "status", status: this.#status() } : { type: "disconnected" });
  }
}
