/**
 * Diagnose via de EidReader (zoals de bridge die gebruikt). Geen persoonsgegevens:
 * alleen versies, lezers, ATR en statuswoorden.
 */
import { formatSw, getCardDataCommand, parseCardData, parseResponse, selectFileCommand, EID_FILES, PROTOCOL_VERSION } from "../core";
import { VERSION } from "../version";
import type { EidReader } from "./reader";

export interface DiagnoseInfo {
  url?: string;
  origins?: readonly string[];
  tokenRequired?: boolean;
  testpage?: boolean;
  logFile?: string;
}

export async function diagnoseReader(reader: EidReader, info: DiagnoseInfo = {}): Promise<string> {
  const lines: string[] = [
    "DafkeDD eID — diagnose",
    `Versie: ${VERSION} (protocol ${PROTOCOL_VERSION})`,
    `Platform: ${process.platform} ${process.arch}, Node ${process.version}`,
    `Tijd: ${new Date().toISOString()}`,
  ];
  if (info.url) lines.push(`Adres: ${info.url}`);
  if (info.origins) lines.push(`Toegelaten websites: ${info.origins.join(", ") || "(geen)"}`);
  if (info.tokenRequired !== undefined) lines.push(`Token vereist: ${info.tokenRequired ? "ja" : "nee"}`);
  if (info.testpage !== undefined) lines.push(`Testpagina: ${info.testpage ? "aan" : "uit"}`);
  if (info.logFile) lines.push(`Logbestand: ${info.logFile}`);

  const readers = reader.readers();
  lines.push("", `Kaartlezers (${readers.length}):`);
  if (readers.length === 0) lines.push("  (geen)");
  for (const r of readers) {
    lines.push(`- "${r.name}": ${r.cardPresent ? `kaart aanwezig, ATR ${r.atr ?? "?"}` : "geen kaart"}`);
    if (!r.cardPresent) continue;
    try {
      await reader.withCard(r.name, async (card) => {
        const data = parseResponse(await card.transmit(getCardDataCommand()));
        const applet = data.sw === 0x9000 && data.data.length >= 22 ? `, applet ${parseCardData(data.data).appletVersion}` : "";
        lines.push(`    protocol T${card.protocol === 2 ? 1 : 0}`);
        lines.push(`    GET CARD DATA: SW ${formatSw(data.sw)}${applet}`);
        const select = parseResponse(await card.transmit(selectFileCommand(EID_FILES.identity)));
        lines.push(`    SELECT identiteit: SW ${formatSw(select.sw)}${select.sw === 0x9000 ? " (Belgische eID)" : ""}`);
      });
    } catch (error) {
      lines.push(`    FOUT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return lines.join("\n") + "\n";
}
