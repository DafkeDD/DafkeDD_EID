/**
 * `dafke-eid` — de bridge als commando.
 * Fase 1: alleen --version en --help. De server zelf komt in fase 4.
 */
import { VERSION } from "../version";

export const HELP = `dafke-eid ${VERSION}

Lokale brug tussen je kaartlezer en toegelaten websites.

Gebruik:
  dafke-eid [opties]

Opties:
  -v, --version   Toon de versie
  -h, --help      Toon deze hulp
`;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Puur en testbaar: geeft terug wat er geprint moet worden in plaats van zelf te printen. */
export function runCli(argv: readonly string[]): CliResult {
  const [first] = argv;
  if (first === "-v" || first === "--version") return { code: 0, stdout: `${VERSION}\n`, stderr: "" };
  if (first === undefined || first === "-h" || first === "--help") return { code: 0, stdout: HELP, stderr: "" };
  return { code: 1, stdout: "", stderr: `Onbekende optie: ${first}\n\n${HELP}` };
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return /(?:^|[\\/])(?:cli\.(?:js|ts)|dafke-eid(?:\.exe|\.cmd)?)$/.test(entry);
}

if (isMain()) {
  const result = runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
