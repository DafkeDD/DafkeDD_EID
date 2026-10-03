import { describe, expect, it } from "vitest";
import { checkNationalNumber } from "../../packages/eid/src/core";

describe("rijksregisternummer", () => {
  it("herkent een geldig nummer van voor 2000", () => {
    expect(checkNationalNumber("85031512369")).toEqual({ valid: true, century: 1900, formatted: "85.03.15-123.69" });
  });

  it("herkent een geldig nummer van na 2000", () => {
    expect(checkNationalNumber("05.06.12-246.55")).toEqual({ valid: true, century: 2000, formatted: "05.06.12-246.55" });
  });

  it("weigert een fout controlegetal", () => {
    expect(checkNationalNumber("85031512368")).toMatchObject({ valid: false, century: null });
  });

  it("weigert iets dat geen 11 cijfers is", () => {
    expect(checkNationalNumber("1234")).toEqual({ valid: false, century: null, formatted: "1234" });
  });
});
