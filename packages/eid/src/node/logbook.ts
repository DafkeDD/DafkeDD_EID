/**
 * Logboek van de bridge: de laatste gebeurtenissen in het geheugen (voor de testpagina) en
 * optioneel een logbestand met beperkte grootte (voor support).
 *
 * NOOIT persoonsgegevens loggen: geen namen, rijksregisternummers, adressen, foto's of PIN.
 * Wel: kaart in/uit, lezernamen, aanvragen (methode, pad zonder querystring, origin, status), fouten.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  time: string;
  level: LogLevel;
  message: string;
}

export interface LogbookOptions {
  /** Aantal regels in het geheugen. Standaard 200. */
  size?: number;
  /** Logbestand (optioneel). */
  file?: string;
  /** Maximale grootte van het logbestand; daarna wordt het `<file>.1`. Standaard 1 MB. */
  maxFileBytes?: number;
  now?: () => Date;
}

export class Logbook {
  readonly file: string | undefined;
  readonly #size: number;
  readonly #maxFileBytes: number;
  readonly #now: () => Date;
  readonly #entries: LogEntry[] = [];
  #fileBroken = false;

  constructor(options: LogbookOptions = {}) {
    this.#size = options.size ?? 200;
    this.file = options.file;
    this.#maxFileBytes = options.maxFileBytes ?? 1_000_000;
    this.#now = options.now ?? (() => new Date());
  }

  add(level: LogLevel, message: string): void {
    const entry: LogEntry = { time: this.#now().toISOString(), level, message: message.replace(/[\r\n]+/g, " ") };
    this.#entries.push(entry);
    if (this.#entries.length > this.#size) this.#entries.splice(0, this.#entries.length - this.#size);
    this.#write(entry);
  }

  info(message: string): void {
    this.add("info", message);
  }

  warn(message: string): void {
    this.add("warn", message);
  }

  error(message: string): void {
    this.add("error", message);
  }

  /** Kopie van de regels in het geheugen, oudste eerst. */
  entries(): LogEntry[] {
    return [...this.#entries];
  }

  #write(entry: LogEntry): void {
    if (!this.file || this.#fileBroken) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      try {
        if (statSync(this.file).size >= this.#maxFileBytes) renameSync(this.file, `${this.file}.1`);
      } catch {
        // Bestand bestaat nog niet.
      }
      appendFileSync(this.file, `${entry.time} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}\n`, "utf8");
    } catch {
      // Logbestand niet schrijfbaar: verder zonder, de bridge mag hierdoor niet stoppen.
      this.#fileBroken = true;
    }
  }
}
