/**
 * Aanmelden met de eID: PIN controleren en een uitdaging ondertekenen met de authenticatiesleutel.
 * Het resultaat is een token in het Web eID-formaat ("web-eid:1.0"), zodat ook bestaande
 * servercode het kan controleren:
 *
 *   ondertekende waarde = hash(origin) ‖ hash(nonce)   (UTF-8, zelfde hash als het algoritme)
 *   handtekening        = algoritme(hash(ondertekende waarde)) met de authenticatiesleutel
 *
 * Applet 1.8: ECDSA P-384 → ES384 (r ‖ s). Applet 1.7: RSA 2048 → RS256 (PKCS#1 v1.5).
 *
 * Kaartcommando's (publieke Belpic-handleidingen 1.7/1.8):
 *   VERIFY (status)  00 20 00 01                 9000 = al geverifieerd, 63Cx = nog x pogingen, 6983 = geblokkeerd
 *   VERIFY           00 20 00 01 08 <PIN-blok>   PIN-blok: 2 | lengte | cijfers | F-opvulling (8 bytes)
 *   MSE: SET         00 22 41 B6 05 04 80 <alg> 84 <sleutel>
 *   PSO: CDS         00 2A 9E 9A <len> <hash> 00
 *
 * Belangrijk: de PIN wordt gevraagd TUSSEN kaartstappen, nooit binnen één stap. Windows reset een
 * kaart waarvan de transactie 5 seconden stilligt.
 */
import { concatBytes, digest, toBase64, utf8Encode, type DigestAlgorithm } from "./bytes";
import { formatSw, getCardDataCommand, SW, sw1, sw2 } from "./apdu";
import { certificatePublicKey, trimDer, type PublicKeyInfo } from "./der";
import { EidError } from "./errors";
import { EID_FILES } from "./files";
import { readFile } from "./filesystem";
import { parseCardData } from "./parsers/card-data";
import { sendApdu, type CardTransport } from "./transport";

export const WEB_EID_TOKEN_FORMAT = "web-eid:1.0";
export const DEFAULT_APP_VERSION = "https://github.com/DafkeDD/DafkeDD_EID";

/** Web eID weigert kortere nonces (base64 van 256 bits). */
export const MIN_NONCE_LENGTH = 44;
export const MAX_NONCE_LENGTH = 256;
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 12;

export type AuthAlgorithm = "ES256" | "ES384" | "ES512" | "RS256";

/** Token zoals de server het ontvangt (Web eID-formaat). */
export interface EidAuthToken {
  /** Base64-DER van het authenticatiecertificaat — nog NIET gecontroleerd. */
  unverifiedCertificate: string;
  algorithm: AuthAlgorithm;
  /** Base64: r ‖ s voor ES*, PKCS#1 v1.5 voor RS256. */
  signature: string;
  format: typeof WEB_EID_TOKEN_FORMAT;
  appVersion: string;
}

export const KEY_REFERENCE = { authentication: 0x82, nonRepudiation: 0x83 } as const;
export const ALGORITHM_REFERENCE = {
  /** Applet 1.7: RSASSA-PKCS1-v1.5 met SHA-256 (kaart voegt DigestInfo en opvulling toe). */
  rsaPkcs1Sha256: 0x08,
  /** Applet 1.8: ECDSA met SHA-256 / SHA-384 / SHA-512. */
  ecdsaSha256: 0x01,
  ecdsaSha384: 0x02,
  ecdsaSha512: 0x04,
} as const;
const PIN_REFERENCE = 0x01;

/** Oudste applet waarmee aanmelden kan. Applet 1.1 telt een lege VERIFY als foute PIN (en is verlopen). */
export const MIN_AUTH_APPLET = 0x17;

// --- PIN ---

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

/** PIN → blok van 8 bytes: 2 | lengte | cijfers | F-opvulling (bv. 1234 → 24 12 34 FF FF FF FF FF). */
export function encodePinBlock(pin: string): Uint8Array {
  if (!isValidPin(pin)) throw new EidError("bad-request", `Een PIN heeft ${PIN_MIN_LENGTH} tot ${PIN_MAX_LENGTH} cijfers`);
  const nibbles = [0x2, pin.length, ...Array.from(pin, Number)];
  while (nibbles.length < 16) nibbles.push(0xf);
  const block = new Uint8Array(8);
  for (let i = 0; i < 8; i++) block[i] = (nibbles[2 * i]! << 4) | nibbles[2 * i + 1]!;
  return block;
}

export interface PinStatus {
  /** PIN al geverifieerd in deze kaartsessie. */
  verified: boolean;
  blocked: boolean;
  /** Resterende pogingen, als de kaart ze meldt. */
  triesLeft: number | null;
}

function pinError(sw: number): EidError | undefined {
  if (sw === SW.PIN_BLOCKED) return new EidError("pin-blocked", "De PIN is geblokkeerd", { triesLeft: 0 });
  if (sw1(sw) === 0x63 && (sw2(sw) & 0xf0) === 0xc0) {
    const triesLeft = sw2(sw) & 0x0f;
    if (triesLeft === 0) return new EidError("pin-blocked", "De PIN is geblokkeerd", { triesLeft: 0 });
    return new EidError("pin-incorrect", `Verkeerde PIN, nog ${triesLeft} poging(en)`, { triesLeft });
  }
  return undefined;
}

/** PIN-status zonder PIN te sturen (kost geen poging vanaf applet 1.7). */
export async function getPinStatus(transport: CardTransport): Promise<PinStatus> {
  const { sw } = await sendApdu(transport, Uint8Array.of(0x00, 0x20, 0x00, PIN_REFERENCE));
  if (sw === SW.OK) return { verified: true, blocked: false, triesLeft: null };
  const error = pinError(sw);
  if (error?.code === "pin-blocked") return { verified: false, blocked: true, triesLeft: 0 };
  if (error) return { verified: false, blocked: false, triesLeft: error.triesLeft ?? null };
  throw new EidError("read-failed", `PIN-status opvragen mislukt (SW ${formatSw(sw)})`);
}

/** Stuurt de PIN. Gooit `pin-incorrect` (met triesLeft) of `pin-blocked`. */
export async function verifyPin(transport: CardTransport, pin: string): Promise<void> {
  const block = encodePinBlock(pin);
  const command = Uint8Array.of(0x00, 0x20, 0x00, PIN_REFERENCE, block.length, ...block);
  block.fill(0);
  let sw: number;
  try {
    ({ sw } = await sendApdu(transport, command));
  } finally {
    command.fill(0);
  }
  if (sw === SW.OK) return;
  throw pinError(sw) ?? new EidError("read-failed", `PIN controleren mislukt (SW ${formatSw(sw)})`);
}

// --- ondertekenen ---

export interface SigningScheme {
  algorithm: AuthAlgorithm;
  hash: DigestAlgorithm;
  algorithmReference: number;
}

export function signingSchemeFor(key: PublicKeyInfo): SigningScheme {
  if (key.type === "rsa") return { algorithm: "RS256", hash: "SHA-256", algorithmReference: ALGORITHM_REFERENCE.rsaPkcs1Sha256 };
  switch (key.curve) {
    case "P-256":
      return { algorithm: "ES256", hash: "SHA-256", algorithmReference: ALGORITHM_REFERENCE.ecdsaSha256 };
    case "P-384":
      return { algorithm: "ES384", hash: "SHA-384", algorithmReference: ALGORITHM_REFERENCE.ecdsaSha384 };
    case "P-521":
      return { algorithm: "ES512", hash: "SHA-512", algorithmReference: ALGORITHM_REFERENCE.ecdsaSha512 };
    default:
      throw new EidError("unsupported-card", "Onbekende elliptische curve in het authenticatiecertificaat");
  }
}

/** Kiest sleutel en algoritme (MSE: SET) en ondertekent de hash (PSO: CDS). PIN moet geverifieerd zijn. */
export async function computeSignature(
  transport: CardTransport,
  request: { keyReference: number; algorithmReference: number; hash: Uint8Array },
): Promise<Uint8Array> {
  const mse = await sendApdu(transport, Uint8Array.of(0x00, 0x22, 0x41, 0xb6, 0x05, 0x04, 0x80, request.algorithmReference, 0x84, request.keyReference));
  if (mse.sw !== SW.OK) throw new EidError("read-failed", `Sleutel kiezen mislukt (SW ${formatSw(mse.sw)})`);
  const pso = await sendApdu(transport, Uint8Array.of(0x00, 0x2a, 0x9e, 0x9a, request.hash.length, ...request.hash, 0x00));
  if (pso.sw === SW.OK && pso.data.length > 0) return pso.data;
  if (pso.sw === SW.SECURITY_NOT_SATISFIED) throw new EidError("pin-incorrect", "De kaart vraagt eerst de PIN");
  throw new EidError("read-failed", `Ondertekenen mislukt (SW ${formatSw(pso.sw)})`);
}

/** hash(origin) ‖ hash(nonce): wat ondertekend wordt. */
export async function authSignedValue(origin: string, nonce: string, hash: DigestAlgorithm): Promise<Uint8Array> {
  const [a, b] = await Promise.all([digest(hash, utf8Encode(origin)), digest(hash, utf8Encode(nonce))]);
  return concatBytes(a, b);
}

export function checkNonce(nonce: unknown): asserts nonce is string {
  if (typeof nonce !== "string" || nonce.length < MIN_NONCE_LENGTH || nonce.length > MAX_NONCE_LENGTH) {
    throw new EidError("bad-request", `De nonce moet ${MIN_NONCE_LENGTH} tot ${MAX_NONCE_LENGTH} tekens lang zijn`);
  }
}

/** Een origin zoals een browser hem stuurt: schema://host[:poort], zonder pad. */
export function checkAuthOrigin(origin: unknown): asserts origin is string {
  if (typeof origin !== "string" || !/^https?:\/\/[^/\s?#]+$/.test(origin)) throw new EidError("bad-request", "Ongeldige origin");
}

// --- aanmelden ---

export interface PinRequest {
  /** Resterende pogingen, als gekend. */
  triesLeft: number | null;
  /** Na een verkeerde PIN. */
  retry: boolean;
}

/** Geeft de PIN, of null als de gebruiker annuleert. */
export type PinProvider = (request: PinRequest) => Promise<string | null>;

/**
 * Voert één korte stap uit met exclusieve toegang tot de kaart (bij PC/SC: één transactie).
 * Tussen stappen kan de PIN gevraagd worden.
 */
export type CardRunner = <T>(step: (transport: CardTransport) => Promise<T>) => Promise<T>;

export interface AuthenticateOptions {
  /** Origin van de website die vraagt om aan te melden (komt van de browser, niet van de website zelf). */
  origin: string;
  /** Uitdaging van de server. */
  nonce: string;
  pin: PinProvider;
  appVersion?: string;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new EidError("aborted", "Aanmelden afgebroken", { cause: signal.reason });
}

/** Leest eerst de appletversie: de PIN-status vragen is pas veilig vanaf applet 1.7. */
async function pinStatusIfSafe(transport: CardTransport): Promise<PinStatus> {
  const { data, sw } = await sendApdu(transport, getCardDataCommand());
  if (sw !== SW.OK || data.length < 22) {
    // Onbekende applet: geen poging riskeren, gewoon geen resterende pogingen tonen.
    return { verified: false, blocked: false, triesLeft: null };
  }
  const applet = data[21]!;
  if (applet < MIN_AUTH_APPLET) {
    throw new EidError("unsupported-card", `Deze kaart (applet ${parseCardData(data).appletVersion}) is te oud om mee aan te melden; lezen kan wel`);
  }
  return getPinStatus(transport);
}

async function signChallenge(transport: CardTransport, options: AuthenticateOptions): Promise<EidAuthToken> {
  const certificate = trimDer(await readFile(transport, EID_FILES.authenticationCertificate));
  const scheme = signingSchemeFor(certificatePublicKey(certificate));
  const hash = await digest(scheme.hash, await authSignedValue(options.origin, options.nonce, scheme.hash));
  const signature = await computeSignature(transport, {
    keyReference: KEY_REFERENCE.authentication,
    algorithmReference: scheme.algorithmReference,
    hash,
  });
  return {
    unverifiedCertificate: toBase64(certificate),
    algorithm: scheme.algorithm,
    signature: toBase64(signature),
    format: WEB_EID_TOKEN_FORMAT,
    appVersion: options.appVersion ?? DEFAULT_APP_VERSION,
  };
}

/**
 * Volledige aanmelding: vraagt de PIN (opnieuw na een verkeerde PIN, tot geblokkeerd of
 * geannuleerd), controleert ze, en leest + ondertekent in één stap. De PIN wordt altijd gevraagd,
 * ook als de kaart nog geverifieerd is.
 */
export async function authenticate(run: CardRunner, options: AuthenticateOptions): Promise<EidAuthToken> {
  checkAuthOrigin(options.origin);
  checkNonce(options.nonce);
  throwIfAborted(options.signal);

  const status = await run((t) => pinStatusIfSafe(t));
  if (status.blocked) throw new EidError("pin-blocked", "De PIN is geblokkeerd", { triesLeft: 0 });
  let triesLeft = status.triesLeft;
  let retry = false;
  for (;;) {
    throwIfAborted(options.signal);
    const pin = await options.pin({ triesLeft, retry });
    if (pin === null) throw new EidError("pin-cancelled", "PIN-invoer geannuleerd");
    throwIfAborted(options.signal);
    const result = await run(async (transport): Promise<{ token: EidAuthToken } | { wrong: number | null }> => {
      try {
        await verifyPin(transport, pin);
      } catch (error) {
        if (EidError.is(error, "pin-incorrect")) return { wrong: error.triesLeft ?? null };
        throw error;
      }
      return { token: await signChallenge(transport, options) };
    });
    if ("token" in result) return result.token;
    triesLeft = result.wrong;
    retry = true;
  }
}

/** {@link authenticate} rechtstreeks op een transport (tests, virtuele kaart). */
export function authenticateWithCard(transport: CardTransport, options: AuthenticateOptions): Promise<EidAuthToken> {
  return authenticate((step) => step(transport), options);
}
