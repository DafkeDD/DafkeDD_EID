/**
 * Een nagebootste eID in het geheugen. Implementeert {@link CardTransport}, zodat readEid()
 * en later de bridge zonder kaartlezer te testen zijn.
 *
 * Ondersteunt: SELECT FILE (pad), READ BINARY, GET CARD DATA, GET RESPONSE.
 */
import { EidError, type CardTransport, type EidFileName, EID_FILES, toHex } from "../core";

export interface VirtualCardOptions {
  /** Antwoord op GET CARD DATA; `null` = kaart kent het commando niet (6D00). */
  cardData?: Uint8Array | null;
  /** T=0-gedrag nabootsen: GET CARD DATA antwoordt `61xx` en vraagt een GET RESPONSE. */
  t0?: boolean;
  /** Bij een te grote Le `6Cxx` antwoorden (zoals sommige kaarten) in plaats van korter antwoord + 9000. */
  strictLe?: boolean;
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

  constructor(files: Partial<Record<EidFileName, Uint8Array>>, options: VirtualCardOptions = {}) {
    for (const [name, data] of Object.entries(files) as [EidFileName, Uint8Array][]) {
      this.#files.set(toHex(EID_FILES[name]), data);
    }
    this.#options = options;
  }

  /** Bootst het uittrekken van de kaart na: elke volgende transmit faalt met `card-removed`. */
  remove(): void {
    this.#removed = true;
  }

  async transmit(command: Uint8Array): Promise<Uint8Array> {
    if (this.#removed) throw new EidError("card-removed", "De kaart is verwijderd");
    this.commands.push(command.slice());
    return this.#handle(command);
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
      if (this.#options.t0) {
        this.#pendingResponse = data;
        return sw(0x6100 | data.length);
      }
      const le = apdu[4] === 0 ? 256 : (apdu[4] ?? 256);
      if (le !== data.length) return sw(0x6c00 | data.length);
      return withSw(data, 0x9000);
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
