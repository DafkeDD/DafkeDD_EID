/**
 * Kleine formatters voor de UI. Geen afhankelijkheden; standaard Belgisch-Nederlands.
 */
import { checkNationalNumber, toBase64, type EidAddress, type EidIdentity, type EidPhoto, type PartialDate } from "../core";

/** "Jan Pieter Specimen" (voornamen + achternaam). */
export function fullName(identity: Pick<EidIdentity, "firstNames" | "lastName">): string {
  return `${identity.firstNames} ${identity.lastName}`.replace(/\s+/g, " ").trim();
}

/** "85.03.15-123.69". Ongeldige nummers komen ongewijzigd terug. */
export function formatNationalNumber(nationalNumber: string): string {
  return checkNationalNumber(nationalNumber).formatted;
}

/**
 * Datum leesbaar maken. Aanvaardt ISO (`2034-06-01`) of een PartialDate.
 * Gedeeltelijke datums tonen alleen wat gekend is (bv. "maart 1985" of "1985").
 */
export function formatDate(value: string | PartialDate | null | undefined, locale = "nl-BE"): string {
  if (!value) return "";
  const date: PartialDate =
    typeof value === "string"
      ? (() => {
          const [y, m, d] = value.split("-").map(Number);
          return { year: y!, ...(m ? { month: m } : {}), ...(d ? { day: d } : {}) };
        })()
      : value;
  if (date.month === undefined) return String(date.year);
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day ?? 1));
  const options: Intl.DateTimeFormatOptions =
    date.day === undefined
      ? { year: "numeric", month: "long", timeZone: "UTC" }
      : { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" };
  return new Intl.DateTimeFormat(locale, options).format(utc);
}

/** "Voorbeeldstraat 12 bus 3, 9000 Gent". */
export function formatAddress(address: Pick<EidAddress, "streetAndNumber" | "zipCode" | "municipality">): string {
  return [address.streetAndNumber, `${address.zipCode} ${address.municipality}`.trim()].filter(Boolean).join(", ");
}

/** data:-URL voor een <img src>. */
export function photoDataUrl(photo: EidPhoto | null | undefined): string | undefined {
  return photo ? `data:${photo.mimeType};base64,${toBase64(photo.data)}` : undefined;
}

/** Leeftijd in jaren op `today`, of null als de geboortedatum onvolledig is. */
export function ageOn(dateOfBirth: PartialDate | null, today: Date = new Date()): number | null {
  if (!dateOfBirth?.month || !dateOfBirth.day) return null;
  let age = today.getFullYear() - dateOfBirth.year;
  const beforeBirthday =
    today.getMonth() + 1 < dateOfBirth.month || (today.getMonth() + 1 === dateOfBirth.month && today.getDate() < dateOfBirth.day);
  if (beforeBirthday) age--;
  return age;
}
