/**
 * Fictieve voorbeeldkaart ("Specimen"), opgebouwd zoals een echte eID.
 * Geen echte persoon; het rijksregisternummer heeft wel een geldig controlegetal.
 */
import {
  ADDRESS_TAGS,
  ALGORITHM_REFERENCE,
  digest,
  fromBase64,
  encodeTlv,
  fromHex,
  IDENTITY_TAGS,
  utf8Encode,
  type DigestAlgorithm,
  type TlvRecord,
} from "../core";
import { SAMPLE_PHOTO_HEX } from "./sample-photo";
import { ecdsaP384SignHash, rsaPkcs1Sha256SignHash } from "./soft-crypto";
import {
  TEST_AUTH_CERT_EC,
  TEST_AUTH_CERT_RSA,
  TEST_AUTH_KEY_EC_D,
  TEST_AUTH_KEY_RSA_D,
  TEST_AUTH_KEY_RSA_N,
  TEST_CITIZEN_CA,
  TEST_ROOT_CA,
} from "./test-pki";
import { VirtualCard, type VirtualCardOptions } from "./virtual-card";

export interface SampleIdentityFields {
  cardNumber: string;
  chipNumber: string;
  validFrom: string;
  validUntil: string;
  issuingMunicipality: string;
  nationalNumber: string;
  lastName: string;
  firstNames: string;
  thirdNameInitial: string;
  nationality: string;
  placeOfBirth: string;
  dateOfBirth: string;
  gender: string;
  nobleCondition: string;
  documentType: string;
  specialStatus: string;
}

export interface SampleAddressFields {
  streetAndNumber: string;
  zipCode: string;
  municipality: string;
}

export const SAMPLE_IDENTITY: Readonly<SampleIdentityFields> = {
  cardNumber: "592000000097",
  chipNumber: "534C494E33660013931D2C2E43D53A00",
  validFrom: "01.06.2024",
  validUntil: "01.06.2034",
  issuingMunicipality: "Gent",
  nationalNumber: "85031512369",
  lastName: "Specimen",
  firstNames: "Jan Pieter",
  thirdNameInitial: "K",
  nationality: "Belg",
  placeOfBirth: "Gent",
  dateOfBirth: "15 MAAR 1985",
  gender: "M",
  nobleCondition: "",
  documentType: "1",
  specialStatus: "0",
};

export const SAMPLE_ADDRESS: Readonly<SampleAddressFields> = {
  streetAndNumber: "Voorbeeldstraat 12 bus 3",
  zipCode: "9000",
  municipality: "Gent",
};

export const SAMPLE_PHOTO: Uint8Array = fromHex(SAMPLE_PHOTO_HEX);

export interface SampleCardOptions extends VirtualCardOptions {
  /** `1.8` (standaard, foto-hash SHA-384) of `1.7` (SHA-1). */
  appletVersion?: "1.7" | "1.8";
  identity?: Partial<SampleIdentityFields>;
  address?: Partial<SampleAddressFields>;
  photo?: Uint8Array;
  /** Extra TLV-velden in het identiteitsbestand (bv. een tag die we nog niet kennen). */
  extraIdentityFields?: TlvRecord[];
  /** Overschrijft de foto-hash (om een vervalste foto te testen). */
  photoHash?: Uint8Array;
  /**
   * Certificaten (DER) om op de kaart te zetten. Niet opgegeven: de test-PKI
   * (authenticatiecertificaat EC P-384 bij applet 1.8, RSA 2048 bij 1.7).
   */
  certificates?: Partial<Record<"authentication" | "signing" | "ca" | "root" | "rrn", Uint8Array>>;
  /** PIN van de virtuele kaart. Standaard "1234". `false` = geen aanmelden. */
  pin?: string | false;
  /** Resterende PIN-pogingen bij de start. Standaard 3. */
  pinTries?: number;
}

/** PIN van de voorbeeldkaart. */
export const SAMPLE_PIN = "1234";

/** Ondertekent zoals een echte kaart met de test-sleutel die bij de appletversie hoort. */
export function sampleSigner(appletVersion: "1.7" | "1.8" = "1.8") {
  return (hash: Uint8Array, algorithmReference: number): Uint8Array => {
    if (appletVersion === "1.8") {
      if (algorithmReference !== ALGORITHM_REFERENCE.ecdsaSha384) throw new Error("Virtuele kaart 1.8: alleen ECDSA met SHA-384");
      return ecdsaP384SignHash(hash, TEST_AUTH_KEY_EC_D);
    }
    if (algorithmReference !== ALGORITHM_REFERENCE.rsaPkcs1Sha256) throw new Error("Virtuele kaart 1.7: alleen RSA PKCS#1 met SHA-256");
    return rsaPkcs1Sha256SignHash(hash, TEST_AUTH_KEY_RSA_N, TEST_AUTH_KEY_RSA_D);
  };
}

const text = (tag: number, value: string): TlvRecord => ({ tag, value: utf8Encode(value) });

/** GET CARD DATA-antwoord van 28 bytes; byte 21 = appletversie. */
export function sampleCardData(appletVersion: "1.7" | "1.8" = "1.8"): Uint8Array {
  const data = new Uint8Array(28);
  data.set(fromHex("534C494E33660013931D2C2E43D53A00"), 0);
  data[21] = appletVersion === "1.8" ? 0x18 : 0x17;
  return data;
}

/** Maakt de ruwe bestanden van een voorbeeldkaart. */
export async function createSampleFiles(options: SampleCardOptions = {}) {
  const id = { ...SAMPLE_IDENTITY, ...options.identity };
  const addr = { ...SAMPLE_ADDRESS, ...options.address };
  const photo = options.photo ?? SAMPLE_PHOTO;
  const hashAlgorithm: DigestAlgorithm = (options.appletVersion ?? "1.8") === "1.8" ? "SHA-384" : "SHA-1";
  const photoHash = options.photoHash ?? (await digest(hashAlgorithm, photo));
  const T = IDENTITY_TAGS;

  const identity = encodeTlv([
    { tag: T.fileStructureVersion, value: Uint8Array.of(0x00, 0x03) },
    text(T.cardNumber, id.cardNumber),
    { tag: T.chipNumber, value: fromHex(id.chipNumber) },
    text(T.validFrom, id.validFrom),
    text(T.validUntil, id.validUntil),
    text(T.issuingMunicipality, id.issuingMunicipality),
    text(T.nationalNumber, id.nationalNumber),
    text(T.lastName, id.lastName),
    text(T.firstNames, id.firstNames),
    text(T.thirdNameInitial, id.thirdNameInitial),
    text(T.nationality, id.nationality),
    text(T.placeOfBirth, id.placeOfBirth),
    text(T.dateOfBirth, id.dateOfBirth),
    text(T.gender, id.gender),
    text(T.nobleCondition, id.nobleCondition),
    text(T.documentType, id.documentType),
    text(T.specialStatus, id.specialStatus),
    { tag: T.photoHash, value: photoHash },
    ...(options.extraIdentityFields ?? []),
  ]);

  const address = encodeTlv([
    { tag: ADDRESS_TAGS.fileStructureVersion, value: Uint8Array.of(0x00, 0x02) },
    text(ADDRESS_TAGS.streetAndNumber, addr.streetAndNumber),
    text(ADDRESS_TAGS.zipCode, addr.zipCode),
    text(ADDRESS_TAGS.municipality, addr.municipality),
  ]);

  // Echte bestanden worden opgevuld met nullen tot een vaste grootte.
  const pad = (data: Uint8Array, size: number) => {
    const out = new Uint8Array(Math.max(size, data.length));
    out.set(data);
    return out;
  };

  const padded = (der: Uint8Array) => {
    // Echte certificaatbestanden zijn opgevuld met nullen.
    const out = new Uint8Array(der.length + 64);
    out.set(der);
    return out;
  };
  const certs = options.certificates ?? {
    authentication: padded(fromBase64((options.appletVersion ?? "1.8") === "1.8" ? TEST_AUTH_CERT_EC : TEST_AUTH_CERT_RSA)),
    ca: fromBase64(TEST_CITIZEN_CA),
    root: fromBase64(TEST_ROOT_CA),
    rrn: fromBase64(TEST_CITIZEN_CA),
  };
  return {
    identity: pad(identity, 0xd0),
    identitySignature: new Uint8Array(96),
    address: pad(address, 0x75),
    addressSignature: new Uint8Array(96),
    photo,
    ...(certs.authentication ? { authenticationCertificate: certs.authentication } : {}),
    ...(certs.signing ? { signingCertificate: certs.signing } : {}),
    ...(certs.ca ? { caCertificate: certs.ca } : {}),
    ...(certs.root ? { rootCertificate: certs.root } : {}),
    ...(certs.rrn ? { rrnCertificate: certs.rrn } : {}),
  };
}

/** Virtuele eID met de voorbeeldgegevens (of je eigen aanpassingen). */
export async function createSampleCard(options: SampleCardOptions = {}): Promise<VirtualCard> {
  const files = await createSampleFiles(options);
  const cardData = options.cardData === undefined ? sampleCardData(options.appletVersion) : options.cardData;
  const pin = options.pin === undefined ? SAMPLE_PIN : options.pin;
  return new VirtualCard(files, {
    ...options,
    cardData,
    ...(pin === false
      ? {}
      : { auth: { pin, ...(options.pinTries !== undefined ? { triesLeft: options.pinTries } : {}), sign: sampleSigner(options.appletVersion) } }),
  });
}
