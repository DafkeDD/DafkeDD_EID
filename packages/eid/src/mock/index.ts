/**
 * @dafkedd/eid/mock — virtuele kaart voor tests en demo's zonder lezer.
 * Fase 4 voegt MockEidClient (voor React) toe.
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
