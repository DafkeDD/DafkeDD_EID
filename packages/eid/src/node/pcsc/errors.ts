import { EidError, type EidErrorCode } from "../../core";
import { SCARD_ERROR, type ScardErrorName } from "./constants";

const NAMES = new Map<number, ScardErrorName>(
  Object.entries(SCARD_ERROR).map(([name, code]) => [code, name as ScardErrorName]),
);

/** Fout van een PC/SC-functie, met de originele code. */
export class PcscError extends Error {
  readonly code: number;
  readonly function: string;

  constructor(fn: string, code: number) {
    const unsigned = code >>> 0;
    const name = NAMES.get(unsigned) ?? "UNKNOWN";
    super(`${fn} mislukt: SCARD_${name} (0x${unsigned.toString(16).padStart(8, "0")})`);
    this.name = "PcscError";
    this.code = unsigned;
    this.function = fn;
  }

  is(name: ScardErrorName): boolean {
    return this.code === SCARD_ERROR[name];
  }
}

export function isPcscError(error: unknown, name?: ScardErrorName): error is PcscError {
  return error instanceof PcscError && (name === undefined || error.is(name));
}

/** De dienst is weg (bv. Windows stopt "Smart Card" als de laatste lezer verdwijnt): opnieuw verbinden. */
export function isServiceGone(error: unknown): boolean {
  return (
    isPcscError(error) &&
    (error.is("E_NO_SERVICE") || error.is("E_SERVICE_STOPPED") || error.is("E_INVALID_HANDLE") || error.is("E_SYSTEM_CANCELLED"))
  );
}

/** Zet een PC/SC-fout om naar een EidError met een code die een UI kan tonen. */
export function toEidError(error: unknown): EidError {
  if (EidError.is(error)) return error;
  if (!(error instanceof PcscError)) return new EidError("internal", error instanceof Error ? error.message : String(error), { cause: error });

  let code: EidErrorCode = "internal";
  if (error.is("E_NO_SMARTCARD")) code = "no-card";
  else if (error.is("W_REMOVED_CARD") || error.is("W_RESET_CARD")) code = "card-removed";
  else if (error.is("E_SHARING_VIOLATION")) code = "card-busy";
  else if (error.is("E_NO_READERS_AVAILABLE") || error.is("E_UNKNOWN_READER") || error.is("E_READER_UNAVAILABLE")) code = "no-reader";
  else if (error.is("W_UNRESPONSIVE_CARD") || error.is("W_UNPOWERED_CARD") || error.is("E_PROTO_MISMATCH")) code = "read-failed";
  else if (error.is("E_TIMEOUT")) code = "timeout";
  else if (error.is("E_CANCELLED")) code = "aborted";
  else if (error.is("E_NO_SERVICE") || error.is("E_SERVICE_STOPPED")) code = "no-reader";
  return new EidError(code, error.message, { cause: error });
}
