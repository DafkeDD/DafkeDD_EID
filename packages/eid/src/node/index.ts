/**
 * @dafkedd/eid/node — PC/SC via koffi, lezers volgen en een eID uitlezen (Node).
 * Plus de bridge: een lokale HTTP-server voor toegelaten websites.
 */
export { VERSION } from "../version";
export { createEidReader, EidReader } from "./reader";
export type { EidReaderOptions, EidReaderListener } from "./reader";
export { ReaderMonitor } from "./monitor";
export type { ReaderEvent, ReaderInfo, ReaderMonitorOptions } from "./monitor";
export type { PcscBackend, PcscCard, ReaderStateQuery, ReaderStateResult } from "./pcsc/backend";
export { createNativeBackend, NativePcscBackend, abiFor } from "./pcsc/native";
export type { NativeAbi, NativePcscOptions } from "./pcsc/native";
export { MockPcscBackend, MOCK_EID_ATR } from "./pcsc/mock";
export { PcscError, isPcscError, toEidError } from "./pcsc/errors";
export { SCARD_ERROR, SCARD_STATE, SCARD_PROTOCOL_T0, SCARD_PROTOCOL_T1 } from "./pcsc/constants";
export { startBridge } from "./bridge";
export type { Bridge, BridgeOptions } from "./bridge";
