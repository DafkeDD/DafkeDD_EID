import { describe, expect, it } from "vitest";
import { encodeTlv, parseTlv } from "../../packages/eid/src/core";

describe("TLV", () => {
  it("leest eenvoudige velden", () => {
    expect(parseTlv(Uint8Array.of(0x01, 0x02, 0x41, 0x42, 0x02, 0x00))).toEqual([
      { tag: 0x01, value: Uint8Array.of(0x41, 0x42) },
      { tag: 0x02, value: new Uint8Array() },
    ]);
  });

  it("leest lengtes van meer dan één byte (basis-128)", () => {
    const value = new Uint8Array(300).fill(7);
    const encoded = encodeTlv([{ tag: 0x11, value }]);
    expect(Array.from(encoded.subarray(0, 3))).toEqual([0x11, 0x82, 0x2c]); // 2*128 + 44 = 300
    expect(parseTlv(encoded)).toEqual([{ tag: 0x11, value }]);
  });

  it("negeert opvulling met nullen na het laatste veld", () => {
    expect(parseTlv(Uint8Array.of(0x01, 0x01, 0x41, 0, 0, 0, 0))).toEqual([{ tag: 1, value: Uint8Array.of(0x41) }]);
  });

  it("behoudt tag 0x00 aan het begin (versie van de bestandsstructuur)", () => {
    expect(parseTlv(Uint8Array.of(0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x41))).toEqual([
      { tag: 0, value: Uint8Array.of(0, 3) },
      { tag: 1, value: Uint8Array.of(0x41) },
    ]);
  });

  it("gooit invalid-data bij afgekapte data", async () => {
    expect(() => parseTlv(Uint8Array.of(0x01, 0x05, 0x41))).toThrow(expect.objectContaining({ code: "invalid-data" }));
    expect(() => parseTlv(Uint8Array.of(0x01))).toThrow(expect.objectContaining({ code: "invalid-data" }));
    expect(() => parseTlv(Uint8Array.of(0x01, 0x81, 0x81, 0x81, 0x81, 0x01))).toThrow(/lengteveld te lang/);
  });

  it("encodeTlv en parseTlv zijn elkaars omgekeerde", () => {
    const records = [
      { tag: 0x00, value: Uint8Array.of(0, 3) },
      { tag: 0x07, value: new Uint8Array(127).fill(1) },
      { tag: 0x08, value: new Uint8Array(128).fill(2) },
    ];
    expect(parseTlv(encodeTlv(records))).toEqual(records);
  });
});
