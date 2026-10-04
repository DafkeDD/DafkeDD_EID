/**
 * Een eID volledig uitlezen via een {@link CardTransport}.
 * De aanroeper (bv. /node) zorgt voor exclusieve toegang (PC/SC-transactie) rond deze calls.
 */
import { digest, equalBytes, fromHex, type DigestAlgorithm } from "./bytes";
import { getCardDataCommand, SW } from "./apdu";
import { EidError } from "./errors";
import { EID_FILES } from "./files";
import { FileNotFoundError, readFile, selectFile } from "./filesystem";
import { parseAddress } from "./parsers/address";
import { parseCardData } from "./parsers/card-data";
import { parseIdentity } from "./parsers/identity";
import { sendApdu, type CardTransport } from "./transport";
import type { EidCardData, EidCardInfo, EidCertificates, EidPhoto, EidReadOptions } from "./types";

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new EidError("aborted", "Uitlezen afgebroken", { cause: signal.reason });
}

/**
 * Is dit een Belgische eID? We selecteren het identiteitsbestand in plaats van de ATR te
 * vergelijken: dat werkt voor alle kaartversies zonder lijst van ATR-patronen.
 */
export async function isEid(transport: CardTransport): Promise<boolean> {
  try {
    await selectFile(transport, EID_FILES.identity);
    return true;
  } catch (error) {
    if (EidError.is(error, "read-failed")) return false;
    throw error;
  }
}

/** Chip-serienummer en appletversie, of `undefined` als de kaart GET CARD DATA niet kent. */
export async function readCardInfo(transport: CardTransport): Promise<EidCardInfo | undefined> {
  const { data, sw } = await sendApdu(transport, getCardDataCommand());
  return sw === SW.OK ? parseCardData(data) : undefined;
}

const HASH_BY_LENGTH: Record<number, DigestAlgorithm> = { 20: "SHA-1", 32: "SHA-256", 48: "SHA-384" };

/** Klopt de foto met de hash uit het identiteitsbestand? */
export async function verifyPhoto(photo: Uint8Array, photoHashHex: string): Promise<boolean> {
  const expected = fromHex(photoHashHex);
  const algorithm = HASH_BY_LENGTH[expected.length];
  if (!algorithm) return false;
  return equalBytes(await digest(algorithm, photo), expected);
}

async function readOptionalFile(transport: CardTransport, path: Uint8Array): Promise<Uint8Array | undefined> {
  try {
    const data = await readFile(transport, path);
    return data.length === 0 || data.every((b) => b === 0) ? undefined : data;
  } catch (error) {
    if (error instanceof FileNotFoundError) return undefined;
    throw error;
  }
}

async function readCertificates(transport: CardTransport, signal?: AbortSignal): Promise<EidCertificates> {
  // Authenticatie- en handtekeningcertificaat ontbreken bij jonge kinderen of na intrekking.
  const authentication = await readOptionalFile(transport, EID_FILES.authenticationCertificate);
  throwIfAborted(signal);
  const signing = await readOptionalFile(transport, EID_FILES.signingCertificate);
  throwIfAborted(signal);
  const ca = await readFile(transport, EID_FILES.caCertificate);
  throwIfAborted(signal);
  const root = await readFile(transport, EID_FILES.rootCertificate);
  throwIfAborted(signal);
  const rrn = await readFile(transport, EID_FILES.rrnCertificate);
  return {
    ...(authentication ? { authentication } : {}),
    ...(signing ? { signing } : {}),
    ca,
    root,
    rrn,
  };
}

/**
 * Leest identiteit, adres, (optioneel) foto, kaartinfo en (optioneel) certificaten.
 * Geen PIN nodig.
 *
 * @throws EidError `not-eid` als de kaart geen eID is, `invalid-data` als gegevens niet kloppen
 *   (bv. foto-hash), `read-failed` bij leesfouten, `aborted` via `options.signal`.
 */
export async function readEid(transport: CardTransport, options: EidReadOptions = {}): Promise<EidCardData> {
  const { photo: wantPhoto = true, verifyPhotoHash = true, certificates: wantCertificates = false, signal } = options;
  throwIfAborted(signal);

  if (!(await isEid(transport))) throw new EidError("not-eid", "Deze kaart is geen Belgische eID");
  throwIfAborted(signal);

  const cardInfo = await readCardInfo(transport);
  throwIfAborted(signal);

  const identity = parseIdentity(await readFile(transport, EID_FILES.identity));
  throwIfAborted(signal);

  const address = parseAddress(await readFile(transport, EID_FILES.address));
  throwIfAborted(signal);

  let photo: EidPhoto | undefined;
  if (wantPhoto) {
    const data = await readFile(transport, EID_FILES.photo);
    throwIfAborted(signal);
    if (verifyPhotoHash && !(await verifyPhoto(data, identity.photoHash))) {
      throw new EidError("invalid-data", "De foto komt niet overeen met de hash in het identiteitsbestand");
    }
    photo = { mimeType: "image/jpeg", data };
  }

  const certificates = wantCertificates ? await readCertificates(transport, signal) : undefined;

  return {
    identity,
    address,
    ...(photo ? { photo } : {}),
    ...(cardInfo ? { cardInfo } : {}),
    ...(certificates ? { certificates } : {}),
  };
}
