/**
 * Een nagebootste eID in het geheugen. Implementeert {@link CardTransport}, zodat readEid()
 * en later de bridge zonder kaartlezer te testen zijn.
 *
 * Ondersteunt: SELECT FILE (pad), READ BINARY, GET CARD DATA, GET RESPONSE, en voor aanmelden
 * VERIFY (PIN), MSE: SET en PSO: COMPUTE DIGITAL SIGNATURE.
 */
import { EidError, type CardTransport, type EidFileName, EID_FILES, toHex } from "../core";

export interface VirtualCardOptions {
  /** Antwoord op GET CARD DATA; `null` = kaart kent het commando niet (6D00). */
  cardData?: Uint8Array | null;
  /** T=0-gedrag nabootsen: GET CARD DATA antwoordt `61xx` en vraagt een GET RESPONSE. */
  t0?: boolean;
  /** Bij een te grote Le `6Cxx` antwoorden (zoals sommige kaarten) in plaats van korter antwoord + 9000. */
  strictLe?: boolean;
  /** Aanmelden mogelijk maken (PIN + ondertekenen). Zonder: VERIFY/MSE/PSO geven 6D00. */
  auth?: VirtualAuthOptions;
}

export interface VirtualAuthOptions {
  /** De juiste PIN (4–12 cijfers). */
  pin: string;
  /** Resterende pogingen bij de start. Standaard 3. */
  triesLeft?: number;
  /** Ondertekent een hash met de authenticatiesleutel (algoritmereferentie uit MSE: SET). */
  sign(hash: Uint8Array, algorithmReference: number): Uint8Array | Promise<Uint8Array>;
}

/** Leest de PIN uit een PIN-blok (2 | lengte | cijfers | F). */
function decodePinBlock(block: Uint8Array): string | undefined {
  const nibbles = Array.from(block).flatMap((b) => [b >> 4, b & 0x0f]);
  if (nibbles[0] !== 0x2) return undefined;
  const length = nibbles[1]!;
  const digits = nibbles.slice(2, 2 + length);
  if (digits.length !== length || digits.some((d) => d > 9)) return undefined;
  return digits.join("");
}

const sw = (value: number) => Uint8Array.of(value >> 8, value & 0xff);
const withSw = (data: Uint8Array, value: number) => {
  const out = new Uint8Array(data.length + 2);
  out.set(data);
  out.set(sw(value), data.length);
  return out;
};

export class VirtualCard implements CardTransport {
  /** Alle ontvangen commando's, voor tests. */
  readonly commands: Uint8Array[] = [];

  readonly #files = new Map<string, Uint8Array>();
  readonly #options: VirtualCardOptions;
  #selected: Uint8Array | undefined;
  #pendingResponse: Uint8Array | undefined;
  #removed = false;
  #pinVerified = false;
  #triesLeft: number;
  #securityEnvironment: { algorithm: number; key: number } | undefined;

  constructor(files: Partial<Record<EidFileName, Uint8Array>>, options: VirtualCardOptions = {}) {
    for (const [name, data] of Object.entries(files) as [EidFileName, Uint8Array][]) {
      this.#files.set(toHex(EID_FILES[name]), data);
    }
    this.#options = options;
    this.#triesLeft = options.auth?.triesLeft ?? 3;
  }

  /** Resterende PIN-pogingen (voor tests). */
  get pinTriesLeft(): number {
    return this.#triesLeft;
  }

  /** Bootst het uittrekken van de kaart na: elke volgende transmit faalt met `card-removed`. */
  remove(): void {
    this.#removed = true;
  }

  async transmit(command: Uint8Array): Promise<Uint8Array> {
    if (this.#removed) throw new EidError("card-removed", "De kaart is verwijderd");
    // PIN-blokken niet bewaren in de geschiedenis.
    const isVerify = command[1] === 0x20 && command.length > 5;
    this.commands.push(isVerify ? command.slice(0, 5) : command.slice());
    if (command[0] === 0x00 && command[1] === 0x2a) return this.#sign(command);
    return this.#handle(command);
  }

  /** Antwoord met data; met `t0` via 61xx + GET RESPONSE, zoals een echte T=0-kaart. */
  #respond(data: Uint8Array): Uint8Array {
    if (this.#options.t0 && data.length > 0) {
      this.#pendingResponse = data;
      return sw(0x6100 | (data.length & 0xff));
    }
    return withSw(data, 0x9000);
  }

  async #sign(apdu: Uint8Array): Promise<Uint8Array> {
    const auth = this.#options.auth;
    if (!auth) return sw(0x6d00);
    if (apdu[2] !== 0x9e || apdu[3] !== 0x9a) return sw(0x6a86);
    if (!this.#pinVerified) return sw(0x6982);
    const env = this.#securityEnvironment;
    if (!env) return sw(0x6985);
    const lc = apdu[4] ?? 0;
    const hash = apdu.slice(5, 5 + lc);
    return this.#respond(await auth.sign(hash, env.algorithm));
  }

  #handle(apdu: Uint8Array): Uint8Array {
    if (apdu.length < 4) return sw(0x6700);
    const [cla, ins, p1, p2] = apdu as unknown as [number, number, number, number];

    // SELECT FILE op pad vanaf de root, zonder antwoorddata.
    if (cla === 0x00 && ins === 0xa4) {
      if (p1 !== 0x08 || p2 !== 0x0c) return sw(0x6a86);
      const lc = apdu[4] ?? 0;
      const path = apdu.subarray(5, 5 + lc);
      const file = this.#files.get(toHex(path));
      if (!file) return sw(0x6a82);
      this.#selected = file;
      return sw(0x9000);
    }

    // READ BINARY
    if (cla === 0x00 && ins === 0xb0) {
      if (!this.#selected) return sw(0x6986);
      const offset = (p1 << 8) | p2;
      const le = apdu[4] === 0 ? 256 : (apdu[4] ?? 256);
      if (offset >= this.#selected.length) return sw(0x6b00);
      const remaining = this.#selected.length - offset;
      if (le > remaining && this.#options.strictLe) return sw(0x6c00 | remaining);
      return withSw(this.#selected.subarray(offset, offset + Math.min(le, remaining)), 0x9000);
    }

    // GET CARD DATA
    if (cla === 0x80 && ins === 0xe4) {
      const data = this.#options.cardData;
      if (!data) return sw(0x6d00);
      if (this.#options.t0) return this.#respond(data);
      const le = apdu[4] === 0 ? 256 : (apdu[4] ?? 256);
      if (le !== data.length) return sw(0x6c00 | data.length);
      return withSw(data, 0x9000);
    }

    // VERIFY (PIN)
    if (cla === 0x00 && ins === 0x20) {
      const auth = this.#options.auth;
      if (!auth) return sw(0x6d00);
      if (p2 !== 0x01) return sw(0x6a88);
      if (this.#triesLeft === 0) return sw(0x6983);
      if (apdu.length <= 5) return this.#pinVerified ? sw(0x9000) : sw(0x63c0 | this.#triesLeft);
      const pin = decodePinBlock(apdu.subarray(5, 5 + (apdu[4] ?? 0)));
      if (pin === auth.pin) {
        this.#pinVerified = true;
        this.#triesLeft = auth.triesLeft ?? 3;
        return sw(0x9000);
      }
      this.#pinVerified = false;
      this.#triesLeft--;
      return this.#triesLeft === 0 ? sw(0x6983) : sw(0x63c0 | this.#triesLeft);
    }

    // MSE: SET
    if (cla === 0x00 && ins === 0x22) {
      if (!this.#options.auth) return sw(0x6d00);
      if (p1 !== 0x41 || p2 !== 0xb6 || apdu[5] !== 0x04 || apdu[6] !== 0x80 || apdu[8] !== 0x84) return sw(0x6a80);
      if (apdu[9] !== 0x82) return sw(0x6a88); // alleen de authenticatiesleutel
      this.#securityEnvironment = { algorithm: apdu[7]!, key: apdu[9]! };
      return sw(0x9000);
    }

    // GET RESPONSE
    if (cla === 0x00 && ins === 0xc0) {
      const pending = this.#pendingResponse;
      if (!pending) return sw(0x6985);
      this.#pendingResponse = undefined;
      return withSw(pending.subarray(0, apdu[4] === 0 ? 256 : apdu[4]), 0x9000);
    }

    return sw(0x6d00);
  }
}
