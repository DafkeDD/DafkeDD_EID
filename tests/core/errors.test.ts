import { describe, expect, it } from "vitest";
import { EID_ERROR_CODES, EidError } from "../../packages/eid/src/core";

describe("EidError", () => {
  it("bewaart code, boodschap en oorzaak", () => {
    const cause = new Error("pcsc");
    const err = new EidError("no-card", "Steek je eID in", { cause });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("EidError");
    expect(err.code).toBe("no-card");
    expect(err.message).toBe("Steek je eID in");
    expect(err.cause).toBe(cause);
  });

  it("gebruikt de code als boodschap als er geen boodschap is", () => {
    expect(new EidError("timeout").message).toBe("timeout");
  });

  it("bewaart resterende PIN-pogingen", () => {
    expect(new EidError("pin-incorrect", undefined, { triesLeft: 2 }).triesLeft).toBe(2);
    expect(new EidError("pin-incorrect").triesLeft).toBeUndefined();
  });

  it("EidError.is herkent fouten, ook als gewoon object (bv. over het bridge-protocol)", () => {
    expect(EidError.is(new EidError("no-reader"))).toBe(true);
    expect(EidError.is({ name: "EidError", code: "no-reader" }, "no-reader")).toBe(true);
    expect(EidError.is(new EidError("no-reader"), "no-card")).toBe(false);
    expect(EidError.is({ name: "EidError", code: "verzonnen" })).toBe(false);
    expect(EidError.is(new Error("x"))).toBe(false);
    expect(EidError.is(null)).toBe(false);
  });

  it("heeft unieke foutcodes", () => {
    expect(new Set(EID_ERROR_CODES).size).toBe(EID_ERROR_CODES.length);
  });
});
