/**
 * `dafke-eid` — commando's rond de kaartlezer.
 * Fase 3: `readers` en `read` (handig om een lezer te testen). De bridge-server komt in fase 4.
 */
import { EidError, formatPartialDate, checkNationalNumber, type EidCardData } from "../core";
import { createSampleCard } from "../mock";
import { VERSION } from "../version";
import { createEidReader, type EidReader } from "./reader";
import { MockPcscBackend } from "./pcsc/mock";
import { createNativeBackend } from "./pcsc/native";
import { diagnose } from "./diagnose";
import type { PcscBackend } from "./pcsc/backend";

export const HELP = `dafke-eid ${VERSION}

Lokale brug tussen je kaartlezer en toegelaten websites.

Gebruik:
  dafke-eid <commando> [opties]

Commando's:
  readers               Toon de kaartlezers en of er een kaart in zit
  read                  Lees de eID in (persoonsgegevens worden gemaskeerd)
  diag                  Toon de ruwe PC/SC-toestand (zonder persoonsgegevens)

Opties:
  --reader <naam>       Gebruik deze kaartlezer (standaard: de eerste met een kaart)
  --full                Toon alle gegevens, niet gemaskeerd
  --json                Toon alle gegevens als JSON (foto in base64)
  --no-photo            Lees de foto niet
  --mock                Gebruik een virtuele lezer met voorbeeldkaart
  --debug               Toon technische fouten van de kaartlezer (PC/SC)
  -v, --version         Toon de versie
  -h, --help            Toon deze hulp
`;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CliDeps {
  createReader(options: { mock: boolean; debug?: boolean }): Promise<EidReader>;
  createBackend?(options: { mock: boolean }): Promise<PcscBackend>;
}

export const MOCK_READER_NAME = "DafkeDD Virtuele Lezer";

async function mockBackend(): Promise<MockPcscBackend> {
  const backend = new MockPcscBackend().addReader(MOCK_READER_NAME);
  backend.insertCard(MOCK_READER_NAME, await createSampleCard());
  return backend;
}

export const defaultDeps: CliDeps = {
  async createBackend({ mock }) {
    return mock ? mockBackend() : createNativeBackend();
  },
  async createReader({ mock, debug = false }) {
    const onError = debug ? (error: unknown) => process.stderr.write(`[debug] ${error instanceof Error ? error.message : String(error)}\n`) : undefined;
    if (!mock) return createEidReader(onError ? { onError } : {});
    return createEidReader({ backend: await mockBackend() });
  },
};

interface ParsedArgs {
  command: string | undefined;
  reader: string | undefined;
  full: boolean;
  json: boolean;
  photo: boolean;
  mock: boolean;
  debug: boolean;
  version: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs | string {
  const args: ParsedArgs = { command: undefined, reader: undefined, full: false, json: false, photo: true, mock: false, debug: false, version: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "-v":
      case "--version":
        args.version = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--full":
        args.full = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--no-photo":
        args.photo = false;
        break;
      case "--mock":
        args.mock = true;
        break;
      case "--debug":
        args.debug = true;
        break;
      case "--reader": {
        const value = argv[++i];
        if (value === undefined || value.startsWith("--")) return "--reader verwacht een naam";
        args.reader = value;
        break;
      }
      default:
        if (arg.startsWith("-")) return `Onbekende optie: ${arg}`;
        if (args.command !== undefined) return `Onverwacht argument: ${arg}`;
        args.command = arg;
    }
  }
  return args;
}

/** "Specimen" → "S*******". */
export function maskWord(word: string): string {
  return word
    .split(/(\s+|-)/)
    .map((part) => (/^\s+$|^-$/.test(part) || part.length === 0 ? part : part[0] + "*".repeat(part.length - 1)))
    .join("");
}

function line(label: string, value: string): string {
  return `${label.padEnd(18)}${value}\n`;
}

export function formatCard(reader: string, data: EidCardData, full: boolean): string {
  const { identity: id, address } = data;
  const nn = checkNationalNumber(id.nationalNumber);
  const birth = id.dateOfBirth ? formatPartialDate(id.dateOfBirth) : id.dateOfBirthRaw;
  let out = line("Kaartlezer:", reader);
  if (full) {
    out += line("Naam:", `${id.lastName}, ${id.firstNames} ${id.thirdNameInitial}`.trim());
    out += line("Rijksregisternr:", `${nn.formatted}${nn.valid ? "" : " (controlegetal klopt niet!)"}`);
    out += line("Geboren:", `${birth} in ${id.placeOfBirth}`);
    out += line("Geslacht:", id.gender);
    out += line("Nationaliteit:", id.nationality);
    out += line("Adres:", `${address.streetAndNumber}, ${address.zipCode} ${address.municipality}`);
    out += line("Kaartnummer:", id.cardNumber);
    out += line("Geldig:", `${id.validFrom} tot ${id.validUntil}`);
    out += line("Uitgereikt in:", id.issuingMunicipality);
  } else {
    out += line("Naam:", `${maskWord(id.lastName)}, ${maskWord(id.firstNames)}`);
    out += line("Rijksregisternr:", `${nn.formatted.slice(0, 8)}-***.**${nn.valid ? "" : " (controlegetal klopt niet!)"}`);
    out += line("Geboortejaar:", String(id.dateOfBirth?.year ?? "?"));
    out += line("Adres:", `***, ${address.zipCode} ${address.municipality}`);
    out += line("Kaartnummer:", `********${id.cardNumber.slice(-4)}`);
    out += line("Geldig tot:", id.validUntil);
  }
  if (data.cardInfo) out += line("Applet:", data.cardInfo.appletVersion);
  out += line("Foto:", data.photo ? `${data.photo.data.length} bytes (hash klopt)` : "niet gelezen");
  if (!full) out += "\nGebruik --full om alle gegevens te tonen.\n";
  return out;
}

function toJson(reader: string, data: EidCardData): string {
  return (
    JSON.stringify(
      { reader, ...data },
      (_key, value) => (value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value),
      2,
    ) + "\n"
  );
}

function errorResult(error: unknown): CliResult {
  if (EidError.is(error)) return { code: 2, stdout: "", stderr: `Fout (${error.code}): ${error.message}\n` };
  return { code: 2, stdout: "", stderr: `Onverwachte fout: ${error instanceof Error ? error.message : String(error)}\n` };
}

export async function runCli(argv: readonly string[], deps: CliDeps = defaultDeps): Promise<CliResult> {
  const args = parseArgs(argv);
  if (typeof args === "string") return { code: 1, stdout: "", stderr: `${args}\n\n${HELP}` };
  if (args.version) return { code: 0, stdout: `${VERSION}\n`, stderr: "" };
  if (args.help || args.command === undefined) return { code: 0, stdout: HELP, stderr: "" };

  if (args.command === "diag") {
    const create = deps.createBackend ?? defaultDeps.createBackend!;
    let backend: PcscBackend | undefined;
    try {
      backend = await create({ mock: args.mock });
      return { code: 0, stdout: await diagnose(backend), stderr: "" };
    } catch (error) {
      return errorResult(error);
    } finally {
      await backend?.close();
    }
  }

  if (args.command !== "readers" && args.command !== "read") {
    return { code: 1, stdout: "", stderr: `Onbekend commando: ${args.command}\n\n${HELP}` };
  }

  let reader: EidReader | undefined;
  try {
    reader = await deps.createReader({ mock: args.mock, debug: args.debug });

    if (args.command === "readers") {
      const readers = reader.readers();
      if (readers.length === 0) return { code: 0, stdout: "Geen kaartlezers gevonden.\n", stderr: "" };
      const stdout = readers.map((r) => `${r.cardPresent ? "[kaart]" : "[leeg] "} ${r.name}\n`).join("");
      return { code: 0, stdout, stderr: "" };
    }

    const name = args.reader ?? reader.readers().find((r) => r.cardPresent)?.name;
    const data = await reader.read(name, { photo: args.photo });
    const used = name ?? "?";
    return { code: 0, stdout: args.json ? toJson(used, data) : formatCard(used, data, args.full), stderr: "" };
  } catch (error) {
    return errorResult(error);
  } finally {
    await reader?.close();
  }
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return /(?:^|[\\/])(?:cli\.(?:js|ts)|dafke-eid(?:\.exe|\.cmd)?)$/.test(entry);
}

if (isMain()) {
  void runCli(process.argv.slice(2)).then((result) => {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.code;
  });
}
