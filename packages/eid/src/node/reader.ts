/**
 * Hoog niveau: lezers volgen en een eID uitlezen. Eén operatie per lezer tegelijk, in een
 * PC/SC-transactie, en automatisch afgebroken als de kaart eruit gaat.
 */
import { authenticate, EidError, readEid, type AuthenticateOptions, type CardRunner, type EidAuthToken, type EidCardData, type EidReadOptions } from "../core";
import { ReaderMonitor, type ReaderEvent, type ReaderInfo } from "./monitor";
import type { PcscBackend, PcscCard } from "./pcsc/backend";
import { createNativeBackend } from "./pcsc/native";
import { toEidError } from "./pcsc/errors";

export interface EidReaderOptions {
  /** Standaard de native PC/SC-backend van het platform. */
  backend?: PcscBackend;
  /** Time-out per monitorronde. Standaard 1000 ms. */
  pollTimeoutMs?: number;
  /** Onverwachte fouten van de monitor (die blijft draaien). */
  onError?: (error: unknown) => void;
}

export type EidReaderListener = (event: ReaderEvent) => void;

export class EidReader {
  readonly #backend: PcscBackend;
  readonly #monitor: ReaderMonitor;
  readonly #listeners = new Set<EidReaderListener>();
  readonly #queues = new Map<string, Promise<unknown>>();
  readonly #removalAborts = new Map<string, Set<AbortController>>();
  #closed = false;

  constructor(backend: PcscBackend, options: Omit<EidReaderOptions, "backend"> = {}) {
    this.#backend = backend;
    this.#monitor = new ReaderMonitor(backend, {
      ...(options.pollTimeoutMs !== undefined ? { pollTimeoutMs: options.pollTimeoutMs } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
      onEvent: (event) => this.#handle(event),
    });
    this.#monitor.start();
  }

  /** Klaar na de eerste ronde van de monitor. */
  ready(): Promise<void> {
    return this.#monitor.ready();
  }

  readers(): ReaderInfo[] {
    return this.#monitor.readers();
  }

  /** Luistert naar lezer- en kaartgebeurtenissen. Geeft een functie terug om te stoppen. */
  on(listener: EidReaderListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #handle(event: ReaderEvent): void {
    if (event.type === "card-removed" || event.type === "reader-removed") {
      for (const controller of this.#removalAborts.get(event.reader) ?? []) controller.abort(new EidError("card-removed"));
    }
    for (const listener of this.#listeners) listener(event);
  }

  /**
   * Kiest de lezer: de gevraagde, of de eerste met een kaart.
   * @throws EidError `no-reader` of `no-card`
   */
  resolveReader(name?: string): string {
    const readers = this.readers();
    if (readers.length === 0) throw new EidError("no-reader", "Geen kaartlezer gevonden");
    if (name !== undefined) {
      const reader = readers.find((r) => r.name === name);
      if (!reader) throw new EidError("no-reader", `Kaartlezer niet gevonden: ${name}`);
      if (!reader.cardPresent) throw new EidError("no-card", "Geen kaart in de lezer");
      return reader.name;
    }
    const withCard = readers.find((r) => r.cardPresent);
    if (!withCard) throw new EidError("no-card", "Geen kaart in de lezer");
    return withCard.name;
  }

  /**
   * Voert `operation` exclusief uit op de kaart in `reader` (of de eerste lezer met een kaart),
   * binnen een PC/SC-transactie. Het signaal wordt afgebroken als de kaart eruit gaat.
   */
  async withCard<T>(reader: string | undefined, operation: (card: PcscCard, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.#closed) throw new EidError("internal", "EidReader is gesloten");
    const name = this.resolveReader(reader);

    const previous = this.#queues.get(name) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.#exclusive(name, operation, signal));
    this.#queues.set(name, run);
    try {
      return await run;
    } finally {
      if (this.#queues.get(name) === run) this.#queues.delete(name);
    }
  }

  async #exclusive<T>(reader: string, operation: (card: PcscCard, signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort(outer?.reason);
    outer?.addEventListener("abort", onOuterAbort);
    if (outer?.aborted) controller.abort(outer.reason);

    const set = this.#removalAborts.get(reader) ?? new Set();
    set.add(controller);
    this.#removalAborts.set(reader, set);

    let card: PcscCard | undefined;
    let inTransaction = false;
    try {
      if (controller.signal.aborted) throw new EidError("aborted", "Afgebroken");
      card = await this.#backend.connect(reader);
      await card.beginTransaction();
      inTransaction = true;
      return await operation(card, controller.signal);
    } catch (error) {
      // Kaart eruit tijdens de operatie: die reden gaat voor.
      if (controller.signal.aborted && EidError.is(controller.signal.reason, "card-removed")) throw controller.signal.reason;
      throw toEidError(error);
    } finally {
      outer?.removeEventListener("abort", onOuterAbort);
      set.delete(controller);
      if (card) {
        if (inTransaction) await card.endTransaction().catch(() => {});
        await card.disconnect().catch(() => {});
      }
    }
  }

  /** Leest de eID in `reader` (of de eerste lezer met een kaart). Geen PIN nodig. */
  read(reader?: string, options: EidReadOptions = {}): Promise<EidCardData> {
    return this.withCard(reader, (card, signal) => readEid(card, { ...options, signal }), options.signal);
  }

  /**
   * Aanmelden met PIN op de kaart in `reader` (of de eerste lezer met een kaart). Elke kaartstap is
   * een aparte transactie; de PIN wordt tussen de stappen gevraagd (zie core/auth.ts).
   */
  authenticate(reader: string | undefined, options: AuthenticateOptions): Promise<EidAuthToken> {
    const name = this.resolveReader(reader);
    const run: CardRunner = (step) => this.withCard(name, (card) => step(card), options.signal);
    return authenticate(run, options);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#monitor.stop();
    await this.#backend.close();
    this.#listeners.clear();
  }
}

/** Start een EidReader met de native PC/SC-backend (of de opgegeven backend) en wacht op de eerste ronde. */
export async function createEidReader(options: EidReaderOptions = {}): Promise<EidReader> {
  const { backend, ...rest } = options;
  const reader = new EidReader(backend ?? (await createNativeBackend()), rest);
  await reader.ready();
  return reader;
}
