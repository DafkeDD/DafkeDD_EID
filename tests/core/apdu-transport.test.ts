import { describe, expect, it } from "vitest";
import {
  EidError,
  fromHex,
  getCardDataCommand,
  parseResponse,
  readBinaryCommand,
  selectFileCommand,
  sendApdu,
  type CardTransport,
} from "../../packages/eid/src/core";

/** Transport dat vooraf vastgelegde antwoorden teruggeeft en commando's bijhoudt. */
function scripted(responses: string[]) {
  const sent: string[] = [];
  const transport: CardTransport = {
    async transmit(command) {
      sent.push(Array.from(command, (b) => b.toString(16).padStart(2, "0")).join(""));
      const next = responses.shift();
      if (next === undefined) throw new Error("geen antwoord meer");
      return fromHex(next);
    },
  };
  return { transport, sent };
}

describe("APDU-commando's", () => {
  it("bouwt SELECT FILE op pad", () => {
    expect(selectFileCommand(fromHex("DF014031"))).toEqual(fromHex("00A4080C04DF014031"));
    expect(() => selectFileCommand(new Uint8Array())).toThrow(EidError);
    expect(() => selectFileCommand(Uint8Array.of(1, 2, 3))).toThrow(EidError);
  });

  it("bouwt READ BINARY met offset en Le", () => {
    expect(readBinaryCommand(0, 240)).toEqual(fromHex("00B00000F0"));
    expect(readBinaryCommand(0x01e0, 256)).toEqual(fromHex("00B001E000"));
    expect(() => readBinaryCommand(-1, 10)).toThrow(EidError);
    expect(() => readBinaryCommand(0x8000, 10)).toThrow(EidError);
    expect(() => readBinaryCommand(0, 0)).toThrow(EidError);
  });

  it("bouwt GET CARD DATA", () => {
    expect(getCardDataCommand()).toEqual(fromHex("80E400001C"));
  });

  it("splitst een antwoord in data en statuswoord", () => {
    expect(parseResponse(fromHex("01029000"))).toEqual({ data: Uint8Array.of(1, 2), sw: 0x9000 });
    expect(() => parseResponse(Uint8Array.of(0x90))).toThrow(EidError);
  });
});

describe("sendApdu", () => {
  it("geeft een gewoon antwoord door", async () => {
    const { transport, sent } = scripted(["AABB9000"]);
    expect(await sendApdu(transport, fromHex("00B00000F0"))).toEqual({ data: fromHex("AABB"), sw: 0x9000 });
    expect(sent).toEqual(["00b00000f0"]);
  });

  it("haalt data op met GET RESPONSE na 61xx, ook in meerdere rondes", async () => {
    const { transport, sent } = scripted(["6104", "01020304610" + "2", "05069000"]);
    const result = await sendApdu(transport, fromHex("80E400001C"));
    expect(result).toEqual({ data: fromHex("010203040506"), sw: 0x9000 });
    expect(sent).toEqual(["80e400001c", "00c0000004", "00c0000002"]);
  });

  it("stuurt het commando opnieuw met de juiste Le na 6Cxx", async () => {
    const { transport, sent } = scripted(["6C1F", "AA9000"]);
    expect((await sendApdu(transport, fromHex("80E400001C"))).sw).toBe(0x9000);
    expect(sent).toEqual(["80e400001c", "80e400001f"]);
  });

  it("stopt na te veel GET RESPONSE-rondes", async () => {
    const transport: CardTransport = { transmit: async () => fromHex("6101") };
    await expect(sendApdu(transport, fromHex("00C0000001"))).rejects.toMatchObject({ code: "read-failed" });
  });
});
