import { describe, expect, it } from "vitest";
import { ageOn, formatAddress, formatDate, formatNationalNumber, fullName, photoDataUrl } from "../../packages/eid/src/react/format";

describe("formatters", () => {
  it("fullName", () => {
    expect(fullName({ firstNames: "Jan  Pieter", lastName: "Specimen" })).toBe("Jan Pieter Specimen");
  });

  it("formatNationalNumber", () => {
    expect(formatNationalNumber("85031512369")).toBe("85.03.15-123.69");
  });

  it("formatDate met ISO, PartialDate en gedeeltelijke datums", () => {
    expect(formatDate("2034-06-01")).toBe("01/06/2034");
    expect(formatDate({ year: 1985, month: 3, day: 15 })).toBe("15/03/1985");
    expect(formatDate({ year: 1985, month: 3 })).toBe("maart 1985");
    expect(formatDate({ year: 1985 })).toBe("1985");
    expect(formatDate(null)).toBe("");
    expect(formatDate({ year: 1985, month: 3 }, "fr-BE")).toBe("mars 1985");
  });

  it("formatAddress", () => {
    expect(formatAddress({ streetAndNumber: "Voorbeeldstraat 12 bus 3", zipCode: "9000", municipality: "Gent" })).toBe(
      "Voorbeeldstraat 12 bus 3, 9000 Gent",
    );
  });

  it("photoDataUrl", () => {
    expect(photoDataUrl({ mimeType: "image/jpeg", data: Uint8Array.of(0xff, 0xd8) })).toBe("data:image/jpeg;base64,/9g=");
    expect(photoDataUrl(null)).toBeUndefined();
  });

  it("ageOn", () => {
    const birth = { year: 1985, month: 3, day: 15 };
    expect(ageOn(birth, new Date(2026, 2, 14))).toBe(40);
    expect(ageOn(birth, new Date(2026, 2, 15))).toBe(41);
    expect(ageOn({ year: 1985 }, new Date())).toBeNull();
  });
});
