import { parseTlv } from "../tlv";
import type { EidAddress } from "../types";
import { textField, tlvMap, unknownFields } from "./fields";

/** Tags van het adresbestand (DF01 4033). Tag 0x00 = versie van de bestandsstructuur. */
export const ADDRESS_TAGS = {
  fileStructureVersion: 0x00,
  streetAndNumber: 0x01,
  zipCode: 0x02,
  municipality: 0x03,
} as const;

const KNOWN = new Set<number>(Object.values(ADDRESS_TAGS));

const HOUSE_NUMBER = String.raw`\d+[A-Za-z]{0,2}(?:-\d+[A-Za-z]{0,2})?`;
const BOX = String.raw`(?:\s*/\s*|\s+(?:bus|bte|boîte|boite|box|b)\.?\s*)([0-9A-Za-z.\-]+)`;
const STREET_AND_NUMBER = new RegExp(String.raw`^(.*?\S)\s+(${HOUSE_NUMBER})(?:${BOX})?$`, "i");

/**
 * Best-effort: `Kerkstraat 12 bus 3`, `Rue de la Loi 16`, `Kerkstraat 12/3`, `Avenue Louise 54 bte 2`.
 * Lukt het niet, dan staat alles in `street`.
 */
export function splitStreetAndNumber(streetAndNumber: string): Pick<EidAddress, "street" | "houseNumber" | "box"> {
  const input = streetAndNumber.trim().replace(/\s+/g, " ");
  const match = STREET_AND_NUMBER.exec(input);
  if (!match) return { street: input, houseNumber: "", box: "" };
  return { street: match[1]!, houseNumber: match[2]!, box: match[3] ?? "" };
}

export function parseAddress(data: Uint8Array): EidAddress {
  const records = parseTlv(data);
  const map = tlvMap(records);
  const streetAndNumber = textField(map, ADDRESS_TAGS.streetAndNumber);
  return {
    streetAndNumber,
    ...splitStreetAndNumber(streetAndNumber),
    zipCode: textField(map, ADDRESS_TAGS.zipCode),
    municipality: textField(map, ADDRESS_TAGS.municipality),
    unknownFields: unknownFields(records, KNOWN),
  };
}
