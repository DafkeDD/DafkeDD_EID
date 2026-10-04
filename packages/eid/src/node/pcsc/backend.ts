/**
 * Abstractie boven PC/SC. De native backend (koffi) en de mock-backend implementeren dit,
 * zodat monitor en reader zonder hardware te testen zijn.
 */
import type { CardTransport } from "../../core";

export interface ReaderStateQuery {
  reader: string;
  /** Laatst gekende dwEventState (zonder CHANGED-bit), of 0 (UNAWARE) de eerste keer. */
  currentState: number;
}

export interface ReaderStateResult {
  reader: string;
  /** dwEventState zoals PC/SC hem teruggeeft (bits uit SCARD_STATE; op Windows staat er een teller in de hoge 16 bits). */
  eventState: number;
  atr: Uint8Array;
}

export interface PcscCard extends CardTransport {
  readonly reader: string;
  /** Actief protocol (SCARD_PROTOCOL_T0 of _T1). */
  readonly protocol: number;
  beginTransaction(): Promise<void>;
  endTransaction(reset?: boolean): Promise<void>;
  disconnect(reset?: boolean): Promise<void>;
}

export interface PcscBackend {
  /** Namen van aangesloten lezers; leeg als er geen zijn. */
  listReaders(): Promise<string[]>;
  /**
   * Wacht tot de toestand van een lezer verschilt van `currentState`, of tot de time-out.
   * Geeft alle toestanden terug, of `null` bij time-out.
   * Gooit PcscError(E_CANCELLED) na {@link cancel}.
   */
  getStatusChange(states: readonly ReaderStateQuery[], timeoutMs: number): Promise<ReaderStateResult[] | null>;
  /** Verbindt gedeeld (SCARD_SHARE_SHARED) met T0 of T1. */
  connect(reader: string): Promise<PcscCard>;
  /** Maakt een lopende getStatusChange wakker. */
  cancel(): void;
  close(): Promise<void>;
}
