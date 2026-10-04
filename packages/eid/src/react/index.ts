/**
 * @dafkedd/eid/react — React-bindings (browser): EidProvider, useEid, EidReader.
 * EidClient en EidStore werken ook zonder React.
 */
export { VERSION } from "../version";
export { EidClient } from "./client";
export type { EidClientLike, EidClientOptions, EidClientEvent, ReadCardOptions, ReadCardResult, AuthenticateOptions, AuthenticateResult } from "./client";
export { EidStore, INITIAL_STATE } from "./store";
export type { EidPhase, EidState, EidStoreOptions } from "./store";
export { EidProvider, useEid, EidReader, useEidLogin } from "./react";
export type { EidProviderProps, UseEidResult, UseEidLoginResult, EidLoginState } from "./react";
export { fullName, formatNationalNumber, formatDate, formatAddress, photoDataUrl, ageOn } from "./format";
export { EidError, DEFAULT_BRIDGE_URL } from "../core";
export type { EidCardData, EidIdentity, EidAddress, EidPhoto, EidErrorCode, ReaderInfo, PartialDate, EidAuthToken } from "../core";
