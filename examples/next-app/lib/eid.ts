import { EidAuthenticator } from "@dafkedd/eid/server";
import { TEST_ROOT_CA, TEST_CITIZEN_CA } from "@dafkedd/eid/mock";

// Alleen samen met `npx dafke-eid --mock` (virtuele kaart, test-PKI). NOOIT in productie.
const testCard = process.env.EID_TEST_CARD === "1";

function create() {
  return new EidAuthenticator({
    // Je eigen adres, precies zoals in de adresbalk (moet ook in --auth-origin van het programma).
    origin: process.env.APP_ORIGIN ?? "http://localhost:3000",
    ...(testCard ? { trust: { roots: [TEST_ROOT_CA], intermediates: [TEST_CITIZEN_CA] }, revocation: false as const } : {}),
  });
}

// Eén instantie per proces: de nonces zitten in het geheugen. Via globalThis overleeft ze ook
// het herladen tijdens `next dev`. Meerdere servers? Gebruik een gedeelde NonceStore (docs/server.md).
const shared = globalThis as typeof globalThis & { __dafkeEid?: EidAuthenticator };
export const eid = (shared.__dafkeEid ??= create());
