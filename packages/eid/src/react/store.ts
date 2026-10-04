/**
 * EidStore: bepaalt uit de gebeurtenissen van de bridge één toestand (`phase`), leest automatisch
 * bij het insteken (één keer per insteekbeurt), negeert resultaten die binnenkomen nadat de kaart
 * eruit ging, en wist de gegevens bij het uittrekken. Werkt zonder React (subscribe/getSnapshot).
 */
import { EidError, PROTOCOL_VERSION, type EidCardData, type ReaderInfo } from "../core";
import type { EidClientEvent, EidClientLike } from "./client";

export type EidPhase =
  /** Nog geen antwoord van de bridge. */
  | "connecting"
  /** Bridge niet bereikbaar (draait niet, of deze website is niet toegelaten). */
  | "no-bridge"
  /** Bridge spreekt een ander protocol: bijwerken nodig. */
  | "bridge-outdated"
  | "no-reader"
  | "no-card"
  /** Kaart zit erin maar is (nog) niet gelezen (autoRead uit). */
  | "ready"
  | "reading"
  | "done"
  | "error";

export interface EidState {
  phase: EidPhase;
  readers: ReaderInfo[];
  /** Lezer waarvan de kaart gebruikt wordt (of null). */
  reader: string | null;
  card: EidCardData | null;
  error: EidError | null;
  bridge: { version: string; protocol: number } | null;
}

export interface EidStoreOptions {
  client: EidClientLike;
  /** Automatisch lezen bij het insteken. Standaard `true`. */
  autoRead?: boolean;
  /** Foto lezen. Standaard `true`. */
  photo?: boolean;
  /** Alleen deze lezer gebruiken. Standaard: de eerste met een kaart. */
  reader?: string;
}

export const INITIAL_STATE: EidState = Object.freeze({
  phase: "connecting",
  readers: [],
  reader: null,
  card: null,
  error: null,
  bridge: null,
}) as EidState;

export class EidStore {
  readonly #client: EidClientLike;
  readonly #autoRead: boolean;
  readonly #photo: boolean;
  readonly #fixedReader: string | undefined;
  readonly #listeners = new Set<() => void>();
  #state: EidState = INITIAL_STATE;
  #unsubscribe: (() => void) | undefined;
  /** Insteekbeurt per lezer; een leesresultaat telt alleen als de beurt nog dezelfde is. */
  readonly #insertions = new Map<string, number>();
  /** Insteekbeurten die al (automatisch) gelezen werden. */
  readonly #readInsertions = new Map<string, number>();
  #reading: AbortController | undefined;

  /** De client (bv. voor aanmelden met useEidLogin). */
  get client(): EidClientLike {
    return this.#client;
  }

  constructor(options: EidStoreOptions) {
    this.#client = options.client;
    this.#autoRead = options.autoRead ?? true;
    this.#photo = options.photo ?? true;
    this.#fixedReader = options.reader;
  }

  // --- extern store (useSyncExternalStore) ---

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): EidState => this.#state;

  getServerSnapshot = (): EidState => INITIAL_STATE;

  #set(patch: Partial<EidState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of [...this.#listeners]) listener();
  }

  // --- levensloop ---

  start(): void {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.#client.subscribe((event) => this.#handle(event));
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#reading?.abort();
    this.#reading = undefined;
  }

  // --- gebeurtenissen ---

  #handle(event: EidClientEvent): void {
    switch (event.type) {
      case "status": {
        const { status } = event;
        const bridge = { version: status.version, protocol: status.protocol };
        if (status.protocol !== PROTOCOL_VERSION) {
          this.#set({
            phase: "bridge-outdated",
            bridge,
            readers: status.readers,
            card: null,
            error: new EidError("bridge-outdated", `De eID-lezer (versie ${status.version}) moet bijgewerkt worden`),
          });
          return;
        }
        // Bij (her)verbinden: elke lezer met kaart geldt als nieuwe insteekbeurt.
        for (const r of status.readers) if (r.cardPresent && !this.#insertions.has(r.name)) this.#insertions.set(r.name, 1);
        this.#set({ bridge, readers: status.readers, error: null });
        this.#settle();
        return;
      }
      case "disconnected":
        this.#reading?.abort();
        this.#insertions.clear();
        this.#readInsertions.clear();
        this.#set({ phase: "no-bridge", readers: [], reader: null, card: null, error: null });
        return;
      case "reader-added":
        if (!this.#state.readers.some((r) => r.name === event.reader)) {
          this.#set({ readers: [...this.#state.readers, { name: event.reader, cardPresent: false }] });
        }
        this.#settle();
        return;
      case "reader-removed":
        this.#cardGone(event.reader);
        this.#set({ readers: this.#state.readers.filter((r) => r.name !== event.reader) });
        this.#settle();
        return;
      case "card-inserted":
        this.#insertions.set(event.reader, (this.#insertions.get(event.reader) ?? 0) + 1);
        this.#set({ readers: this.#updateReader(event.reader, { cardPresent: true, atr: event.atr }) });
        this.#settle();
        return;
      case "card-removed":
        this.#cardGone(event.reader);
        this.#set({ readers: this.#updateReader(event.reader, { cardPresent: false }) });
        this.#settle();
        return;
    }
  }

  #updateReader(name: string, patch: Partial<ReaderInfo>): ReaderInfo[] {
    return this.#state.readers.map((r) => {
      if (r.name !== name) return r;
      const next: ReaderInfo = { ...r, ...patch };
      if (!next.cardPresent) delete next.atr;
      return next;
    });
  }

  /** Kaart weg: lopende lezing afbreken en gegevens wissen als ze van deze lezer kwamen. */
  #cardGone(reader: string): void {
    this.#insertions.set(reader, (this.#insertions.get(reader) ?? 0) + 1);
    this.#readInsertions.delete(reader);
    if (this.#state.reader === reader) {
      this.#reading?.abort();
      this.#set({ reader: null, card: null, error: null });
    }
  }

  #candidate(): ReaderInfo | undefined {
    const readers = this.#state.readers;
    if (this.#fixedReader !== undefined) return readers.find((r) => r.name === this.#fixedReader && r.cardPresent);
    return readers.find((r) => r.cardPresent);
  }

  /** Bepaalt de fase na een gebeurtenis en start eventueel een automatische lezing. */
  #settle(): void {
    if (this.#state.phase === "bridge-outdated" || this.#state.phase === "reading") return;
    const { readers, card, error } = this.#state;
    if (card || error) return; // "done" of "error" blijft tot de kaart eruit gaat

    if (readers.length === 0) return this.#set({ phase: "no-reader", reader: null });
    const candidate = this.#candidate();
    if (!candidate) return this.#set({ phase: "no-card", reader: null });

    const insertion = this.#insertions.get(candidate.name) ?? 0;
    if (this.#autoRead && this.#readInsertions.get(candidate.name) !== insertion) {
      void this.read();
      return;
    }
    this.#set({ phase: "ready", reader: candidate.name });
  }

  // --- acties ---

  /** Leest de kaart (opnieuw). Geeft de gegevens, of null als het mislukte of niet meer relevant is. */
  async read(): Promise<EidCardData | null> {
    const candidate = this.#candidate();
    if (!candidate) {
      this.#settle();
      return null;
    }
    const reader = candidate.name;
    const insertion = this.#insertions.get(reader) ?? 0;
    this.#readInsertions.set(reader, insertion);

    this.#reading?.abort();
    const controller = new AbortController();
    this.#reading = controller;
    this.#set({ phase: "reading", reader, card: null, error: null });

    const stillValid = () => !controller.signal.aborted && this.#insertions.get(reader) === insertion;
    try {
      const result = await this.#client.readCard({ reader, photo: this.#photo, signal: controller.signal });
      if (!stillValid()) return null;
      this.#set({ phase: "done", card: result.card, error: null });
      return result.card;
    } catch (error) {
      if (!stillValid()) return null;
      const eid = EidError.is(error) ? error : new EidError("internal", String(error));
      if (eid.code === "card-removed" || eid.code === "no-card") {
        this.#set({ phase: "no-card", reader: null, card: null, error: null });
        return null;
      }
      this.#set({ phase: "error", error: eid });
      return null;
    } finally {
      if (this.#reading === controller) this.#reading = undefined;
      if (this.#state.phase === "reading" && !stillValid()) {
        this.#set({ phase: "no-card" });
        this.#settle();
      }
    }
  }

  /** Wist de gelezen gegevens (bv. na verwerking), zonder opnieuw te lezen tot een nieuwe insteekbeurt. */
  clear(): void {
    this.#reading?.abort();
    const candidate = this.#candidate();
    if (candidate) this.#readInsertions.set(candidate.name, this.#insertions.get(candidate.name) ?? 0);
    // Fase even neutraal zetten zodat #settle opnieuw beslist ("ready" of "no-card").
    this.#set({ card: null, error: null, phase: "no-card", reader: null });
    this.#settle();
  }
}
