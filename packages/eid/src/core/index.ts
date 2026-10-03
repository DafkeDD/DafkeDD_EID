/**
 * @dafkedd/eid — de kaart begrijpen.
 * Weet niets van PC/SC, HTTP of React en draait in Node én in de browser (geen Node-API's).
 */
export { VERSION } from "../version";
export { EidError, EID_ERROR_CODES } from "./errors";
export type { EidErrorCode, EidErrorOptions } from "./errors";

export type {
  EidAddress,
  EidCardData,
  EidCardInfo,
  EidCertificates,
  EidIdentity,
  EidPhoto,
  EidReadOptions,
  Gender,
  PartialDate,
} from "./types";

export { readEid, isEid, readCardInfo, verifyPhoto } from "./eid";
export type { CardTransport } from "./transport";
export { sendApdu } from "./transport";

export { EID_FILES } from "./files";
export type { EidFileName } from "./files";
export { readFile, selectFile, FileNotFoundError, READ_BLOCK_SIZE } from "./filesystem";
export {
  SW,
  formatSw,
  parseResponse,
  selectFileCommand,
  readBinaryCommand,
  getResponseCommand,
  getCardDataCommand,
} from "./apdu";
export type { ResponseApdu } from "./apdu";

export { parseTlv, encodeTlv } from "./tlv";
export type { TlvRecord } from "./tlv";
export { parseIdentity, parseGender, IDENTITY_TAGS } from "./parsers/identity";
export { parseAddress, splitStreetAndNumber, ADDRESS_TAGS } from "./parsers/address";
export { parseCardData } from "./parsers/card-data";
export { parseBirthDate, parseCardDate, formatPartialDate } from "./parsers/dates";
export { checkNationalNumber, normalizeNationalNumber } from "./parsers/national-number";
export type { NationalNumberInfo } from "./parsers/national-number";
export { toHex, fromHex, concatBytes, equalBytes, utf8Decode, utf8Encode, digest } from "./bytes";
export type { DigestAlgorithm } from "./bytes";
