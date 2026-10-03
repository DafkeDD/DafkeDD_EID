/**
 * APDU's (ISO/IEC 7816-4) die we naar de eID sturen, en het ontleden van antwoorden.
 */
import { EidError } from "./errors";

export interface ResponseApdu {
  /** Antwoorddata zonder statuswoord. */
  data: Uint8Array;
  /** Statuswoord SW1SW2 als getal, bv. 0x9000. */
  sw: number;
}

/** Statuswoorden die we herkennen. */
export const SW = {
  OK: 0x9000,
  END_OF_FILE: 0x6282,
  SECURITY_NOT_SATISFIED: 0x6982,
  PIN_BLOCKED: 0x6983,
  FILE_NOT_FOUND: 0x6a82,
  WRONG_OFFSET: 0x6b00,
} as const;

export const sw1 = (sw: number): number => sw >> 8;
export const sw2 = (sw: number): number => sw & 0xff;
export const formatSw = (sw: number): string => sw.toString(16).padStart(4, "0").toUpperCase();

export function parseResponse(raw: Uint8Array): ResponseApdu {
  if (raw.length < 2) throw new EidError("internal", `Antwoord van de kaart is te kort (${raw.length} bytes)`);
  return {
    data: raw.slice(0, raw.length - 2),
    sw: (raw[raw.length - 2]! << 8) | raw[raw.length - 1]!,
  };
}

function checkByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new EidError("internal", `${name} buiten bereik: ${value}`);
}

/** SELECT FILE op pad vanaf de root (P1=08, 3F00 impliciet), zonder antwoorddata (P2=0C). */
export function selectFileCommand(path: Uint8Array): Uint8Array {
  if (path.length === 0 || path.length % 2 !== 0 || path.length > 0xff) {
    throw new EidError("internal", "Ongeldig bestandspad");
  }
  return Uint8Array.of(0x00, 0xa4, 0x08, 0x0c, path.length, ...path);
}

/** READ BINARY vanaf `offset` (max. 0x7FFF), `le` bytes (1–256; 256 wordt 0x00). */
export function readBinaryCommand(offset: number, le: number): Uint8Array {
  if (!Number.isInteger(offset) || offset < 0 || offset > 0x7fff) throw new EidError("internal", `Offset buiten bereik: ${offset}`);
  if (!Number.isInteger(le) || le < 1 || le > 256) throw new EidError("internal", `Le buiten bereik: ${le}`);
  return Uint8Array.of(0x00, 0xb0, offset >> 8, offset & 0xff, le & 0xff);
}

/** GET RESPONSE: haalt data op na een `61xx`-antwoord. */
export function getResponseCommand(le: number): Uint8Array {
  checkByte(le, "Le");
  return Uint8Array.of(0x00, 0xc0, 0x00, 0x00, le);
}

/** GET CARD DATA (Belpic): chip-serienummer en versies. */
export function getCardDataCommand(): Uint8Array {
  return Uint8Array.of(0x80, 0xe4, 0x00, 0x00, 0x1c);
}

/** Zelfde commando met een andere Le (na `6Cxx`). Alleen voor case-2-commando's (laatste byte = Le). */
export function withLe(command: Uint8Array, le: number): Uint8Array {
  checkByte(le, "Le");
  const copy = command.slice();
  copy[copy.length - 1] = le;
  return copy;
}
