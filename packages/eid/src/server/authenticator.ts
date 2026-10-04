/**
 * Alles samen voor een login-server: challenge uitgeven en token controleren.
 *
 *   const eid = new EidAuthenticator({ origin: "https://sso.voorbeeld.be" });
 *   const { nonce } = await eid.createChallenge();      // naar de browser (en in de sessie)
 *   const who = await eid.verify(token, nonce);          // token van de browser, nonce uit de sessie
 */
import { MAX_NONCE_LENGTH, MIN_NONCE_LENGTH } from "../core/auth";
import { EidVerifyError } from "./errors";
import type { EidLoginIdentity } from "./identity";
import { createNonce, MemoryNonceStore, type NonceStore } from "./nonce";
import type { OcspOptions } from "./ocsp";
import { verifyEidToken, type EidTrustOptions } from "./validator";

export interface EidAuthenticatorOptions {
  /** Jouw origin (moet in authOrigins van de bridge staan), bv. "https://sso.voorbeeld.be". */
  origin: string;
  nonceStore?: NonceStore;
  /** Hoe lang een challenge geldig is. Standaard 5 minuten. */
  nonceTtlMs?: number;
  trust?: EidTrustOptions;
  /** OCSP-instellingen, of `false` om niet te controleren (alleen voor tests!). */
  revocation?: OcspOptions | false;
  now?: () => Date;
}

export interface EidChallenge {
  nonce: string;
  expiresAt: Date;
}

export class EidAuthenticator {
  readonly origin: string;
  readonly #store: NonceStore;
  readonly #ttl: number;
  readonly #options: EidAuthenticatorOptions;
  readonly #now: () => Date;

  constructor(options: EidAuthenticatorOptions) {
    if (!/^https?:\/\/[^/\s?#]+$/.test(options.origin.replace(/\/+$/, ""))) {
      throw new EidVerifyError("config-invalid", `Ongeldige origin: "${options.origin}" (verwacht bv. https://sso.voorbeeld.be)`);
    }
    this.origin = options.origin.replace(/\/+$/, "").toLowerCase();
    this.#store = options.nonceStore ?? new MemoryNonceStore();
    this.#ttl = options.nonceTtlMs ?? 5 * 60_000;
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  async createChallenge(): Promise<EidChallenge> {
    const nonce = createNonce();
    const expiresAt = new Date(this.#now().getTime() + this.#ttl);
    await this.#store.save(nonce, expiresAt);
    return { nonce, expiresAt };
  }

  /**
   * Controleert het token. De nonce wordt eerst verbruikt (ook als de controle daarna faalt), zodat
   * hij nooit twee keer kan dienen.
   * @throws EidVerifyError
   */
  async verify(token: unknown, nonce: string): Promise<EidLoginIdentity> {
    if (typeof nonce !== "string" || nonce.length < MIN_NONCE_LENGTH || nonce.length > MAX_NONCE_LENGTH) {
      throw new EidVerifyError("nonce-invalid", "Ongeldige nonce");
    }
    if (!(await this.#store.consume(nonce, this.#now()))) throw new EidVerifyError("nonce-invalid", "Nonce onbekend, al gebruikt of verlopen");
    return verifyEidToken({
      token,
      origin: this.origin,
      nonce,
      ...(this.#options.trust ? { trust: this.#options.trust } : {}),
      ...(this.#options.revocation !== undefined ? { revocation: this.#options.revocation } : {}),
      now: this.#now,
    });
  }
}
