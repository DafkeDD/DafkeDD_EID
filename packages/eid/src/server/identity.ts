import type { X509Certificate } from "node:crypto";

export interface EidLoginIdentity {
  /** Rijksregisternummer (serialNumber in het certificaat). */
  nationalNumber: string;
  firstNames: string;
  lastName: string;
  /** CN, bv. "Jan Specimen (Authentication)". */
  commonName: string;
  country: string;
  /** Serienummer van het authenticatiecertificaat (hex). */
  certificateSerial: string;
  certificateValidUntil: Date;
  algorithm: string;
  /** Het gecontroleerde certificaat, voor wie meer wil weten. */
  certificate: X509Certificate;
}

/** Leest velden uit de subject-regels ("C=BE\nCN=…\nSN=…\nGN=…\nserialNumber=…"). */
export function subjectFields(subject: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of subject.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
