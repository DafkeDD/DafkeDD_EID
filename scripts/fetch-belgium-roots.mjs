#!/usr/bin/env node
/**
 * Downloadt de Belgium Root CA-certificaten en schrijft ze naar
 * packages/eid/src/server/belgium-roots.generated.ts.
 *
 *   node scripts/fetch-belgium-roots.mjs
 *
 * CONTROLEER de getoonde SHA-256-vingerafdrukken met de officiële bron
 * (https://eid.belgium.be → certificaten / repository.eid.belgium.be) voor je commit:
 * deze certificaten bepalen wie je server vertrouwt.
 */
import { X509Certificate } from "node:crypto";
import { writeFileSync } from "node:fs";

const SOURCES = [
  "http://certs.eid.belgium.be/belgiumrs3.crt",
  "http://certs.eid.belgium.be/belgiumrs4.crt",
  "http://crt.eidpki.belgium.be/eid/brca6.crt",
];

/**
 * Nieuwere kaarten (Belgium Root CA6) staan onder crt.eidpki.belgium.be. Van een gekende Citizen CA
 * volgen we het CA Issuers-adres (AIA) naar zijn root. Extra Citizen CA-adressen kan je meegeven:
 *   node scripts/fetch-belgium-roots.mjs http://crt.eidpki.belgium.be/eid/eidcXXXXXX.crt
 * (het adres staat in het authenticatiecertificaat van een kaart, zie de diagnose van test:integration).
 */
const CITIZEN_CAS = ["http://crt.eidpki.belgium.be/eid/eidc202514.crt", ...process.argv.slice(2)];

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return new X509Certificate(bytes.includes("-----BEGIN") ? bytes.toString("utf8") : bytes);
}

for (const url of CITIZEN_CAS) {
  try {
    const ca = await download(url);
    const rootUrl = /CA Issuers - URI:(\S+)/.exec(ca.infoAccess ?? "")?.[1];
    if (rootUrl && !SOURCES.includes(rootUrl)) {
      console.log(`- ${url} (${ca.subject.split("\n").find((l) => l.startsWith("CN="))}) → root op ${rootUrl}`);
      SOURCES.push(rootUrl);
    }
  } catch (error) {
    console.log(`- ${url}: ${error instanceof Error ? error.message : error}`);
  }
}

const found = [];
for (const url of SOURCES) {
  try {
    const cert = await download(url);
    if (!cert.ca || !cert.checkIssued(cert) || !cert.verify(cert.publicKey)) {
      console.log(`- ${url}: geen zelfondertekende CA, overgeslagen`);
      continue;
    }
    const expired = new Date(cert.validTo) < new Date();
    console.log(`\n✔ ${url}`);
    console.log(`  subject     ${cert.subject.replace(/\n/g, ", ")}`);
    console.log(`  geldig      ${cert.validFrom} → ${cert.validTo}${expired ? "  (VERLOPEN, overgeslagen)" : ""}`);
    console.log(`  SHA-256     ${cert.fingerprint256}`);
    if (!expired && !found.some((c) => c.fingerprint256 === cert.fingerprint256)) found.push(cert);
  } catch (error) {
    console.log(`- ${url}: ${error instanceof Error ? error.message : error}`);
  }
}

if (found.length === 0) {
  console.error("\nGeen enkele root gevonden; niets geschreven.");
  process.exit(1);
}

writeFileSync(
  "packages/eid/src/server/belgium-roots.generated.ts",
  `// Gegenereerd door scripts/fetch-belgium-roots.mjs op ${new Date().toISOString().slice(0, 10)} — niet met de hand aanpassen.
// Vingerafdrukken (SHA-256), te controleren met de officiële bron:
${found.map((c) => `//   ${c.subject.split("\n").find((l) => l.startsWith("CN="))}: ${c.fingerprint256}`).join("\n")}
export const BELGIUM_ROOT_CAS_PEM: readonly string[] = [
${found.map((c) => `  ${JSON.stringify(c.toString())},`).join("\n")}
];
`,
);
console.log(`\n${found.length} root(s) geschreven naar packages/eid/src/server/belgium-roots.generated.ts. Controleer de vingerafdrukken en commit.`);
