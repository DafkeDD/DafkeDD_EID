/**
 * Volgt lezers en kaarten: een lus met listReaders + getStatusChange (time-out standaard 1 s).
 * Geen Plug-and-Play-notificatie nodig: nieuwe lezers worden bij de volgende ronde opgemerkt.
 */
import { toHex, type ReaderInfo } from "../core";
import type { PcscBackend } from "./pcsc/backend";
import { SCARD_STATE } from "./pcsc/constants";
import { isPcscError } from "./pcsc/errors";

export type ReaderEvent =
  | { type: "reader-added"; reader: string }
  | { type: "reader-removed"; reader: string }
  | { type: "card-inserted"; reader: string; atr: Uint8Array }
  | { type: "card-removed"; reader: string };

export type { ReaderInfo };

export interface ReaderMonitorOptions {
  /** Time-out per getStatusChange-ronde. Standaard 1000 ms. */
  pollTimeoutMs?: number;
  onEvent?: (event: ReaderEvent) => void;
  /** Onverwachte fouten; de monitor blijft draaien en probeert opnieuw. */
  onError?: (error: unknown) => void;
}

interface Tracked {
  state: number;
  atr: Uint8Array;
}

const present = (state: number) => (state & SCARD_STATE.PRESENT) !== 0;
const insertionCount = (state: number) => state >>> 16;

export class ReaderMonitor {
  readonly #backend: PcscBackend;
  readonly #timeout: number;
  readonly #onEvent: (event: ReaderEvent) => void;
  readonly #onError: (error: unknown) => void;
  readonly #readers = new Map<string, Tracked>();
  #running = false;
  #loop: Promise<void> | undefined;
  #sleepAbort: AbortController | undefined;
  #firstRound: Promise<void>;
  #resolveFirstRound!: () => void;

  constructor(backend: PcscBackend, options: ReaderMonitorOptions = {}) {
    this.#backend = backend;
    this.#timeout = options.pollTimeoutMs ?? 1000;
    this.#onEvent = options.onEvent ?? (() => {});
    this.#onError = options.onError ?? (() => {});
    this.#firstRound = new Promise((resolve) => (this.#resolveFirstRound = resolve));
  }

  /** Huidige lezers en of er een kaart in zit. */
  readers(): ReaderInfo[] {
    return [...this.#readers].map(([name, { state, atr }]) => ({
      name,
      cardPresent: present(state),
      ...(present(state) && atr.length > 0 ? { atr: toHex(atr) } : {}),
    }));
  }

  /** Klaar na de eerste ronde (lezers en kaarten zijn dan gekend). */
  ready(): Promise<void> {
    return this.#firstRound;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#loop = this.#run();
  }

  async stop(): Promise<void> {
    if (!this.#running) return;
    this.#running = false;
    this.#sleepAbort?.abort();
    this.#backend.cancel();
    await this.#loop;
  }

  #emit(event: ReaderEvent): void {
    try {
      this.#onEvent(event);
    } catch (error) {
      this.#onError(error);
    }
  }

  async #sleep(ms: number): Promise<void> {
    const controller = new AbortController();
    this.#sleepAbort = controller;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      controller.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async #run(): Promise<void> {
    while (this.#running) {
      try {
        await this.#round();
      } catch (error) {
        if (!this.#running) break;
        if (isPcscError(error, "E_CANCELLED")) continue;
        // Lezer net verdwenen tijdens het wachten: volgende ronde lijst opnieuw.
        if (isPcscError(error, "E_UNKNOWN_READER") || isPcscError(error, "E_READER_UNAVAILABLE")) continue;
        this.#onError(error);
        await this.#sleep(this.#timeout);
      } finally {
        this.#resolveFirstRound();
      }
    }
  }

  async #round(): Promise<void> {
    const names = await this.#backend.listReaders();
    if (!this.#running) return;

    for (const [name, tracked] of [...this.#readers]) {
      if (names.includes(name)) continue;
      this.#readers.delete(name);
      if (present(tracked.state)) this.#emit({ type: "card-removed", reader: name });
      this.#emit({ type: "reader-removed", reader: name });
    }
    for (const name of names) {
      if (this.#readers.has(name)) continue;
      this.#readers.set(name, { state: SCARD_STATE.UNAWARE, atr: new Uint8Array() });
      this.#emit({ type: "reader-added", reader: name });
    }

    if (names.length === 0) {
      this.#resolveFirstRound();
      await this.#sleep(this.#timeout);
      return;
    }

    // Eerste keer (UNAWARE) antwoordt PC/SC meteen met de huidige toestand.
    const firstTime = names.some((name) => this.#readers.get(name)!.state === SCARD_STATE.UNAWARE);
    const results = await this.#backend.getStatusChange(
      names.map((reader) => ({ reader, currentState: this.#readers.get(reader)!.state })),
      // Eerste keer kort wachten (niet 0: dan kan een platform E_TIMEOUT geven en zouden we in een lus draaien).
      firstTime ? Math.min(100, this.#timeout) : this.#timeout,
    );
    if (!results || !this.#running) return;

    for (const { reader, eventState, atr } of results) {
      const tracked = this.#readers.get(reader);
      if (!tracked) continue;
      const next = eventState & ~SCARD_STATE.CHANGED;
      if (next & (SCARD_STATE.UNKNOWN | SCARD_STATE.UNAVAILABLE)) continue; // verdwijnt bij de volgende listReaders

      const was = tracked.state;
      tracked.state = next;
      const swapped = present(was) && present(next) && was !== SCARD_STATE.UNAWARE && insertionCount(was) !== insertionCount(next);

      if (present(was) && (!present(next) || swapped)) {
        tracked.atr = new Uint8Array();
        this.#emit({ type: "card-removed", reader });
      }
      if (present(next) && (!present(was) || swapped)) {
        tracked.atr = atr;
        this.#emit({ type: "card-inserted", reader, atr });
      }
    }
  }
}
