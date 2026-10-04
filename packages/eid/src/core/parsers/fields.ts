import { toHex, utf8Decode } from "../bytes";
import type { TlvRecord } from "../tlv";

/** Eerste voorkomen per tag. */
export function tlvMap(records: readonly TlvRecord[]): Map<number, Uint8Array> {
  const map = new Map<number, Uint8Array>();
  for (const { tag, value } of records) if (!map.has(tag)) map.set(tag, value);
  return map;
}

export function textField(map: Map<number, Uint8Array>, tag: number): string {
  const value = map.get(tag);
  return value ? utf8Decode(value).replace(/\0+$/, "").trim() : "";
}

/** Tags die we niet kennen, als hex, zodat nieuwere kaartversies niets verliezen. */
export function unknownFields(records: readonly TlvRecord[], known: ReadonlySet<number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { tag, value } of records) {
    if (known.has(tag)) continue;
    const key = tag.toString(16).padStart(2, "0");
    if (!(key in out)) out[key] = toHex(value);
  }
  return out;
}
