/**
 * Datamodel van een uitgelezen eID. Alles is gewone data (geen klassen), zodat het later
 * over het bridge-protocol kan (Uint8Array wordt daar base64).
 */

/** Datum waarvan dag of maand soms niet gekend is (komt voor bij geboortedata). */
export interface PartialDate {
  year: number;
  /** 1–12, ontbreekt als de maand niet gekend is. */
  month?: number;
  /** 1–31, ontbreekt als de dag niet gekend is. */
  day?: number;
}

/** Nooit gokken: wat niet herkend wordt, is `"unknown"`. */
export type Gender = "male" | "female" | "unknown";

export interface EidIdentity {
  /** Kaartnummer, 12 cijfers. */
  cardNumber: string;
  /** Chipnummer (hex, hoofdletters). */
  chipNumber: string;
  /** Geldig vanaf, ISO `YYYY-MM-DD`. */
  validFrom: string;
  /** Geldig tot, ISO `YYYY-MM-DD`. */
  validUntil: string;
  issuingMunicipality: string;
  /** Rijksregisternummer, 11 cijfers zonder scheidingstekens. */
  nationalNumber: string;
  lastName: string;
  /** Eerste (twee) voornamen, zoals op de kaart. */
  firstNames: string;
  /** Initiaal van de derde voornaam (kan leeg zijn). */
  thirdNameInitial: string;
  nationality: string;
  placeOfBirth: string;
  /** Geboortedatum; `null` als de kaart iets onleesbaars bevat (zie `dateOfBirthRaw`). */
  dateOfBirth: PartialDate | null;
  /** Geboortedatum exact zoals op de kaart, bv. `15 MAAR 1985`. */
  dateOfBirthRaw: string;
  gender: Gender;
  /** Code zoals op de kaart (`M`, `F`, `V`, `W`, …). */
  genderCode: string;
  nobleCondition: string;
  documentType: string;
  specialStatus: string;
  /** Hash van de foto (hex). SHA-1 (20 bytes) of SHA-384 (48 bytes) afhankelijk van de kaart. */
  photoHash: string;
  duplicate: string;
  specialOrganisation: string;
  memberOfFamily: string;
  dateAndCountryOfProtection: string;
  /** Tags die we (nog) niet kennen, als hex. Sleutel = tag in hex (bv. `"16"`). */
  unknownFields: Record<string, string>;
}

export interface EidAddress {
  /** Straat en nummer zoals op de kaart. */
  streetAndNumber: string;
  /** Best-effort opgesplitst; bij twijfel staat alles in `street`. */
  street: string;
  houseNumber: string;
  box: string;
  zipCode: string;
  municipality: string;
  unknownFields: Record<string, string>;
}

export interface EidPhoto {
  mimeType: "image/jpeg";
  data: Uint8Array;
}

export interface EidCardInfo {
  /** Chip-serienummer (hex, hoofdletters). */
  serialNumber: string;
  /** Appletversie, bv. `"1.7"` of `"1.8"`. */
  appletVersion: string;
}

/** Certificaten in DER. Alleen gelezen als daarom gevraagd wordt. */
export interface EidCertificates {
  authentication?: Uint8Array;
  signing?: Uint8Array;
  ca: Uint8Array;
  root: Uint8Array;
  rrn: Uint8Array;
}

export interface EidCardData {
  identity: EidIdentity;
  address: EidAddress;
  /** Ontbreekt als `photo: false` gevraagd werd. */
  photo?: EidPhoto;
  /** Ontbreekt als de kaart GET CARD DATA niet ondersteunt. */
  cardInfo?: EidCardInfo;
  /** Alleen bij `certificates: true`. */
  certificates?: EidCertificates;
}

export interface EidReadOptions {
  /** Foto lezen (±3 KB, de traagste stap). Standaard `true`. */
  photo?: boolean;
  /** Controleren of de foto overeenkomt met de hash in het identiteitsbestand. Standaard `true`. */
  verifyPhotoHash?: boolean;
  /** Certificaten lezen. Standaard `false`. */
  certificates?: boolean;
  /** Afbreken, bv. als de kaart eruit gaat of de gebruiker weggaat. */
  signal?: AbortSignal;
}
