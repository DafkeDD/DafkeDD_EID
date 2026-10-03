/**
 * PC/SC nagebootst in het geheugen: lezers toevoegen/verwijderen, kaarten insteken/uittrekken.
 * Voor tests, de `--mock`-modus van de bridge en demo's.
 */
import type { CardTransport } from "../../core";
import type { PcscBackend, PcscCard, ReaderStateQuery, ReaderStateResult } from "./backend";
import { SCARD_ERROR, SCARD_PROTOCOL_T1, SCARD_STATE } from "./constants";
import { PcscError } from "./errors";

interface MockReader {
  card?: { transport: CardTransport; atr: Uint8Array; insertion: number };
  inTransaction: boolean;
}

/** ATR van een eID 1.8, alleen ter info (core herkent de kaart niet aan de ATR). */
export const MOCK_EID_ATR = Uint8Array.of(0x3b, 0x7f, 0x96, 0x00, 0x00, 0x80, 0x31, 0x80, 0x65, 0xb0, 0x85, 0x04, 0x01, 0x20, 0x12, 0x0f, 0xff, 0x82, 0x90, 0x00);

export class MockPcscBackend implements PcscBackend {
  readonly #readers = new Map<string, MockReader>();
  #waiters = new Set<() => void>();
  #cancelWaiters = new Set<() => void>();
  #insertions = 0;
  #closed = false;

  addReader(name: string): this {
    if (!this.#readers.has(name)) this.#readers.set(name, { inTransaction: false });
    this.#notify();
    return this;
  }

  removeReader(name: string): this {
    this.#readers.delete(name);
    this.#notify();
    return this;
  }

  insertCard(reader: string, transport: CardTransport, atr: Uint8Array = MOCK_EID_ATR): this {
    const state = this.#readers.get(reader);
    if (!state) throw new Error(`Onbekende lezer: ${reader}`);
    state.card = { transport, atr, insertion: ++this.#insertions };
    this.#notify();
    return this;
  }

  removeCard(reader: string): this {
    const state = this.#readers.get(reader);
    if (state) state.card = undefined;
    this.#notify();
    return this;
  }

  async listReaders(): Promise<string[]> {
    this.#assertOpen();
    return [...this.#readers.keys()];
  }

  #stateOf(reader: string): ReaderStateResult {
    const state = this.#readers.get(reader);
    if (!state) return { reader, eventState: SCARD_STATE.UNKNOWN | SCARD_STATE.UNAVAILABLE, atr: new Uint8Array() };
    if (!state.card) return { reader, eventState: SCARD_STATE.EMPTY, atr: new Uint8Array() };
    // Teller in de hoge 16 bits, zoals Windows: een nieuwe kaart is een nieuwe toestand.
    const flags = SCARD_STATE.PRESENT | (state.inTransaction ? SCARD_STATE.INUSE : 0);
    return { reader, eventState: ((state.card.insertion & 0xffff) << 16) | flags, atr: state.card.atr };
  }

  async getStatusChange(states: readonly ReaderStateQuery[], timeoutMs: number): Promise<ReaderStateResult[] | null> {
    this.#assertOpen();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const results = states.map((s) => this.#stateOf(s.reader));
      const changed = results.some((r, i) => (r.eventState & ~SCARD_STATE.INUSE) !== (states[i]!.currentState & ~(SCARD_STATE.CHANGED | SCARD_STATE.INUSE)));
      if (changed) {
        return results.map((r, i) =>
          (r.eventState & ~SCARD_STATE.INUSE) !== (states[i]!.currentState & ~(SCARD_STATE.CHANGED | SCARD_STATE.INUSE))
            ? { ...r, eventState: r.eventState | SCARD_STATE.CHANGED }
            : r,
        );
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const cancelled = await this.#wait(remaining);
      if (cancelled) throw new PcscError("SCardGetStatusChange", SCARD_ERROR.E_CANCELLED);
    }
  }

  /** Wacht op een wijziging; true = geannuleerd. */
  #wait(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (cancelled: boolean) => {
        clearTimeout(timer);
        this.#waiters.delete(onChange);
        this.#cancelWaiters.delete(onCancel);
        resolve(cancelled);
      };
      const onChange = () => done(false);
      const onCancel = () => done(true);
      const timer = setTimeout(() => done(false), ms);
      this.#waiters.add(onChange);
      this.#cancelWaiters.add(onCancel);
    });
  }

  #notify(): void {
    for (const waiter of [...this.#waiters]) waiter();
  }

  async connect(reader: string): Promise<PcscCard> {
    this.#assertOpen();
    const state = this.#readers.get(reader);
    if (!state) throw new PcscError("SCardConnect", SCARD_ERROR.E_UNKNOWN_READER);
    const card = state.card;
    if (!card) throw new PcscError("SCardConnect", SCARD_ERROR.E_NO_SMARTCARD);

    const insertion = card.insertion;
    const present = () => state.card?.insertion === insertion && this.#readers.get(reader) === state;
    const ensurePresent = (fn: string) => {
      if (!present()) throw new PcscError(fn, SCARD_ERROR.W_REMOVED_CARD);
    };
    let ownsTransaction = false;

    return {
      reader,
      protocol: SCARD_PROTOCOL_T1,
      transmit: async (command) => {
        ensurePresent("SCardTransmit");
        return card.transport.transmit(command);
      },
      beginTransaction: async () => {
        ensurePresent("SCardBeginTransaction");
        if (state.inTransaction) throw new PcscError("SCardBeginTransaction", SCARD_ERROR.E_SHARING_VIOLATION);
        state.inTransaction = true;
        ownsTransaction = true;
      },
      endTransaction: async () => {
        if (ownsTransaction) state.inTransaction = false;
        ownsTransaction = false;
      },
      disconnect: async () => {
        if (ownsTransaction) state.inTransaction = false;
        ownsTransaction = false;
      },
    };
  }

  cancel(): void {
    for (const waiter of [...this.#cancelWaiters]) waiter();
  }

  async close(): Promise<void> {
    this.cancel();
    this.#closed = true;
  }

  #assertOpen(): void {
    if (this.#closed) throw new PcscError("SCardEstablishContext", SCARD_ERROR.E_INVALID_HANDLE);
  }
}
