/**
 * @dafkedd/eid/mock — virtuele kaart voor tests en demo's zonder lezer.
 * MockEidClient doet alsof er een bridge is, voor <EidProvider client={…}>.
 */
export { VERSION } from "../version";
export { VirtualCard } from "./virtual-card";
export type { VirtualCardOptions } from "./virtual-card";
export {
  createSampleCard,
  createSampleFiles,
  sampleCardData,
  SAMPLE_IDENTITY,
  SAMPLE_ADDRESS,
  SAMPLE_PHOTO,
} from "./sample-card";
export type { SampleCardOptions, SampleIdentityFields, SampleAddressFields } from "./sample-card";
export { MockEidClient } from "./mock-client";
export type { MockEidClientOptions } from "./mock-client";
