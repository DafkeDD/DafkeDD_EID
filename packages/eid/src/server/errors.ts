/**
 * Fouten bij het controleren van een eID-login op de server. Vaste codes, zodat je app per geval
 * kan reageren (en loggen), zonder de details aan de gebruiker te tonen.
 */
export const EID_VERIFY_ERROR_CODES = [
  "token-invalid", // geen geldig web-eid:1.0-token (vorm, base64, algoritme)
  "nonce-invalid", // nonce onbekend, al gebruikt of verlopen
  "signature-invalid", // handtekening klopt niet (ook bij een verkeerde origin of nonce)
  "certificate-invalid", // certificaat onleesbaar, verkeerd sleuteltype of geen authenticatiecertificaat
  "certificate-expired", // certificaat (nog) niet geldig
  "chain-untrusted", // geen geldige keten tot een vertrouwde root
  "certificate-revoked", // ingetrokken volgens OCSP
  "revocation-unavailable", // OCSP gaf geen bruikbaar antwoord: geen login (fail closed)
  "config-invalid", // verkeerde instellingen (bv. geen vertrouwde roots)
] as const;

export type EidVerifyErrorCode = (typeof EID_VERIFY_ERROR_CODES)[number];

export class EidVerifyError extends Error {
  readonly code: EidVerifyErrorCode;

  constructor(code: EidVerifyErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "EidVerifyError";
    this.code = code;
  }

  static is(value: unknown, code?: EidVerifyErrorCode): value is EidVerifyError {
    return value instanceof Error && value.name === "EidVerifyError" && (code === undefined || (value as EidVerifyError).code === code);
  }
}
