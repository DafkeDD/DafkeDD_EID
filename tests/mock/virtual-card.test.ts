import { describe, expect, it } from "vitest";
import { fromHex, toHex } from "../../packages/eid/src/core";
import { SAMPLE_PHOTO, VirtualCard } from "../../packages/eid/src/mock";

const send = async (card: VirtualCard, hex: string) => toHex(await card.transmit(fromHex(hex))).toUpperCase();

describe("VirtualCard", () => {
  it("antwoordt 6A82 op een onbekend bestand en 6986 op READ BINARY zonder selectie", async () => {
    const card = new VirtualCard({});
    expect(await send(card, "00A4080C04DF014031")).toBe("6A82");
    expect(await send(card, "00B0000010")).toBe("6986");
  });

  it("geeft 6B00 voorbij het einde en een korter blok aan het einde", async () => {
    const card = new VirtualCard({ photo: Uint8Array.of(1, 2, 3) });
    expect(await send(card, "00A4080C04DF014035")).toBe("9000");
    expect(await send(card, "00B0000010")).toBe("0102039000");
    expect(await send(card, "00B0000310")).toBe("6B00");
  });

  it("antwoordt 6Cxx in strictLe-modus", async () => {
    const card = new VirtualCard({ photo: Uint8Array.of(1, 2, 3) }, { strictLe: true });
    await send(card, "00A4080C04DF014035");
    expect(await send(card, "00B0000010")).toBe("6C03");
  });

  it("kent geen andere commando's", async () => {
    expect(await send(new VirtualCard({}), "00200001")).toBe("6D00");
  });

  it("de voorbeeldfoto is een JPEG", () => {
    expect(SAMPLE_PHOTO.subarray(0, 2)).toEqual(Uint8Array.of(0xff, 0xd8));
    expect(SAMPLE_PHOTO.subarray(-2)).toEqual(Uint8Array.of(0xff, 0xd9));
  });
});
