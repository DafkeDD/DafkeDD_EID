/**
 * Bestanden selecteren en volledig uitlezen.
 */
import { concatBytes } from "./bytes";
import { formatSw, readBinaryCommand, selectFileCommand, SW, sw1 } from "./apdu";
import { EidError } from "./errors";
import { sendApdu, type CardTransport } from "./transport";

/** Blokgrootte voor READ BINARY. 240 werkt op alle lezers en kaartversies. */
export const READ_BLOCK_SIZE = 240;
/** Geen eID-bestand is groter; beschermt tegen een kaart die blijft antwoorden. */
export const MAX_FILE_SIZE = 32 * 1024;

export class FileNotFoundError extends EidError {
  constructor(path: Uint8Array) {
    super("read-failed", `Bestand ${pathToString(path)} niet gevonden`);
  }
}

export function pathToString(path: Uint8Array): string {
  return Array.from(path, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function selectFile(transport: CardTransport, path: Uint8Array): Promise<void> {
  const { sw } = await sendApdu(transport, selectFileCommand(path));
  if (sw === SW.OK) return;
  if (sw === SW.FILE_NOT_FOUND) throw new FileNotFoundError(path);
  throw new EidError("read-failed", `SELECT ${pathToString(path)} mislukt (SW ${formatSw(sw)})`);
}

/** Selecteert en leest een bestand volledig, blok per blok. */
export async function readFile(transport: CardTransport, path: Uint8Array): Promise<Uint8Array> {
  await selectFile(transport, path);

  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (;;) {
    if (offset >= MAX_FILE_SIZE) throw new EidError("read-failed", `Bestand ${pathToString(path)} is te groot`);
    const { data, sw } = await sendApdu(transport, readBinaryCommand(offset, READ_BLOCK_SIZE));

    if (sw === SW.WRONG_OFFSET) break; // offset voorbij het einde: bestand was een veelvoud van de blokgrootte
    if (sw === SW.END_OF_FILE) {
      chunks.push(data);
      break;
    }
    if (sw !== SW.OK) {
      // 6Cxx/61xx zijn al afgehandeld in sendApdu; dit is een echte fout.
      const reason = sw1(sw) === 0x69 ? "toegang geweigerd" : "leesfout";
      throw new EidError("read-failed", `READ BINARY ${pathToString(path)} @${offset}: ${reason} (SW ${formatSw(sw)})`);
    }

    chunks.push(data);
    offset += data.length;
    if (data.length < READ_BLOCK_SIZE) break;
  }

  return concatBytes(...chunks);
}
