/**
 * Vaste foutcodes, zodat een UI per situatie een gepaste melding kan tonen.
 * Nieuwe codes alleen toevoegen, nooit hernoemen (het is publieke API en bridge-protocol).
 */
export const EID_ERROR_CODES = [
  "no-bridge", // de bridge draait niet of is niet bereikbaar
  "bridge-outdated", // de bridge is te oud voor deze versie van het pakket
  "origin-not-allowed", // deze website staat niet in de allowlist van de bridge
  "no-reader", // geen kaartlezer aangesloten
  "no-card", // geen kaart in de lezer
  "not-eid", // de kaart is geen Belgische eID
  "card-removed", // kaart verwijderd tijdens een operatie
  "card-busy", // een andere operatie loopt al op deze lezer
  "read-failed", // lezen van een bestand mislukt
  "invalid-data", // gegevens op de kaart zijn ongeldig (bv. foto-hash klopt niet)
  "pin-cancelled", // gebruiker heeft de PIN-invoer geannuleerd
  "pin-incorrect", // verkeerde PIN, nog pogingen over
  "pin-blocked", // PIN geblokkeerd
  "auth-not-allowed", // deze website mag geen PIN vragen
  "timeout", // operatie duurde te lang
  "aborted", // afgebroken via AbortSignal
  "unauthorized", // token van de bridge ontbreekt of klopt niet
  "not-found", // onbekend adres op de bridge
  "internal", // onverwachte fout
] as const;

export type EidErrorCode = (typeof EID_ERROR_CODES)[number];

export interface EidErrorOptions {
  cause?: unknown;
  /** Bij `pin-incorrect`: aantal resterende pogingen. */
  triesLeft?: number;
}

export class EidError extends Error {
  readonly code: EidErrorCode;
  readonly triesLeft?: number;

  constructor(code: EidErrorCode, message?: string, options: EidErrorOptions = {}) {
    super(message ?? code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "EidError";
    this.code = code;
    if (options.triesLeft !== undefined) this.triesLeft = options.triesLeft;
  }

  /** Werkt ook over grenzen van bundels/realms heen, waar `instanceof` faalt. */
  static is(value: unknown, code?: EidErrorCode): value is EidError {
    if (typeof value !== "object" || value === null) return false;
    const v = value as { name?: unknown; code?: unknown };
    if (v.name !== "EidError" || typeof v.code !== "string") return false;
    if (!(EID_ERROR_CODES as readonly string[]).includes(v.code)) return false;
    return code === undefined || v.code === code;
  }
}
