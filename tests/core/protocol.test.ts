import { describe, expect, it } from "vitest";
import {
  assertOriginPattern,
  decodeCardData,
  DEFAULT_ORIGINS,
  encodeCardData,
  errorFromBody,
  fromBase64,
  matchOrigin,
  readEid,
  toBase64,
} from "../../packages/eid/src/core";
import { createSampleCard } from "../../packages/eid/src/mock";

describe("base64", () => {
  it("codeert en decodeert, ook grote buffers", () => {
    const data = new Uint8Array(100_000).map((_, i) => (i * 7) & 0xff);
    expect(fromBase64(toBase64(data))).toEqual(data);
    expect(toBase64(Uint8Array.of(0xff, 0x00, 0x41))).toBe("/wBB");
  });

  it("gooit invalid-data bij ongeldige base64", () => {
    expect(() => fromBase64("%%%")).toThrow(expect.objectContaining({ code: "invalid-data" }));
  });
});

describe("kaartdata over JSON", () => {
  it("encodeCardData → JSON → decodeCardData geeft hetzelfde terug", async () => {
    const der = new Uint8Array(50).fill(0x30);
    const data = await readEid(await createSampleCard({ certificates: { ca: der, root: der, rrn: der, authentication: der } }), {
      certificates: true,
    });
    const json = JSON.parse(JSON.stringify(encodeCardData(data)));
    expect(typeof json.photo.data).toBe("string");
    expect(decodeCardData(json)).toEqual(data);
  });
});

describe("errorFromBody", () => {
  it("neemt code en boodschap over", () => {
    expect(errorFromBody({ error: { code: "no-card", message: "Geen kaart" } })).toMatchObject({ code: "no-card", message: "Geen kaart" });
  });

  it("valt terug op internal bij een onbekende code of rommel", () => {
    expect(errorFromBody({ error: { code: "verzonnen", message: "x" } }).code).toBe("internal");
    expect(errorFromBody(null, "no-bridge").code).toBe("no-bridge");
  });
});

describe("matchOrigin", () => {
  it.each([
    ["http://localhost:3000", DEFAULT_ORIGINS, true],
    ["http://127.0.0.1:5173", DEFAULT_ORIGINS, true],
    ["http://localhost", DEFAULT_ORIGINS, true],
    ["https://localhost:3000", DEFAULT_ORIGINS, false],
    ["http://evil.com", DEFAULT_ORIGINS, false],
    ["http://localhost.evil.com:3000", DEFAULT_ORIGINS, false],
    ["https://app.voorbeeld.be", ["https://app.voorbeeld.be"], true],
    ["https://app.voorbeeld.be:443", ["https://app.voorbeeld.be"], true],
    ["https://app.voorbeeld.be:8443", ["https://app.voorbeeld.be"], false],
    ["https://APP.Voorbeeld.be", ["https://app.voorbeeld.be"], true],
    ["http://app.voorbeeld.be", ["https://app.voorbeeld.be"], false],
    ["https://a.voorbeeld.be", ["https://*.voorbeeld.be"], true],
    ["https://a.b.voorbeeld.be", ["https://*.voorbeeld.be"], true],
    ["https://voorbeeld.be", ["https://*.voorbeeld.be"], false],
    ["https://evilvoorbeeld.be", ["https://*.voorbeeld.be"], false],
    ["https://app.voorbeeld.be/pad", ["https://app.voorbeeld.be"], false],
    ["null", ["https://app.voorbeeld.be"], false],
    ["", DEFAULT_ORIGINS, false],
    ["https://app.voorbeeld.be", ["*"], false],
  ] as const)("%s met %j → %s", (origin, patterns, expected) => {
    expect(matchOrigin(origin, patterns)).toBe(expected);
  });

  it("weigert ongeldige patronen, ook *", () => {
    expect(() => assertOriginPattern("*")).toThrow(/Ongeldig origin-patroon/);
    expect(() => assertOriginPattern("app.voorbeeld.be")).toThrow();
    expect(() => assertOriginPattern("https://app.voorbeeld.be/")).toThrow();
    expect(() => assertOriginPattern("https://app.voorbeeld.be")).not.toThrow();
    expect(() => assertOriginPattern("http://localhost:*")).not.toThrow();
  });
});
