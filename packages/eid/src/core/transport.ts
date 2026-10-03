/**
 * De enige manier waarop core met een kaart praat. De Node-kant (PC/SC), de virtuele kaart
 * en later eventueel andere transports implementeren deze interface.
 */
import { concatBytes } from "./bytes";
import { getResponseCommand, parseResponse, sw1, sw2, withLe, type ResponseApdu } from "./apdu";
import { EidError } from "./errors";

export interface CardTransport {
  /** Stuurt één command-APDU en geeft het ruwe antwoord (data + SW1 SW2) terug. */
  transmit(command: Uint8Array): Promise<Uint8Array>;
}

const MAX_GET_RESPONSE = 64;

/**
 * Stuurt een APDU en handelt de T=0-details af:
 * - `61xx`: haalt de rest op met GET RESPONSE (meerdere keren indien nodig);
 * - `6Cxx`: stuurt het commando één keer opnieuw met Le = xx.
 */
export async function sendApdu(transport: CardTransport, command: Uint8Array): Promise<ResponseApdu> {
  let response = parseResponse(await transport.transmit(command));

  if (sw1(response.sw) === 0x6c) {
    response = parseResponse(await transport.transmit(withLe(command, sw2(response.sw))));
  }

  const chunks: Uint8Array[] = [response.data];
  let rounds = 0;
  while (sw1(response.sw) === 0x61) {
    if (++rounds > MAX_GET_RESPONSE) throw new EidError("read-failed", "Te veel GET RESPONSE-rondes");
    response = parseResponse(await transport.transmit(getResponseCommand(sw2(response.sw))));
    chunks.push(response.data);
  }

  return chunks.length === 1 ? response : { data: concatBytes(...chunks), sw: response.sw };
}
