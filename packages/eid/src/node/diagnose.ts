/**
 * `dafke-eid diag`: toont de ruwe PC/SC-toestand, om problemen met een lezer te vinden.
 * Toont geen persoonsgegevens (alleen ATR, statusbits en statuswoorden).
 */
import { formatSw, getCardDataCommand, parseResponse, selectFileCommand, toHex, EID_FILES } from "../core";
import type { PcscBackend } from "./pcsc/backend";
import { SCARD_STATE } from "./pcsc/constants";

export function describeState(state: number): string {
  const flags = Object.entries(SCARD_STATE)
    .filter(([name, bit]) => bit !== 0 && (state & bit) !== 0 && name !== "UNAWARE")
    .map(([name]) => name);
  const counter = state >>> 16;
  return `0x${(state >>> 0).toString(16).padStart(8, "0")} [${flags.join(" ") || "UNAWARE"}]${counter ? ` teller=${counter}` : ""}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function diagnose(backend: PcscBackend): Promise<string> {
  let out = `Platform: ${process.platform} ${process.arch}, Node ${process.version}\n`;
  let readers: string[];
  try {
    readers = await backend.listReaders();
  } catch (error) {
    return `${out}listReaders: FOUT ${message(error)}\n`;
  }
  out += `Lezers (${readers.length}): ${readers.map((r) => JSON.stringify(r)).join(", ") || "geen"}\n`;

  for (const reader of readers) {
    out += `\n== ${reader}\n`;
    for (const [label, timeout] of [["direct (0 ms)", 0], ["na wachten (500 ms)", 500]] as const) {
      try {
        const result = await backend.getStatusChange([{ reader, currentState: SCARD_STATE.UNAWARE }], timeout);
        if (!result) out += `getStatusChange ${label}: time-out (null)\n`;
        else {
          const r = result[0]!;
          out += `getStatusChange ${label}: ${describeState(r.eventState)} atr=${toHex(r.atr) || "-"}\n`;
        }
      } catch (error) {
        out += `getStatusChange ${label}: FOUT ${message(error)}\n`;
      }
    }

    try {
      const card = await backend.connect(reader);
      out += `connect: ok, protocol T${card.protocol === 2 ? 1 : 0} (${card.protocol})\n`;
      try {
        const cardData = parseResponse(await card.transmit(getCardDataCommand()));
        out += `GET CARD DATA: SW ${formatSw(cardData.sw)}, ${cardData.data.length} bytes\n`;
        const select = parseResponse(await card.transmit(selectFileCommand(EID_FILES.identity)));
        out += `SELECT identiteit: SW ${formatSw(select.sw)}\n`;
      } catch (error) {
        out += `transmit: FOUT ${message(error)}\n`;
      } finally {
        await card.disconnect().catch(() => {});
      }
    } catch (error) {
      out += `connect: FOUT ${message(error)}\n`;
    }
  }
  return out;
}
