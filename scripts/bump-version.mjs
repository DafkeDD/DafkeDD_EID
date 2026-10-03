#!/usr/bin/env node
/**
 * Verhoogt de versie in alle package.json's van de monorepo tegelijk.
 *   node scripts/bump-version.mjs patch|minor|major|X.Y.Z
 * Daarna: committen op developer en mergen naar main → de release-workflow
 * maakt automatisch release vX.Y.Z.
 */
import { readFileSync, writeFileSync } from "node:fs";

const files = ["package.json", "packages/eid/package.json"];
const arg = process.argv[2];
const root = JSON.parse(readFileSync("package.json", "utf8"));
const [maj, min, pat] = root.version.split(".").map(Number);

let next;
if (arg === "patch") next = `${maj}.${min}.${pat + 1}`;
else if (arg === "minor") next = `${maj}.${min + 1}.0`;
else if (arg === "major") next = `${maj + 1}.0.0`;
else if (/^\d+\.\d+\.\d+$/.test(arg ?? "")) next = arg;
else {
  console.error("Gebruik: node scripts/bump-version.mjs patch|minor|major|X.Y.Z");
  process.exit(1);
}

for (const file of files) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.version = next;
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}

// package-lock.json gericht bijwerken, zonder `npm install` (andere npm-versies herschrijven anders alles).
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
lock.version = next;
for (const key of ["", "packages/eid"]) {
  if (lock.packages?.[key]) lock.packages[key].version = next;
}
writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
console.log(`Versie ${root.version} → ${next}`);
