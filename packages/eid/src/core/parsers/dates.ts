/**
 * Datums op de eID.
 * - Geldigheid: `DD.MM.YYYY`.
 * - Geboortedatum: in de taal van de gemeente, bv. `15 MAAR 1985`, `15 MARS 1985`, `15.MÄR.1985`,
 *   soms gedeeltelijk (`MAAR 1985`, `1985`, of dag/maand `00`).
 */
import { EidError } from "../errors";
import type { PartialDate } from "../types";

/** Maandafkortingen in NL, FR en DE, zonder accenten en in hoofdletters. */
const MONTHS: Record<string, number> = {
  JAN: 1, JANV: 1, JANVIER: 1,
  FEB: 2, FEV: 2, FEVR: 2,
  MAAR: 3, MARS: 3, MAR: 3, MAER: 3,
  APR: 4, AVR: 4, AVRIL: 4,
  MEI: 5, MAI: 5,
  JUN: 6, JUIN: 6, JUNI: 6,
  JUL: 7, JUIL: 7, JULI: 7,
  AUG: 8, AOUT: 8,
  SEP: 9, SEPT: 9,
  OKT: 10, OCT: 10,
  NOV: 11,
  DEC: 12, DEZ: 12,
};

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValid(date: PartialDate): boolean {
  if (date.year < 1800 || date.year > 2200) return false;
  if (date.month === undefined) return date.day === undefined;
  if (date.month < 1 || date.month > 12) return false;
  if (date.day === undefined) return true;
  return date.day >= 1 && date.day <= daysInMonth(date.year, date.month);
}

/** Geboortedatum → PartialDate, of `null` als ze niet te lezen is. */
export function parseBirthDate(raw: string): PartialDate | null {
  const tokens = stripAccents(raw.trim().toUpperCase()).split(/[\s.\-/]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) return null;

  const yearToken = tokens[tokens.length - 1]!;
  if (!/^\d{4}$/.test(yearToken)) return null;
  const date: PartialDate = { year: Number(yearToken) };

  if (tokens.length >= 2) {
    const monthToken = tokens[tokens.length - 2]!;
    const month = /^\d{1,2}$/.test(monthToken) ? Number(monthToken) : MONTHS[monthToken];
    if (month === undefined) return null;
    if (month !== 0) date.month = month;
  }

  if (tokens.length === 3) {
    const dayToken = tokens[0]!;
    if (!/^\d{1,2}$/.test(dayToken)) return null;
    const day = Number(dayToken);
    // Een gekende dag zonder gekende maand is geen zinvolle datum.
    if (day !== 0) {
      if (date.month === undefined) return null;
      date.day = day;
    }
  }

  return isValid(date) ? date : null;
}

/** `DD.MM.YYYY` → ISO `YYYY-MM-DD`. Gooit `invalid-data` bij een ongeldige datum. */
export function parseCardDate(raw: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw.trim());
  if (!match) throw new EidError("invalid-data", `Ongeldige datum op de kaart: "${raw}"`);
  const [, dd, mm, yyyy] = match;
  const date = { year: Number(yyyy), month: Number(mm), day: Number(dd) };
  if (!isValid(date)) throw new EidError("invalid-data", `Ongeldige datum op de kaart: "${raw}"`);
  return `${yyyy}-${mm}-${dd}`;
}

/** PartialDate → ISO-achtige tekst: `1985-03-15`, `1985-03` of `1985`. */
export function formatPartialDate(date: PartialDate): string {
  const parts = [String(date.year).padStart(4, "0")];
  if (date.month !== undefined) parts.push(String(date.month).padStart(2, "0"));
  if (date.month !== undefined && date.day !== undefined) parts.push(String(date.day).padStart(2, "0"));
  return parts.join("-");
}
