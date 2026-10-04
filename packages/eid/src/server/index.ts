/**
 * @dafkedd/eid/server — een eID-login (web-eid:1.0-token) controleren op de server (Node).
 * Handtekening over je eigen origin + nonce, keten tot Belgium Root CA, OCSP (fail closed).
 */
export { VERSION } from "../version";
export { EidAuthenticator } from "./authenticator";
export type { EidAuthenticatorOptions, EidChallenge } from "./authenticator";
export { verifyEidToken } from "./validator";
export type { VerifyEidTokenOptions, EidTrustOptions } from "./validator";
export { EidVerifyError, EID_VERIFY_ERROR_CODES } from "./errors";
export type { EidVerifyErrorCode } from "./errors";
export type { EidLoginIdentity } from "./identity";
export { createNonce, MemoryNonceStore } from "./nonce";
export type { NonceStore } from "./nonce";
export { checkOcsp, buildOcspRequest, ocspUrl, caIssuersUrl } from "./ocsp";
export type { OcspOptions, OcspFetch } from "./ocsp";
export { buildChain, toCertificate, clearIssuerCache } from "./chain";
export type { CertificateInput, IssuerFetch } from "./chain";
export { BELGIUM_ROOT_CAS } from "./roots";
export type { EidAuthToken } from "../core/auth";
