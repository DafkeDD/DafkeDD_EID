#!/usr/bin/env node
/**
 * Bouwt de Windows-setup (Inno Setup) rond het programma uit `npm run build:exe`.
 *
 *   npm run build:exe && npm run build:setup   → dist-bin/dafke-eid-setup-windows-x64.exe
 *
 * Alleen op Windows. Vereist Inno Setup 6.3 of nieuwer:
 *   winget install JRSoftware.InnoSetup   (of: choco install innosetup)
 * Een eigen pad naar ISCC.exe kan via de omgevingsvariabele ISCC.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(ROOT, "packages/eid/package.json"), "utf8")).version;
const source = join(ROOT, "dist-bin", "dafke-eid-windows-x64.exe");
const script = join(ROOT, "installer", "dafke-eid.iss");

if (process.platform !== "win32") {
  console.error("De setup kan alleen op Windows gebouwd worden (Inno Setup).");
  process.exit(1);
}
if (!existsSync(source)) {
  console.error(`${source} ontbreekt. Bouw eerst het programma: npm run build:exe`);
  process.exit(1);
}

function findIscc() {
  const candidates = [
    process.env.ISCC,
    join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Inno Setup 6", "ISCC.exe"),
    join(process.env.ProgramFiles ?? "C:\\Program Files", "Inno Setup 6", "ISCC.exe"),
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe"),
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (found) return found;
  try {
    return execFileSync("where", ["iscc"], { encoding: "utf8" }).split(/\r?\n/)[0].trim();
  } catch {
    return undefined;
  }
}

const iscc = findIscc();
if (!iscc) {
  console.error("Inno Setup (ISCC.exe) niet gevonden. Installeer het met: winget install JRSoftware.InnoSetup\nof geef het pad mee via de omgevingsvariabele ISCC.");
  process.exit(1);
}

console.log(`▸ Setup bouwen met ${iscc} (versie ${version})`);
execFileSync(iscc, [`/DAppVersion=${version}`, `/DSourceExe=${source}`, `/DOutputDir=${join(ROOT, "dist-bin")}`, "/Q", script], { stdio: "inherit" });
console.log(`✓ ${join(ROOT, "dist-bin", "dafke-eid-setup-windows-x64.exe")}`);
