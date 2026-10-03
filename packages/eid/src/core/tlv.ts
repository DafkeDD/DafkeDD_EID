/**
 * Het eenvoudige TLV-formaat van het identiteits- en adresbestand:
 * één byte tag, een lengte in basis-128 (hoogste bit = "er volgt nog een lengtebyte"), dan de waarde.
 * Na het laatste veld kan opvulling met nullen volgen.
 */
import { EidError } from "./errors";

export interface TlvRecord {
  tag: number;
  value: Uint8Array;
}

const MAX_LENGTH_BYTES = 4;

export function parseTlv(data: Uint8Array): TlvRecord[] {
  const records: TlvRecord[] = [];
  let i = 0;

  while (i < data.length) {
    // Opvulling: vanaf hier alleen nog nullen → klaar.
    if (data[i] === 0x00 && records.length > 0 && data.subarray(i).every((b) => b === 0)) break;

    const tag = data[i++]!;
    let length = 0;
    let lengthBytes = 0;
    let byte: number;
    do {
      if (i >= data.length) throw new EidError("invalid-data", `TLV: lengte ontbreekt voor tag 0x${tag.toString(16)}`);
      if (++lengthBytes > MAX_LENGTH_BYTES) throw new EidError("invalid-data", "TLV: lengteveld te lang");
      byte = data[i++]!;
      length = length * 128 + (byte & 0x7f);
    } while (byte & 0x80);

    if (i + length > data.length) {
      throw new EidError("invalid-data", `TLV: waarde van tag 0x${tag.toString(16)} loopt voorbij het einde`);
    }
    records.push({ tag, value: data.slice(i, i + length) });
    i += length;
  }

  return records;
}

/** Omgekeerde van {@link parseTlv}; gebruikt door de virtuele kaart en tests. */
export function encodeTlv(records: readonly TlvRecord[]): Uint8Array {
  const out: number[] = [];
  for (const { tag, value } of records) {
    if (!Number.isInteger(tag) || tag < 0 || tag > 0xff) throw new EidError("internal", `TLV: ongeldige tag ${tag}`);
    out.push(tag, ...encodeLength(value.length), ...value);
  }
  return Uint8Array.from(out);
}

function encodeLength(length: number): number[] {
  const groups = [length & 0x7f];
  for (let rest = Math.floor(length / 128); rest > 0; rest = Math.floor(rest / 128)) {
    groups.unshift((rest & 0x7f) | 0x80);
  }
  return groups;
}
