/**
 * De Belgische root-certificaten (Belgium Root CA's) die de eID-ketens afsluiten.
 *
 * Deze lijst wordt gevuld met `node scripts/fetch-belgium-roots.mjs` (downloadt van
 * certs.eid.belgium.be en toont de SHA-256-vingerafdrukken; vergelijk die met
 * https://eid.belgium.be voor je ze commit). Zolang de lijst leeg is, moet je `trust.roots`
 * zelf meegeven.
 */
import { BELGIUM_ROOT_CAS_PEM } from "./belgium-roots.generated";

export const BELGIUM_ROOT_CAS: readonly string[] = BELGIUM_ROOT_CAS_PEM;
