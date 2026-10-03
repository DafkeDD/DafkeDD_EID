/**
 * Praat met de bridge op de pc van de gebruiker: fetch voor opvragingen, EventSource voor live
 * gebeurtenissen. Geen React nodig; de store en de hooks bouwen hierop.
 */
import {
  decodeCardData,
  DEFAULT_BRIDGE_URL,
  EidError,
  errorFromBody,
  TOKEN_HEADER,
  type BridgeEvent,
  type BridgeStatus,
  type CardResponse,
  type EidCardData,
} from "../core";

export type EidClientEvent =
  | BridgeEvent
  /** Verbonden (of opnieuw verbonden) met de bridge: volledige toestand. */
  | { type: "status"; status: BridgeStatus }
  /** Verbinding met de bridge verloren of niet mogelijk. */
  | { type: "disconnected" };

export interface ReadCardOptions {
  /** Standaard de eerste lezer met een kaart. */
  reader?: string;
  /** Foto meesturen. Standaard `true`. */
  photo?: boolean;
  signal?: AbortSignal;
}

export interface ReadCardResult {
  reader: string;
  card: EidCardData;
}

/** Wat de store nodig heeft. `EidClient` (echte bridge) en `MockEidClient` implementeren dit. */
export interface EidClientLike {
  status(signal?: AbortSignal): Promise<BridgeStatus>;
  readCard(options?: ReadCardOptions): Promise<ReadCardResult>;
  /** Live gebeurtenissen. De eerste is `status` (of `disconnected`). Geeft een functie om te stoppen. */
  subscribe(listener: (event: EidClientEvent) => void): () => void;
}

export interface EidClientOptions {
  /** Adres van de bridge. Standaard http://127.0.0.1:47820. */
  url?: string;
  /** Token, als de bridge met `--token` draait. */
  token?: string;
  /** Wachttijd voor een nieuwe poging als de verbinding definitief verbroken is. Standaard 3000 ms. */
  reconnectMs?: number;
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
}

const EVENT_TYPES = ["reader-added", "reader-removed", "card-inserted", "card-removed"] as const;

export class EidClient implements EidClientLike {
  readonly url: string;
  readonly #token: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #EventSource: typeof EventSource | undefined;
  readonly #reconnectMs: number;
  readonly #listeners = new Set<(event: EidClientEvent) => void>();
  #source: EventSource | undefined;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #disconnectReported = false;

  constructor(options: EidClientOptions = {}) {
    this.url = (options.url ?? DEFAULT_BRIDGE_URL).replace(/\/+$/, "");
    this.#token = options.token;
    this.#fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.#EventSource = options.EventSource ?? globalThis.EventSource;
    this.#reconnectMs = options.reconnectMs ?? 3000;
  }

  async #get<T>(path: string, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.url}${path}`, {
        method: "GET",
        headers: this.#token ? { [TOKEN_HEADER]: this.#token } : {},
        cache: "no-store",
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw new EidError("aborted", "Afgebroken", { cause: error });
      // Netwerkfout: bridge draait niet, of de website staat niet in de allowlist (dan geeft de
      // bridge bewust geen CORS-headers en ziet de browser het als netwerkfout).
      throw new EidError("no-bridge", "De eID-lezer (dafke-eid) is niet bereikbaar", { cause: error });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) throw errorFromBody(body);
    return body as T;
  }

  status(signal?: AbortSignal): Promise<BridgeStatus> {
    return this.#get<BridgeStatus>("/v1/status", signal);
  }

  async readCard(options: ReadCardOptions = {}): Promise<ReadCardResult> {
    const params = new URLSearchParams();
    if (options.reader !== undefined) params.set("reader", options.reader);
    if (options.photo === false) params.set("photo", "0");
    const query = params.size > 0 ? `?${params}` : "";
    const { reader, card } = await this.#get<CardResponse>(`/v1/card${query}`, options.signal);
    return { reader, card: decodeCardData(card) };
  }

  subscribe(listener: (event: EidClientEvent) => void): () => void {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) this.#open();
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#close();
    };
  }

  #emit(event: EidClientEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }

  #open(): void {
    const ES = this.#EventSource;
    if (!ES) {
      this.#emit({ type: "disconnected" });
      return;
    }
    const query = this.#token ? `?token=${encodeURIComponent(this.#token)}` : "";
    const source = new ES(`${this.url}/v1/events${query}`);
    this.#source = source;

    source.addEventListener("status", (event) => {
      this.#disconnectReported = false;
      this.#emit({ type: "status", status: JSON.parse((event as MessageEvent<string>).data) as BridgeStatus });
    });
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (event) => this.#emit(JSON.parse((event as MessageEvent<string>).data) as BridgeEvent));
    }
    source.onerror = () => {
      // Eén melding per verbroken verbinding (EventSource probeert daarna zelf opnieuw).
      if (!this.#disconnectReported) {
        this.#disconnectReported = true;
        this.#emit({ type: "disconnected" });
      }
      // CLOSED = de browser geeft het op (bv. bij een HTTP-fout): zelf opnieuw proberen.
      if (source.readyState === ES.CLOSED && this.#listeners.size > 0) {
        source.close();
        this.#reconnectTimer = setTimeout(() => {
          if (this.#listeners.size > 0 && this.#source === source) this.#open();
        }, this.#reconnectMs);
      }
    };
  }

  #close(): void {
    clearTimeout(this.#reconnectTimer);
    this.#source?.close();
    this.#source = undefined;
    this.#disconnectReported = false;
  }
}
