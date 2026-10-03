import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { entries } from "../packages/eid/tsup.config";

const pkg = JSON.parse(readFileSync("packages/eid/package.json", "utf8"));
const root = JSON.parse(readFileSync("package.json", "utf8"));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("pakketstructuur", () => {
  it("heeft voor elk subpad in exports een tsup-entry en omgekeerd", () => {
    const fromExports = Object.keys(pkg.exports)
      .filter((key) => key !== "./package.json")
      .map((key) => (key === "." ? "index" : key.slice(2)))
      .sort();
    expect(Object.keys(entries).sort()).toEqual(fromExports);
  });

  it("verwijst in exports naar de juiste dist-bestanden", () => {
    for (const [key, value] of Object.entries<any>(pkg.exports)) {
      if (key === "./package.json") continue;
      const name = key === "." ? "index" : key.slice(2);
      expect(value.import).toEqual({ types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` });
      expect(value.require).toEqual({ types: `./dist/${name}.d.cts`, default: `./dist/${name}.cjs` });
    }
  });

  it("heeft een bronbestand voor elke entry", () => {
    for (const source of Object.values(entries)) expect(existsSync(join("packages/eid", source))).toBe(true);
  });

  it("houdt de versies van root en pakket gelijk", () => {
    expect(pkg.version).toBe(root.version);
  });

  it("gebruikt geen Node-API's in core, react en mock (die draaien ook in de browser)", () => {
    const browserSafe = ["core", "react", "mock"].flatMap((dir) => walk(join("packages/eid/src", dir)));
    for (const file of browserSafe) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["']node:/);
      expect(source, file).not.toMatch(/\bBuffer\b/);
      expect(source, file).not.toMatch(/\bprocess\./);
    }
  });

  it("importeert koffi alleen in /node", () => {
    for (const file of walk("packages/eid/src")) {
      if (file.includes(join("src", "node"))) continue;
      expect(readFileSync(file, "utf8"), file).not.toMatch(/["']koffi["']/);
    }
  });

  it("maakt React en NestJS optionele peer-dependencies", () => {
    expect(pkg.peerDependenciesMeta.react.optional).toBe(true);
    expect(pkg.peerDependenciesMeta["@nestjs/common"].optional).toBe(true);
    expect(pkg.dependencies?.react).toBeUndefined();
    expect(pkg.dependencies?.["@nestjs/common"]).toBeUndefined();
  });

  it("heeft README in het Engels en Nederlands met dezelfde hoofdstukken", () => {
    const headings = (file: string) => readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("## ")).length;
    expect(headings("README.md")).toBeGreaterThan(0);
    expect(headings("README.md")).toBe(headings("README.nl.md"));
  });
});
