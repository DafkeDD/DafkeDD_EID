import { toHex } from "../bytes";
import { EidError } from "../errors";
import type { EidCardInfo } from "../types";

/**
 * Antwoord op GET CARD DATA (Belpic): bytes 0–15 = chip-serienummer, byte 21 = appletversie
 * (0x11 = 1.1, 0x17 = 1.7, 0x18 = 1.8).
 */
export function parseCardData(data: Uint8Array): EidCardInfo {
  if (data.length < 22) throw new EidError("invalid-data", `GET CARD DATA: te kort (${data.length} bytes)`);
  const version = data[21]!;
  return {
    serialNumber: toHex(data.subarray(0, 16)).toUpperCase(),
    appletVersion: `${version >> 4}.${version & 0x0f}`,
  };
}
