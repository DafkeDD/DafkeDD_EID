/**
 * Nonces: één per loginpoging, één keer bruikbaar, kort geldig.
 * Draai je meerdere servers achter een load balancer, gebruik dan een gedeelde store (bv. Redis,
 * zie docs/server.md) in plaats van MemoryNonceStore.
 */
import { randomBytes } from "node:crypto";

export interface NonceStore {
  /** Bewaart een nieuwe nonce tot `expiresAt`. */
  save(nonce: string, expiresAt: Date): Promise<void> | void;
  /** Geeft true als de nonce bestond en nog geldig was, en verwijdert hem (één keer bruikbaar). */
  consume(nonce: string, now: Date): Promise<boolean> | boolean;
}

/** 32 willekeurige bytes in base64 (44 tekens), zoals Web eID vraagt. */
export function createNonce(): string {
  return randomBytes(32).toString("base64");
}

export class MemoryNonceStore implements NonceStore {
  readonly #nonces = new Map<string, number>();
  readonly #maxSize: number;

  constructor(options: { maxSize?: number } = {}) {
    this.#maxSize = options.maxSize ?? 100_000;
  }

  save(nonce: string, expiresAt: Date): void {
    if (this.#nonces.size >= this.#maxSize) this.#purge(Date.now());
    if (this.#nonces.size >= this.#maxSize) {
      // Nog altijd vol: de oudste weg (Map behoudt de volgorde).
      const oldest = this.#nonces.keys().next().value;
      if (oldest !== undefined) this.#nonces.delete(oldest);
    }
    this.#nonces.set(nonce, expiresAt.getTime());
  }

  consume(nonce: string, now: Date): boolean {
    const expires = this.#nonces.get(nonce);
    this.#nonces.delete(nonce);
    return expires !== undefined && expires >= now.getTime();
  }

  get size(): number {
    return this.#nonces.size;
  }

  #purge(now: number): void {
    for (const [nonce, expires] of this.#nonces) if (expires < now) this.#nonces.delete(nonce);
  }
}
