/**
 * PC/SC via FFI (koffi): niets te compileren, geen Build Tools nodig.
 *
 * ABI-verschillen tussen platformen zitten allemaal hier:
 *   Windows  winscard.dll                 DWORD = uint32, LONG = int32, handles = pointer-groot, W-functies (UTF-16), ATR-buffer 36
 *   macOS    PCSC.framework               DWORD = uint32, LONG = int32, handles = int32, packed structs, ATR-buffer 33
 *   Linux    libpcsclite.so.1 (pcsc-lite) DWORD = unsigned long, LONG = long (8 bytes op 64-bit), ATR-buffer 33
 */
import type { PcscBackend, PcscCard, ReaderStateQuery, ReaderStateResult } from "./backend";
import {
  SCARD_ERROR,
  SCARD_LEAVE_CARD,
  SCARD_PROTOCOL_T0,
  SCARD_PROTOCOL_T1,
  SCARD_RESET_CARD,
  SCARD_SCOPE_USER,
  SCARD_SHARE_SHARED,
  SCARD_STATE,
} from "./constants";
import { isServiceGone, PcscError } from "./errors";
import { prepareNativeModules } from "../runtime";

type Koffi = typeof import("koffi").default;
type Handle = number | bigint;
type NativeFn = ((...args: unknown[]) => unknown) & { async: (...args: unknown[]) => void };

export interface NativeAbi {
  library: string;
  /** "W" = UTF-16-functies (Windows), "" = UTF-8. */
  suffix: "W" | "";
  dword: string;
  long: string;
  handle: string;
  atrSize: number;
  packed: boolean;
}

export function abiFor(platform: NodeJS.Platform): NativeAbi {
  switch (platform) {
    case "win32":
      return { library: "winscard.dll", suffix: "W", dword: "uint32_t", long: "int32_t", handle: "uintptr_t", atrSize: 36, packed: false };
    case "darwin":
      return {
        library: "/System/Library/Frameworks/PCSC.framework/PCSC",
        suffix: "",
        dword: "uint32_t",
        long: "int32_t",
        handle: "int32_t",
        atrSize: 33,
        packed: true,
      };
    default:
      return { library: "libpcsclite.so.1", suffix: "", dword: "unsigned long", long: "long", handle: "long", atrSize: 33, packed: false };
  }
}

export interface NativePcscOptions {
  /** Standaard: het platform waarop we draaien. */
  abi?: NativeAbi;
  /** Ander pad naar de bibliotheek (tests). */
  library?: string;
}

/** Normaliseert een LONG-resultaat (int32, int64 of BigInt) naar een unsigned 32-bit foutcode. */
function toCode(result: unknown): number {
  return Number(BigInt.asUintN(32, BigInt(result as number | bigint)));
}

function decodeMultiString(data: Uint8Array | Uint16Array, length: number): string[] {
  const text =
    data instanceof Uint16Array
      ? String.fromCharCode(...data.subarray(0, length))
      : new TextDecoder("utf-8").decode(data.subarray(0, length));
  return text.split("\0").filter(Boolean);
}

/** Laadt koffi en de PC/SC-bibliotheek van het platform. */
export async function createNativeBackend(options: NativePcscOptions = {}): Promise<NativePcscBackend> {
  // In het zelfstandige programma eerst de ingebedde koffi-addon klaarzetten.
  prepareNativeModules();
  const koffi = (await import("koffi")).default;
  return new NativePcscBackend(koffi, options);
}

export class NativePcscBackend implements PcscBackend {
  readonly #abi: NativeAbi;
  readonly #wide: boolean;
  readonly #f: Record<string, NativeFn>;
  readonly #pciSize: number;
  /** Twee contexten: de monitor blokkeert in getStatusChange, kaartoperaties gaan via de andere. */
  #monitorContext: Handle | undefined;
  #cardContext: Handle | undefined;
  #closed = false;

  constructor(koffi: Koffi, options: NativePcscOptions = {}) {
    const abi = options.abi ?? abiFor(process.platform);
    this.#abi = abi;
    this.#wide = abi.suffix === "W";
    const lib = koffi.load(options.library ?? abi.library);
    const { dword: D, long: L, handle: H } = abi;
    const S = this.#wide ? "char16_t *" : "char *";
    const conv = "__stdcall";

    const make = abi.packed ? koffi.pack : koffi.struct;
    const ReaderState = make({
      szReader: this.#wide ? "str16" : "str",
      pvUserData: "void *",
      dwCurrentState: D,
      dwEventState: D,
      cbAtr: D,
      rgbAtr: koffi.array("uint8_t", abi.atrSize, "Typed"),
    });
    const IoRequest = make({ dwProtocol: D, cbPciLength: D });
    this.#pciSize = koffi.sizeof(IoRequest);

    const fn = (name: string, ret: string, params: unknown[]) =>
      lib.func(conv, name, ret, params as never) as unknown as NativeFn;
    const sfx = abi.suffix;

    this.#f = {
      establish: fn("SCardEstablishContext", L, [D, "void *", "void *", koffi.out(koffi.pointer(H))]),
      release: fn("SCardReleaseContext", L, [H]),
      cancel: fn("SCardCancel", L, [H]),
      listReaders: fn(`SCardListReaders${sfx}`, L, [H, `const ${S}`, "void *", koffi.inout(koffi.pointer(D))]),
      getStatusChange: fn(`SCardGetStatusChange${sfx}`, L, [H, D, koffi.inout(koffi.pointer(ReaderState)), D]),
      connect: fn(`SCardConnect${sfx}`, L, [H, this.#wide ? "str16" : "str", D, D, koffi.out(koffi.pointer(H)), koffi.out(koffi.pointer(D))]),
      transmit: fn("SCardTransmit", L, [H, koffi.pointer(IoRequest), "void *", D, "void *", "void *", koffi.inout(koffi.pointer(D))]),
      beginTransaction: fn("SCardBeginTransaction", L, [H]),
      endTransaction: fn("SCardEndTransaction", L, [H, D]),
      disconnect: fn("SCardDisconnect", L, [H, D]),
    };
  }

  /** Synchrone call; gooit PcscError bij een fout. */
  #call(name: string, label: string, ...args: unknown[]): void {
    const code = toCode(this.#f[name]!(...args));
    if (code !== SCARD_ERROR.S_SUCCESS) throw new PcscError(label, code);
  }

  /** Asynchrone call op een worker-thread (voor alles wat kan blokkeren). */
  async #callAsync(name: string, label: string, ...args: unknown[]): Promise<void> {
    const f = this.#f[name]!;
    const result = await new Promise<unknown>((resolve, reject) => {
      f.async(...args, (error: unknown, value: unknown) => (error ? reject(error) : resolve(value)));
    });
    const code = toCode(result);
    if (code !== SCARD_ERROR.S_SUCCESS) throw new PcscError(label, code);
  }

  #establish(): Handle {
    if (this.#closed) throw new PcscError("SCardEstablishContext", SCARD_ERROR.E_INVALID_HANDLE);
    const out: Handle[] = [0];
    this.#call("establish", "SCardEstablishContext", SCARD_SCOPE_USER, null, null, out);
    return out[0]!;
  }

  #releaseContext(context: Handle | undefined): void {
    if (context === undefined) return;
    try {
      this.#f.release!(context);
    } catch {
      // Context was al ongeldig.
    }
  }

  #monitor(): Handle {
    return (this.#monitorContext ??= this.#establish());
  }

  #card(): Handle {
    return (this.#cardContext ??= this.#establish());
  }

  /** Voert een operatie uit; is de PC/SC-dienst weg, dan één keer opnieuw met een verse context. */
  async #withContext<T>(kind: "monitor" | "card", operation: (context: Handle) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let context: Handle;
      try {
        context = kind === "monitor" ? this.#monitor() : this.#card();
        return await operation(context);
      } catch (error) {
        if (!isServiceGone(error) || attempt > 0) throw error;
        if (kind === "monitor") {
          this.#releaseContext(this.#monitorContext);
          this.#monitorContext = undefined;
        } else {
          this.#releaseContext(this.#cardContext);
          this.#cardContext = undefined;
        }
      }
    }
  }

  async listReaders(): Promise<string[]> {
    try {
      return await this.#withContext("card", async (context) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const size: number[] = [0];
          this.#call("listReaders", "SCardListReaders", context, null, null, size);
          const buffer = this.#wide ? new Uint16Array(size[0]!) : new Uint8Array(size[0]!);
          try {
            this.#call("listReaders", "SCardListReaders", context, null, buffer, size);
          } catch (error) {
            if (error instanceof PcscError && error.is("E_INSUFFICIENT_BUFFER")) continue; // lezer kwam er net bij
            throw error;
          }
          return decodeMultiString(buffer, size[0]!);
        }
        throw new PcscError("SCardListReaders", SCARD_ERROR.E_INSUFFICIENT_BUFFER);
      });
    } catch (error) {
      // Geen lezers, of (Windows) de dienst draait niet omdat er nog nooit een lezer was.
      if (error instanceof PcscError && (error.is("E_NO_READERS_AVAILABLE") || error.is("E_NO_SERVICE") || error.is("E_SERVICE_STOPPED"))) {
        return [];
      }
      throw error;
    }
  }

  async getStatusChange(states: readonly ReaderStateQuery[], timeoutMs: number): Promise<ReaderStateResult[] | null> {
    if (states.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      return null;
    }
    return this.#withContext("monitor", async (context) => {
      const structs = states.map((s) => ({
        szReader: s.reader,
        pvUserData: null,
        dwCurrentState: s.currentState >>> 0,
        dwEventState: 0,
        cbAtr: 0,
        rgbAtr: new Uint8Array(this.#abi.atrSize),
      }));
      try {
        await this.#callAsync("getStatusChange", "SCardGetStatusChange", context, timeoutMs >>> 0, structs, structs.length);
      } catch (error) {
        if (!(error instanceof PcscError && error.is("E_TIMEOUT"))) throw error;
        // Voorzorg: geeft een implementatie E_TIMEOUT terwijl de toestanden wél ingevuld en gewijzigd
        // zijn, dan gebruiken we die toch. Alleen als er echt niets veranderde: null.
        if (!structs.some((s) => (Number(s.dwEventState) & SCARD_STATE.CHANGED) !== 0)) return null;
      }
      return structs.map((s, i) => ({
        reader: states[i]!.reader,
        eventState: Number(s.dwEventState) >>> 0,
        atr: Uint8Array.from((s.rgbAtr as Uint8Array).subarray(0, Math.min(Number(s.cbAtr), this.#abi.atrSize))),
      }));
    });
  }

  async connect(reader: string): Promise<PcscCard> {
    return this.#withContext("card", async (context) => {
      const handleOut: Handle[] = [0];
      const protocolOut: number[] = [0];
      await this.#callAsync("connect", "SCardConnect", context, reader, SCARD_SHARE_SHARED, SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1, handleOut, protocolOut);
      return this.#makeCard(reader, handleOut[0]!, Number(protocolOut[0]));
    });
  }

  #makeCard(reader: string, handle: Handle, protocol: number): PcscCard {
    const pci = { dwProtocol: protocol, cbPciLength: this.#pciSize };
    let connected = true;
    const assertConnected = (label: string) => {
      if (!connected) throw new PcscError(label, SCARD_ERROR.E_INVALID_HANDLE);
    };
    return {
      reader,
      protocol,
      transmit: async (command) => {
        assertConnected("SCardTransmit");
        const response = new Uint8Array(258 + 16);
        const length: number[] = [response.length];
        await this.#callAsync("transmit", "SCardTransmit", handle, pci, command, command.length, null, response, length);
        return response.slice(0, Number(length[0]));
      },
      beginTransaction: async () => {
        assertConnected("SCardBeginTransaction");
        await this.#callAsync("beginTransaction", "SCardBeginTransaction", handle);
      },
      endTransaction: async (reset = false) => {
        assertConnected("SCardEndTransaction");
        await this.#callAsync("endTransaction", "SCardEndTransaction", handle, reset ? SCARD_RESET_CARD : SCARD_LEAVE_CARD);
      },
      disconnect: async (reset = false) => {
        if (!connected) return;
        connected = false;
        await this.#callAsync("disconnect", "SCardDisconnect", handle, reset ? SCARD_RESET_CARD : SCARD_LEAVE_CARD);
      },
    };
  }

  cancel(): void {
    if (this.#monitorContext === undefined) return;
    try {
      this.#f.cancel!(this.#monitorContext);
    } catch {
      // Niets te annuleren.
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.cancel();
    this.#closed = true;
    this.#releaseContext(this.#monitorContext);
    this.#releaseContext(this.#cardContext);
    this.#monitorContext = undefined;
    this.#cardContext = undefined;
  }
}
