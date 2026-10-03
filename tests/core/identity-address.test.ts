import { describe, expect, it } from "vitest";
import {
  encodeTlv,
  IDENTITY_TAGS,
  parseAddress,
  parseCardData,
  parseGender,
  parseIdentity,
  splitStreetAndNumber,
  utf8Encode,
} from "../../packages/eid/src/core";
import { createSampleFiles, sampleCardData } from "../../packages/eid/src/mock";

describe("identiteitsbestand", () => {
  it("leest alle velden van de voorbeeldkaart", async () => {
    const { identity } = await createSampleFiles();
    const parsed = parseIdentity(identity);
    expect(parsed).toMatchObject({
      cardNumber: "592000000097",
      chipNumber: "534C494E33660013931D2C2E43D53A00",
      validFrom: "2024-06-01",
      validUntil: "2034-06-01",
      issuingMunicipality: "Gent",
      nationalNumber: "85031512369",
      lastName: "Specimen",
      firstNames: "Jan Pieter",
      thirdNameInitial: "K",
      nationality: "Belg",
      placeOfBirth: "Gent",
      dateOfBirth: { year: 1985, month: 3, day: 15 },
      dateOfBirthRaw: "15 MAAR 1985",
      gender: "male",
      genderCode: "M",
      documentType: "1",
      specialStatus: "0",
      unknownFields: {},
    });
    expect(parsed.photoHash).toHaveLength(96); // SHA-384 op applet 1.8
  });

  it("gebruikt SHA-1 voor de foto-hash op applet 1.7", async () => {
    const { identity } = await createSampleFiles({ appletVersion: "1.7" });
    expect(parseIdentity(identity).photoHash).toHaveLength(40);
  });

  it("bewaart onbekende tags als hex", async () => {
    const { identity } = await createSampleFiles({ extraIdentityFields: [{ tag: 0x19, value: Uint8Array.of(0xca, 0xfe) }] });
    expect(parseIdentity(identity).unknownFields).toEqual({ "19": "cafe" });
  });

  it("geeft dateOfBirth null maar bewaart de ruwe tekst bij een onleesbare datum", async () => {
    const { identity } = await createSampleFiles({ identity: { dateOfBirth: "?? ??? 1985x" } });
    const parsed = parseIdentity(identity);
    expect(parsed.dateOfBirth).toBeNull();
    expect(parsed.dateOfBirthRaw).toBe("?? ??? 1985x");
  });

  it("gooit invalid-data zonder geldig rijksregisternummer", () => {
    const data = encodeTlv([{ tag: IDENTITY_TAGS.lastName, value: utf8Encode("X") }]);
    expect(() => parseIdentity(data)).toThrow(expect.objectContaining({ code: "invalid-data" }));
  });

  it.each([
    ["M", "male"],
    ["F", "female"],
    ["V", "female"],
    ["W", "female"],
    ["", "unknown"],
    ["X", "unknown"],
  ] as const)("geslacht %s → %s", (code, gender) => {
    expect(parseGender(code)).toBe(gender);
  });
});

describe("adresbestand", () => {
  it("leest het adres van de voorbeeldkaart", async () => {
    const { address } = await createSampleFiles();
    expect(parseAddress(address)).toEqual({
      streetAndNumber: "Voorbeeldstraat 12 bus 3",
      street: "Voorbeeldstraat",
      houseNumber: "12",
      box: "3",
      zipCode: "9000",
      municipality: "Gent",
      unknownFields: {},
    });
  });

  it.each([
    ["Kerkstraat 12", { street: "Kerkstraat", houseNumber: "12", box: "" }],
    ["Kerkstraat 12A", { street: "Kerkstraat", houseNumber: "12A", box: "" }],
    ["Kerkstraat 12/3", { street: "Kerkstraat", houseNumber: "12", box: "3" }],
    ["Kerkstraat 12 b3", { street: "Kerkstraat", houseNumber: "12", box: "3" }],
    ["Rue de la Loi 16", { street: "Rue de la Loi", houseNumber: "16", box: "" }],
    ["Avenue Louise 54 bte 2", { street: "Avenue Louise", houseNumber: "54", box: "2" }],
    ["Rue du 1er Mai 5 boîte A", { street: "Rue du 1er Mai", houseNumber: "5", box: "A" }],
    ["Hauptstraße 7-9", { street: "Hauptstraße", houseNumber: "7-9", box: "" }],
    ["Markt", { street: "Markt", houseNumber: "", box: "" }],
  ])("splitst %s", (input, expected) => {
    expect(splitStreetAndNumber(input)).toEqual(expected);
  });
});

describe("GET CARD DATA", () => {
  it("leest serienummer en appletversie", () => {
    expect(parseCardData(sampleCardData("1.8"))).toEqual({
      serialNumber: "534C494E33660013931D2C2E43D53A00",
      appletVersion: "1.8",
    });
    expect(parseCardData(sampleCardData("1.7")).appletVersion).toBe("1.7");
  });

  it("gooit invalid-data bij een te kort antwoord", () => {
    expect(() => parseCardData(new Uint8Array(10))).toThrow(expect.objectContaining({ code: "invalid-data" }));
  });
});
