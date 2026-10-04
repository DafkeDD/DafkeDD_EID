/**
 * Test de koffi-koppeling tegen een gecompileerde nep-PC/SC-bibliotheek (tests/fixtures/fake-pcsc.c),
 * met de Linux-ABI én de macOS-ABI (packed structs, 32-bit handles).
 * Draait alleen op Linux met gcc (in CI: ubuntu). De echte Windows/macOS-test: npm run test:integration.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import koffi from "koffi";
import { abiFor, NativePcscBackend } from "../../packages/eid/src/node/pcsc/native";
import { PcscError } from "../../packages/eid/src/node/pcsc/errors";
import { SCARD_STATE } from "../../packages/eid/src/node/pcsc/constants";

function hasGcc(): boolean {
  try {
    execFileSync("gcc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRun = process.platform === "linux" && process.arch === "x64" && hasGcc();
const dir = canRun ? mkdtempSync(join(tmpdir(), "fake-pcsc-")) : "";

function build(variant: "linux" | "mac"): string {
  const out = join(dir, `fake-pcsc-${variant}.so`);
  const args = ["-shared", "-fPIC", "-O1", "-o", out, "tests/fixtures/fake-pcsc.c"];
  if (variant === "mac") args.unshift("-DMAC_ABI");
  execFileSync("gcc", args);
  return out;
}

describe.runIf(canRun).each(["linux", "mac"] as const)("native backend met %s-ABI (nep-bibliotheek)", (variant) => {
  const library = canRun ? build(variant) : "";
  // De mac-ABI testen we op Linux: zelfde types en packing, ander bibliotheekpad.
  const abi = { ...abiFor(variant === "mac" ? "darwin" : "linux"), library };
  const backend = canRun ? new NativePcscBackend(koffi, { abi }) : (undefined as never);
  afterAll(() => backend?.close());

  it("heeft dezelfde struct-groottes als C", () => {
    const lib = koffi.load(library);
    const sizeofState = lib.func("int FakeSizeofReaderState(void)") as () => number;
    const sizeofPci = lib.func("int FakeSizeofIoRequest(void)") as () => number;
    const make = abi.packed ? koffi.pack : koffi.struct;
    const state = make({
      szReader: "str",
      pvUserData: "void *",
      dwCurrentState: abi.dword,
      dwEventState: abi.dword,
      cbAtr: abi.dword,
      rgbAtr: koffi.array("uint8_t", abi.atrSize),
    });
    expect(koffi.sizeof(state)).toBe(sizeofState());
    expect(koffi.sizeof(make({ a: abi.dword, b: abi.dword }))).toBe(sizeofPci());
  });

  it("somt de lezers op", async () => {
    expect(await backend.listReaders()).toEqual(["Fake Reader A", "Fake Reader B"]);
  });

  it("leest de toestand van lezers, met ATR", async () => {
    const result = await backend.getStatusChange(
      [
        { reader: "Fake Reader A", currentState: 0 },
        { reader: "Fake Reader B", currentState: 0 },
      ],
      100,
    );
    expect(result).not.toBeNull();
    const [a, b] = result!;
    expect(a!.eventState & SCARD_STATE.PRESENT).toBeTruthy();
    expect(a!.eventState & SCARD_STATE.CHANGED).toBeTruthy();
    expect(Array.from(a!.atr)).toEqual([0x3b, 0x7f, 0x96, 0x00, 0x00, 0x80, 0x31, 0x80, 0x65, 0xb0]);
    expect(b!.eventState & SCARD_STATE.EMPTY).toBeTruthy();
    expect(b!.atr).toHaveLength(0);
  });

  it("geeft de toestand terug als PC/SC E_TIMEOUT geeft terwijl er wel iets veranderde", async () => {
    const lib = koffi.load(library);
    const setQuirk = lib.func("void FakeSetWindowsTimeoutQuirk(int on)") as (on: number) => void;
    setQuirk(1);
    try {
      const result = await backend.getStatusChange([{ reader: "Fake Reader A", currentState: 0 }], 0);
      expect(result).not.toBeNull();
      expect(result![0]!.eventState & SCARD_STATE.PRESENT).toBeTruthy();
    } finally {
      setQuirk(0);
    }
  });

  it("geeft null bij een time-out als er niets verandert", async () => {
    const result = await backend.getStatusChange([{ reader: "Fake Reader A", currentState: SCARD_STATE.PRESENT }], 50);
    expect(result).toBeNull();
  });

  it("wordt wakker gemaakt door cancel()", async () => {
    const waiting = backend.getStatusChange([{ reader: "Fake Reader A", currentState: SCARD_STATE.PRESENT }], 5000);
    setTimeout(() => backend.cancel(), 50);
    await expect(waiting).rejects.toSatisfy((e: unknown) => e instanceof PcscError && e.is("E_CANCELLED"));
  });

  it("verbindt, stuurt APDU's en sluit af", async () => {
    const card = await backend.connect("Fake Reader A");
    expect(card.protocol).toBe(2);
    await card.beginTransaction();
    const response = await card.transmit(Uint8Array.of(1, 2, 3));
    expect(Array.from(response)).toEqual([3, 2, 1, 0x90, 0x00]);
    await card.endTransaction();
    await card.disconnect();
    await expect(card.transmit(Uint8Array.of(1))).rejects.toBeInstanceOf(PcscError);
  });

  it("geeft PC/SC-fouten door met hun code", async () => {
    await expect(backend.connect("Fake Reader B")).rejects.toSatisfy((e: unknown) => e instanceof PcscError && e.is("E_NO_SMARTCARD"));
    await expect(backend.connect("Bestaat niet")).rejects.toSatisfy((e: unknown) => e instanceof PcscError && e.is("E_UNKNOWN_READER"));
  });
});

describe("abiFor", () => {
  it("kiest per platform de juiste bibliotheek en types", () => {
    expect(abiFor("win32")).toMatchObject({ library: "winscard.dll", suffix: "W", dword: "uint32_t", handle: "uintptr_t", atrSize: 36 });
    expect(abiFor("darwin")).toMatchObject({ suffix: "", handle: "int32_t", packed: true, atrSize: 33 });
    expect(abiFor("linux")).toMatchObject({ library: "libpcsclite.so.1", dword: "unsigned long", long: "long" });
  });
});
