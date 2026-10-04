import { toHex } from "../bytes";
import { EidError } from "../errors";
import { parseTlv } from "../tlv";
import type { EidIdentity, Gender } from "../types";
import { parseBirthDate, parseCardDate } from "./dates";
import { textField, tlvMap, unknownFields } from "./fields";

/** Tags van het identiteitsbestand (DF01 4031). Tag 0x00 = versie van de bestandsstructuur. */
export const IDENTITY_TAGS = {
  fileStructureVersion: 0x00,
  cardNumber: 0x01,
  chipNumber: 0x02,
  validFrom: 0x03,
  validUntil: 0x04,
  issuingMunicipality: 0x05,
  nationalNumber: 0x06,
  lastName: 0x07,
  firstNames: 0x08,
  thirdNameInitial: 0x09,
  nationality: 0x0a,
  placeOfBirth: 0x0b,
  dateOfBirth: 0x0c,
  gender: 0x0d,
  nobleCondition: 0x0e,
  documentType: 0x0f,
  specialStatus: 0x10,
  photoHash: 0x11,
  duplicate: 0x12,
  specialOrganisation: 0x13,
  memberOfFamily: 0x14,
  dateAndCountryOfProtection: 0x15,
} as const;

const KNOWN = new Set<number>(Object.values(IDENTITY_TAGS));

/** `M` = man; `F` (FR/EN), `V` (NL) en `W` (DE) = vrouw; al de rest = onbekend. */
export function parseGender(code: string): Gender {
  switch (code.trim().toUpperCase()) {
    case "M":
      return "male";
    case "F":
    case "V":
    case "W":
      return "female";
    default:
      return "unknown";
  }
}

export function parseIdentity(data: Uint8Array): EidIdentity {
  const records = parseTlv(data);
  const map = tlvMap(records);
  const T = IDENTITY_TAGS;
  const text = (tag: number) => textField(map, tag);

  const nationalNumber = text(T.nationalNumber).replace(/\D/g, "");
  if (!/^\d{11}$/.test(nationalNumber)) {
    throw new EidError("invalid-data", "Identiteitsbestand bevat geen geldig rijksregisternummer");
  }

  const dateOfBirthRaw = text(T.dateOfBirth);
  const genderCode = text(T.gender);

  return {
    cardNumber: text(T.cardNumber),
    chipNumber: toHex(map.get(T.chipNumber) ?? new Uint8Array()).toUpperCase(),
    validFrom: parseCardDate(text(T.validFrom)),
    validUntil: parseCardDate(text(T.validUntil)),
    issuingMunicipality: text(T.issuingMunicipality),
    nationalNumber,
    lastName: text(T.lastName),
    firstNames: text(T.firstNames),
    thirdNameInitial: text(T.thirdNameInitial),
    nationality: text(T.nationality),
    placeOfBirth: text(T.placeOfBirth),
    dateOfBirth: parseBirthDate(dateOfBirthRaw),
    dateOfBirthRaw,
    gender: parseGender(genderCode),
    genderCode,
    nobleCondition: text(T.nobleCondition),
    documentType: text(T.documentType),
    specialStatus: text(T.specialStatus),
    photoHash: toHex(map.get(T.photoHash) ?? new Uint8Array()),
    duplicate: text(T.duplicate),
    specialOrganisation: text(T.specialOrganisation),
    memberOfFamily: text(T.memberOfFamily),
    dateAndCountryOfProtection: text(T.dateAndCountryOfProtection),
    unknownFields: unknownFields(records, KNOWN),
  };
}
