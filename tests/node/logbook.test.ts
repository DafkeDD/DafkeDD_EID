import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Logbook } from "../../packages/eid/src/node/logbook";

describe("Logbook", () => {
  it("bewaart de laatste regels in het geheugen", () => {
    const log = new Logbook({ size: 3, now: () => new Date("2026-01-01T00:00:00Z") });
    for (let i = 1; i <= 5; i++) log.info(`regel ${i}`);
    expect(log.entries().map((e) => e.message)).toEqual(["regel 3", "regel 4", "regel 5"]);
    expect(log.entries()[0]).toMatchObject({ time: "2026-01-01T00:00:00.000Z", level: "info" });
  });

  it("maakt van meerdere regels één regel (geen valse logregels)", () => {
    const log = new Logbook();
    log.warn("a\nERROR nep\r\nb");
    expect(log.entries()[0]!.message).toBe("a ERROR nep b");
  });

  it("schrijft naar een bestand en roteert bij de maximale grootte", () => {
    const dir = mkdtempSync(join(tmpdir(), "logbook-"));
    const file = join(dir, "sub", "dafke-eid.log");
    const log = new Logbook({ file, maxFileBytes: 200 });
    for (let i = 0; i < 20; i++) log.info(`gebeurtenis ${i}`);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(readFileSync(file, "utf8")).toMatch(/INFO  gebeurtenis 19\n$/);
  });

  it("blijft werken als het bestand niet schrijfbaar is", () => {
    const log = new Logbook({ file: join("\0ongeldig", "x.log") });
    expect(() => log.error("fout")).not.toThrow();
    expect(log.entries()).toHaveLength(1);
  });
});
