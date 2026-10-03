/**
 * Rijksregisternummer: `JJMMDD VVV CC`.
 * Controlegetal: `CC = 97 − (JJMMDDVVV mod 97)`; voor wie geboren is vanaf 2000 wordt
 * `2JJMMDDVVV` gebruikt. Zo kennen we ook de eeuw.
 */
export interface NationalNumberInfo {
  /** Klopt het controlegetal? */
  valid: boolean;
  /** 1900 of 2000 als het controlegetal klopt, anders `null`. */
  century: 1900 | 2000 | null;
  /** Leesbaar formaat `JJ.MM.DD-VVV.CC`, of de invoer als het geen 11 cijfers zijn. */
  formatted: string;
}

export function normalizeNationalNumber(input: string): string {
  return input.replace(/[\s.\-]/g, "");
}

export function checkNationalNumber(input: string): NationalNumberInfo {
  const digits = normalizeNationalNumber(input);
  if (!/^\d{11}$/.test(digits)) return { valid: false, century: null, formatted: input };

  const base = Number(digits.slice(0, 9));
  const check = Number(digits.slice(9));
  const formatted = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}-${digits.slice(6, 9)}.${digits.slice(9)}`;

  if (97 - (base % 97) === check) return { valid: true, century: 1900, formatted };
  if (97 - ((2_000_000_000 + base) % 97) === check) return { valid: true, century: 2000, formatted };
  return { valid: false, century: null, formatted };
}
