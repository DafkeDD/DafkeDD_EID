/**
 * `dafke-eid` — de bridge en commando's rond de kaartlezer.
 *
 * Zonder commando: `serve`. Uitzondering: het zelfstandige programma (dafke-eid.exe) dat NIET
 * vanuit de installatiemap draait, installeert zichzelf (dubbelklikken = installeren).
 */
import { EidError, formatPartialDate, checkNationalNumber, DEFAULT_BRIDGE_PORT, DEFAULT_ORIGINS, type EidCardData } from "../core";
import { createSampleCard } from "../mock";
import { VERSION } from "../version";
import { createEidReader, type EidReader } from "./reader";
import { MockPcscBackend } from "./pcsc/mock";
import { createNativeBackend } from "./pcsc/native";
import { diagnose } from "./diagnose";
import { startBridge, type Bridge } from "./bridge";
import type { PcscBackend } from "./pcsc/backend";
import { configFromEnv, readConfigFile, resolveConfig, type BridgeConfig } from "./config";
import { install, uninstall, openInBrowser, defaultInstallDeps, type InstallResult, type UninstallResult } from "./install";
import { Logbook } from "./logbook";
import { appDir, embeddedConfig, isSea, runningInstalled } from "./runtime";
import { join } from "node:path";

export const HELP = `dafke-eid ${VERSION}

Lokale brug tussen je kaartlezer en toegelaten websites.

Gebruik:
  dafke-eid [commando] [opties]

Commando's:
  serve                 Start de bridge (standaard, ook zonder commando)
  test                  Open de testpagina van de draaiende bridge in je browser
  readers               Toon de kaartlezers en of er een kaart in zit
  read                  Lees de eID in (persoonsgegevens worden gemaskeerd)
  diag                  Toon de ruwe PC/SC-toestand (zonder persoonsgegevens)
  install               Installeer voor deze gebruiker, met autostart en snelkoppeling
  uninstall             Verwijder de installatie

Opties voor serve:
  --port <poort>        Poort op 127.0.0.1 (standaard ${DEFAULT_BRIDGE_PORT}, of DAFKE_EID_PORT)
  --origin <patroon>    Toegelaten website, mag meermaals of met komma's
                        (standaard ${DEFAULT_ORIGINS.join(", ")}, of DAFKE_EID_ORIGINS)
                        Voorbeelden: https://app.voorbeeld.be, https://*.voorbeeld.be
  --auth-origin <patr.> Website die mag AANMELDEN met PIN (aparte lijst, standaard geen;
                        of DAFKE_EID_AUTH_ORIGINS). Mag meermaals of met komma's
  --token <geheim>      Elke aanvraag moet dit token meesturen (of DAFKE_EID_TOKEN)
  --no-testpage         Geen testpagina op http://127.0.0.1:<poort>/ (of DAFKE_EID_TESTPAGE=0)
  --log-file <pad>      Schrijf het logboek (zonder persoonsgegevens) naar dit bestand
  --config <pad>        Lees instellingen uit dit JSON-bestand

Opties voor install / uninstall:
  --port, --origin, --auth-origin, --token, --no-testpage   Bewaard in config.json
  --silent              Geen browser openen, niet wachten (voor IT-uitrol)
  --from-setup          (install, Windows) aangeroepen door de setup: geen eigen Apps-vermelding
  --keep-files          (uninstall) bestanden laten staan; alleen autostart en snelkoppeling weg

Opties voor read:
  --reader <naam>       Gebruik deze kaartlezer (standaard: de eerste met een kaart)
  --full                Toon alle gegevens, niet gemaskeerd
  --json                Toon alle gegevens als JSON (foto in base64)
  --no-photo            Lees de foto niet

Algemeen:
  --mock                Gebruik een virtuele lezer met voorbeeldkaart
  --debug               Toon technische fouten van de kaartlezer (PC/SC)
  -v, --version         Toon de versie
  -h, --help            Toon deze hulp
`;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Alleen bij `serve`: de draaiende bridge (stoppen met stop()). */
  server?: { bridge: Bridge; stop(): Promise<void> };
  /** Zo lang wachten voor het venster sluit (dubbelklik-installatie). */
  holdMs?: number;
}

/** Alles wat het systeem raakt, vervangbaar in tests. */
export interface SystemDeps {
  isSea(): boolean;
  runningInstalled(): boolean;
  appDir(): string;
  embedded(): BridgeConfig;
  install(config: BridgeConfig, embedded: BridgeConfig, options?: { fromSetup?: boolean }): Promise<InstallResult>;
  uninstall(options?: { keepFiles?: boolean }): Promise<UninstallResult>;
  isRunning(port: number): Promise<boolean>;
  openUrl(url: string): void;
}

export const defaultSystem: SystemDeps = {
  isSea,
  runningInstalled: () => runningInstalled(),
  appDir: () => appDir(),
  embedded: embeddedConfig,
  install: (config, embedded, options) => install({ config, embedded, ...options }),
  uninstall: (options) => uninstall(options),
  isRunning: (port) => defaultInstallDeps().isRunning(port),
  openUrl: (url) => openInBrowser(url),
};

export interface CliDeps {
  createReader(options: { mock: boolean; debug?: boolean; onError?: (error: unknown) => void }): Promise<EidReader>;
  createBackend?(options: { mock: boolean }): Promise<PcscBackend>;
  system?: Partial<SystemDeps>;
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
  async createReader({ mock, debug = false, onError: extra }) {
    const onError = (error: unknown) => {
      extra?.(error);
      if (debug) process.stderr.write(`[debug] ${error instanceof Error ? error.message : String(error)}\n`);
    };
    if (!mock) return createEidReader({ onError });
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
  port: number | undefined;
  origins: string[];
  authOrigins: string[];
  token: string | undefined;
  testpage: boolean | undefined;
  logFile: string | undefined;
  configFile: string | undefined;
  silent: boolean;
  fromSetup: boolean;
  keepFiles: boolean;
  version: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs | string {
  const args: ParsedArgs = { command: undefined, reader: undefined, full: false, json: false, photo: true, mock: false, debug: false, port: undefined, origins: [], authOrigins: [], token: undefined, testpage: undefined, logFile: undefined, configFile: undefined, silent: false, fromSetup: false, keepFiles: false, version: false, help: false };
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
      case "--no-testpage":
        args.testpage = false;
        break;
      case "--silent":
        args.silent = true;
        break;
      case "--from-setup":
        args.fromSetup = true;
        break;
      case "--keep-files":
        args.keepFiles = true;
        break;
      case "--log-file":
      case "--config": {
        const value = argv[++i];
        if (value === undefined || value.startsWith("--")) return `${arg} verwacht een pad`;
        if (arg === "--log-file") args.logFile = value;
        else args.configFile = value;
        break;
      }
      case "--reader": {
        const value = argv[++i];
        if (value === undefined || value.startsWith("--")) return "--reader verwacht een naam";
        args.reader = value;
        break;
      }
      case "--port": {
        const value = argv[++i];
        const port = Number(value);
        if (!value || !Number.isInteger(port) || port < 0 || port > 65535) return "--port verwacht een getal tussen 0 en 65535";
        args.port = port;
        break;
      }
      case "--origin":
      case "--auth-origin": {
        const value = argv[++i];
        if (value === undefined || value.startsWith("--")) return `${arg} verwacht een patroon`;
        (arg === "--origin" ? args.origins : args.authOrigins).push(...value.split(",").map((o) => o.trim()).filter(Boolean));
        break;
      }
      case "--token": {
        const value = argv[++i];
        if (value === undefined || value.startsWith("--")) return "--token verwacht een waarde";
        args.token = value;
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

/** Instellingen uit de opties op de opdrachtregel (alleen wat opgegeven werd). */
function configFromArgs(args: ParsedArgs): BridgeConfig {
  return {
    ...(args.port !== undefined ? { port: args.port } : {}),
    ...(args.origins.length > 0 ? { origins: args.origins } : {}),
    ...(args.authOrigins.length > 0 ? { authOrigins: args.authOrigins } : {}),
    ...(args.token !== undefined ? { token: args.token } : {}),
    ...(args.testpage !== undefined ? { testpage: args.testpage } : {}),
  };
}

function systemOf(deps: CliDeps): SystemDeps {
  return { ...defaultSystem, ...deps.system };
}

/** Alle lagen samen: opdrachtregel > omgeving > config.json > ingebakken > standaard. */
function loadConfig(args: ParsedArgs, env: Record<string, string | undefined>, sys: SystemDeps) {
  const installed = sys.isSea() && sys.runningInstalled();
  const configPath = args.configFile ?? (installed ? join(sys.appDir(), "config.json") : undefined);
  const file = configPath ? readConfigFile(configPath) : undefined;
  const config = resolveConfig(configFromArgs(args), configFromEnv(env), file, sys.embedded());
  const logFile = args.logFile ?? (installed ? join(sys.appDir(), "dafke-eid.log") : undefined);
  return { config, logFile };
}

async function serve(args: ParsedArgs, deps: CliDeps, env: Record<string, string | undefined>): Promise<CliResult> {
  const sys = systemOf(deps);
  let reader: EidReader | undefined;
  try {
    const { config, logFile } = loadConfig(args, env, sys);
    const logbook = new Logbook(logFile ? { file: logFile } : {});
    reader = await deps.createReader({
      mock: args.mock,
      debug: args.debug,
      onError: (error) => logbook.error(`Kaartlezer: ${error instanceof Error ? error.message : String(error)}`),
    });
    const bridge = await startBridge({
      reader,
      port: config.port,
      origins: config.origins,
      authOrigins: config.authOrigins,
      testpage: config.testpage,
      logbook,
      ...(config.token ? { token: config.token } : {}),
      ...(args.debug ? { onRequest: (r) => process.stderr.write(`[debug] ${r.method} ${r.path} ${r.status} ${r.ms}ms\n`) } : {}),
    });
    const opened = reader;
    const readers = opened.readers();
    const stdout =
      `dafke-eid ${VERSION} luistert op ${bridge.url}${args.mock ? " (virtuele lezer)" : ""}\n` +
      `Toegelaten websites: ${config.origins.join(", ")}\n` +
      (config.authOrigins.length > 0 ? `Aanmelden met PIN: ${config.authOrigins.join(", ")}\n` : "") +
      (config.token ? "Token: vereist\n" : "") +
      (config.testpage ? `Testpagina: ${bridge.url}/\n` : "") +
      (logFile ? `Logbestand: ${logFile}\n` : "") +
      `Kaartlezers: ${readers.map((r) => r.name).join(", ") || "(nog geen)"}\n` +
      "Stoppen met Ctrl+C.\n";
    return {
      code: 0,
      stdout,
      stderr: "",
      server: {
        bridge,
        async stop() {
          await bridge.close();
          await opened.close();
        },
      },
    };
  } catch (error) {
    await reader?.close();
    return errorResult(error);
  }
}

async function installCommand(args: ParsedArgs, deps: CliDeps, interactive: boolean): Promise<CliResult> {
  const sys = systemOf(deps);
  try {
    const result = await sys.install(configFromArgs(args), sys.embedded(), args.fromSetup ? { fromSetup: true } : undefined);
    let stdout =
      `${result.upgraded ? "DafkeDD eID bijgewerkt" : "DafkeDD eID geïnstalleerd"} (versie ${VERSION})\n` +
      `  Map:        ${result.paths.dir}\n` +
      `  Autostart:  aan (start mee met je computer)\n` +
      `  Testpagina: ${result.url}  (snelkoppeling "DafkeDD eID testen")\n`;
    if (!result.running) {
      return { code: 2, stdout, stderr: "Het programma is geïnstalleerd maar antwoordt (nog) niet. Kijk in het logbestand of open de testpagina later opnieuw.\n" };
    }
    stdout += "  Status:     draait\n";
    if (!args.silent) {
      sys.openUrl(result.url);
      stdout += "\nDe testpagina wordt geopend in je browser.\n";
      if (interactive) stdout += "Dit venster sluit vanzelf.\n";
    }
    return { code: 0, stdout, stderr: "", ...(interactive && !args.silent ? { holdMs: 8000 } : {}) };
  } catch (error) {
    return { ...errorResult(error), ...(interactive ? { holdMs: 30_000 } : {}) };
  }
}

async function uninstallCommand(args: ParsedArgs, deps: CliDeps): Promise<CliResult> {
  const sys = systemOf(deps);
  try {
    const result = await sys.uninstall(args.keepFiles ? { keepFiles: true } : undefined);
    const stdout = result.viaSetup
      ? "DafkeDD eID wordt verwijderd via het verwijderprogramma van de setup.\n"
      : args.keepFiles
        ? `Autostart en snelkoppeling van DafkeDD eID verwijderd (bestanden in ${result.paths.dir} blijven staan).\n`
        : `DafkeDD eID verwijderd uit ${result.paths.dir}${result.deferred ? " (de map verdwijnt binnen enkele seconden)" : ""}.\n`;
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return errorResult(error);
  }
}

async function testCommand(args: ParsedArgs, deps: CliDeps, env: Record<string, string | undefined>): Promise<CliResult> {
  const sys = systemOf(deps);
  try {
    const { config } = loadConfig(args, env, sys);
    const url = `http://127.0.0.1:${config.port}/`;
    if (!(await sys.isRunning(config.port))) {
      return { code: 1, stdout: "", stderr: `dafke-eid draait niet op ${url}. Start het programma (of installeer het) en probeer opnieuw.\n` };
    }
    if (!config.testpage) return { code: 1, stdout: "", stderr: "De testpagina staat uit (--no-testpage).\n" };
    sys.openUrl(url);
    return { code: 0, stdout: `Testpagina geopend: ${url}\n`, stderr: "" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function runCli(
  argv: readonly string[],
  deps: CliDeps = defaultDeps,
  env: Record<string, string | undefined> = process.env,
): Promise<CliResult> {
  const args = parseArgs(argv);
  if (typeof args === "string") return { code: 1, stdout: "", stderr: `${args}\n\n${HELP}` };
  if (args.version) return { code: 0, stdout: `${VERSION}\n`, stderr: "" };
  if (args.help) return { code: 0, stdout: HELP, stderr: "" };

  if (args.command === undefined) {
    const sys = systemOf(deps);
    // Dubbelklikken op het gedownloade programma = installeren.
    if (sys.isSea() && !sys.runningInstalled() && !args.mock) return installCommand(args, deps, true);
    return serve(args, deps, env);
  }
  if (args.command === "serve") return serve(args, deps, env);
  if (args.command === "install") return installCommand(args, deps, false);
  if (args.command === "uninstall") return uninstallCommand(args, deps);
  if (args.command === "test") return testCommand(args, deps, env);

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
  // Het zelfstandige programma heeft altijd dit bestand als ingang, ongeacht de bestandsnaam.
  if (isSea()) return true;
  const entry = process.argv[1];
  if (!entry) return false;
  return /(?:^|[\\/])(?:cli\.(?:js|ts)|dafke-eid(?:\.exe|\.cmd)?)$/.test(entry);
}

if (isMain()) {
  void runCli(process.argv.slice(2)).then((result) => {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.code;
    if (result.holdMs) setTimeout(() => process.exit(result.code), result.holdMs);
    const server = result.server;
    if (server) {
      const shutdown = () => {
        void server.stop().finally(() => process.exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }
  });
}
