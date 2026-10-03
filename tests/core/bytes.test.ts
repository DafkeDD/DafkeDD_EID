import { describe, expect, it } from "vitest";
import { concatBytes, digest, equalBytes, fromHex, toHex, utf8Decode, utf8Encode } from "../../packages/eid/src/core";

describe("bytes", () => {
  it("zet hex om in beide richtingen", () => {
    expect(toHex(Uint8Array.of(0x00, 0x0f, 0xab, 0xff))).toBe("000fabff");
    expect(fromHex("00 0F ab ff")).toEqual(Uint8Array.of(0x00, 0x0f, 0xab, 0xff));
  });

  it("weigert ongeldige hex", () => {
    expect(() => fromHex("abc")).toThrow(/Ongeldige hex/);
    expect(() => fromHex("zz")).toThrow(/Ongeldige hex/);
  });

  it("voegt samen en vergelijkt", () => {
    const joined = concatBytes(Uint8Array.of(1), Uint8Array.of(), Uint8Array.of(2, 3));
    expect(joined).toEqual(Uint8Array.of(1, 2, 3));
    expect(equalBytes(joined, Uint8Array.of(1, 2, 3))).toBe(true);
    expect(equalBytes(joined, Uint8Array.of(1, 2))).toBe(false);
    expect(equalBytes(joined, Uint8Array.of(1, 2, 4))).toBe(false);
  });

  it("codeert UTF-8 met accenten", () => {
    expect(utf8Decode(utf8Encode("Liège – Sint-Niklaas"))).toBe("Liège – Sint-Niklaas");
  });

  it("hasht via WebCrypto, ook een subarray", async () => {
    expect(toHex(await digest("SHA-1", utf8Encode("abc")))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    const big = utf8Encode("xxabcxx");
    expect(toHex(await digest("SHA-1", big.subarray(2, 5)))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });
});
