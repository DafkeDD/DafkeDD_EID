import { describe, expect, it } from "vitest";
import { formatPartialDate, parseBirthDate, parseCardDate } from "../../packages/eid/src/core";

describe("geboortedatum", () => {
  it.each([
    ["15 MAAR 1985", { year: 1985, month: 3, day: 15 }],
    ["15 MARS 1985", { year: 1985, month: 3, day: 15 }],
    ["15.MÄR.1985", { year: 1985, month: 3, day: 15 }],
    ["01 JAN 2001", { year: 2001, month: 1, day: 1 }],
    ["03 FÉV 1990", { year: 1990, month: 2, day: 3 }],
    ["12 AOÛT 1979", { year: 1979, month: 8, day: 12 }],
    ["12 OKT 1979", { year: 1979, month: 10, day: 12 }],
    ["24 DEZ 1966", { year: 1966, month: 12, day: 24 }],
    ["24  DEC  1966 ", { year: 1966, month: 12, day: 24 }],
  ])("%s", (raw, expected) => {
    expect(parseBirthDate(raw)).toEqual(expected);
  });

  it("ondersteunt gedeeltelijke datums", () => {
    expect(parseBirthDate("MEI 1950")).toEqual({ year: 1950, month: 5 });
    expect(parseBirthDate("1950")).toEqual({ year: 1950 });
    expect(parseBirthDate("00 MEI 1950")).toEqual({ year: 1950, month: 5 });
    expect(parseBirthDate("00 00 1950")).toEqual({ year: 1950 });
  });

  it("geeft null bij iets onleesbaars in plaats van te gokken", () => {
    for (const raw of ["", "15 XYZ 1985", "31 FEB 1985", "15 MAAR 85", "15 00 1985", "hallo", "1 2 3 1985"]) {
      expect(parseBirthDate(raw), raw).toBeNull();
    }
  });

  it("houdt rekening met schrikkeljaren", () => {
    expect(parseBirthDate("29 FEB 2000")).toEqual({ year: 2000, month: 2, day: 29 });
    expect(parseBirthDate("29 FEB 1900")).toBeNull();
  });

  it("formatPartialDate", () => {
    expect(formatPartialDate({ year: 1985, month: 3, day: 5 })).toBe("1985-03-05");
    expect(formatPartialDate({ year: 1985, month: 3 })).toBe("1985-03");
    expect(formatPartialDate({ year: 1985 })).toBe("1985");
  });
});

describe("geldigheidsdatum", () => {
  it("zet DD.MM.YYYY om naar ISO", () => {
    expect(parseCardDate("01.06.2024")).toBe("2024-06-01");
  });

  it("gooit invalid-data bij een ongeldige datum", () => {
    for (const raw of ["2024-06-01", "32.01.2024", "29.02.2023", ""]) {
      expect(() => parseCardDate(raw), raw).toThrow(expect.objectContaining({ code: "invalid-data" }));
    }
  });
});
