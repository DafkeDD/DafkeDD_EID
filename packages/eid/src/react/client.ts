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
  type AuthenticateResponse,
  type BridgeEvent,
  type EidAuthToken,
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

export interface AuthenticateOptions {
  /** Uitdaging van je server (minstens 44 tekens, bv. base64 van 32 willekeurige bytes). */
  nonce: string;
  /** PIN die de gebruiker intypte (4–12 cijfers). Wordt nergens bewaard. */
  pin: string;
  reader?: string;
  signal?: AbortSignal;
}

export interface AuthenticateResult {
  reader: string;
  token: EidAuthToken;
}

/** Wat de store nodig heeft. `EidClient` (echte bridge) en `MockEidClient` implementeren dit. */
export interface EidClientLike {
  status(signal?: AbortSignal): Promise<BridgeStatus>;
  readCard(options?: ReadCardOptions): Promise<ReadCardResult>;
  /** Aanmelden met PIN (alleen als de website in authOrigins van de bridge staat). */
  authenticate?(options: AuthenticateOptions): Promise<AuthenticateResult>;
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

  async #get<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
    let response: Response;
    try {
      const headers: Record<string, string> = this.#token ? { [TOKEN_HEADER]: this.#token } : {};
      if (body !== undefined) headers["content-type"] = "application/json";
      response = await this.#fetch(`${this.url}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        cache: "no-store",
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw new EidError("aborted", "Afgebroken", { cause: error });
      // Netwerkfout: bridge draait niet, of de website staat niet in de allowlist (dan geeft de
      // bridge bewust geen CORS-headers en ziet de browser het als netwerkfout).
      throw new EidError("no-bridge", "De eID-lezer (dafke-eid) is niet bereikbaar", { cause: error });
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok) throw errorFromBody(json);
    return json as T;
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

  /** POST /v1/authenticate. De bridge ondertekent de origin van deze pagina (Origin-header). */
  async authenticate(options: AuthenticateOptions): Promise<AuthenticateResult> {
    const body = { nonce: options.nonce, pin: options.pin, ...(options.reader !== undefined ? { reader: options.reader } : {}) };
    return this.#get<AuthenticateResponse>("/v1/authenticate", options.signal, body);
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
