/**
 * Het programma installeren per gebruiker (geen administratorrechten), met autostart en een
 * snelkoppeling "DafkeDD eID testen" naar de testpagina.
 *
 * | Platform | Map                                        | Autostart                                                   | Snelkoppeling                                    |
 * |----------|--------------------------------------------|-------------------------------------------------------------|--------------------------------------------------|
 * | Windows  | %LOCALAPPDATA%\DafkeDD\eid                 | HKCU\…\Run → wscript start-hidden.js (geen consolevenster)  | Start-menu: DafkeDD eID testen.url + Apps-vermelding |
 * | macOS    | ~/Library/Application Support/DafkeDD/eid  | LaunchAgent ~/Library/LaunchAgents/be.dafkedd.eid.plist     | ~/Applications/DafkeDD eID testen.webloc         |
 * | Linux    | ~/.local/share/dafkedd/eid                 | systemd-gebruikersdienst dafkedd-eid.service                | ~/.local/share/applications/dafkedd-eid-testen.desktop |
 *
 * Alles wat het systeem aanraakt gaat via `InstallDeps`, zodat het zonder echte installatie te testen is.
 */
import { spawn, execFile } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { EidError } from "../core";
import { VERSION } from "../version";
import { normalizeConfig, resolveConfig, type BridgeConfig } from "./config";
import { appDir, exeName } from "./runtime";

export const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const RUN_VALUE = "DafkeDD eID";
export const UNINSTALL_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DafkeDD-eID";
export const LAUNCH_AGENT_LABEL = "be.dafkedd.eid";
export const SYSTEMD_UNIT = "dafkedd-eid.service";
export const SHORTCUT_NAME = "DafkeDD eID testen";

export interface InstallPaths {
  dir: string;
  exe: string;
  config: string;
  log: string;
  /** Windows: JScript-starter; macOS: plist; Linux: systemd-unit. */
  autostart: string;
  shortcut: string;
}

export interface InstallDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  uid: number;
  pid: number;
  execPath: string;
  fs: {
    exists(path: string): boolean;
    /** Inhoud als tekst, of `undefined` als het bestand niet bestaat. */
    readFile(path: string): string | undefined;
    mkdir(path: string): void;
    copyFile(from: string, to: string): void;
    writeFile(path: string, content: string): void;
    chmod(path: string, mode: number): void;
    rm(path: string): void;
  };
  /** Voert een commando uit en geeft de exitcode. */
  run(command: string, args: string[]): Promise<number>;
  /** Start een proces los van dit proces, zonder venster. */
  spawnDetached(command: string, args: string[]): void;
  /** Antwoordt de bridge op deze poort? */
  isRunning(port: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}

export function defaultInstallDeps(): InstallDeps {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    uid: typeof process.getuid === "function" ? process.getuid() : 0,
    pid: process.pid,
    execPath: process.execPath,
    fs: {
      exists: existsSync,
      readFile: (p) => {
        try {
          return readFileSync(p, "utf8");
        } catch {
          return undefined;
        }
      },
      mkdir: (p) => mkdirSync(p, { recursive: true }),
      copyFile: copyFileSync,
      writeFile: (p, c) => writeFileSync(p, c, "utf8"),
      chmod: chmodSync,
      rm: (p) => rmSync(p, { recursive: true, force: true }),
    },
    run: (command, args) =>
      new Promise((resolve) => {
        execFile(command, args, { windowsHide: true }, (error) => {
          const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0;
          resolve(code);
        });
      }),
    spawnDetached: (command, args) => {
      spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
    },
    isRunning: async (port) => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/v1/status`, { signal: AbortSignal.timeout(1000) });
        return res.ok && ((await res.json()) as { name?: string }).name === "dafke-eid";
      } catch {
        return false;
      }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

export function installPaths(deps: Pick<InstallDeps, "platform" | "env" | "home">): InstallPaths {
  const { platform, env, home } = deps;
  const dir = appDir(env, platform, home);
  const path = platform === "win32" ? win32 : posix;
  const exe = path.join(dir, exeName(platform));
  const base = { dir, exe, config: path.join(dir, "config.json"), log: path.join(dir, "dafke-eid.log") };
  if (platform === "win32") {
    const roaming = env.APPDATA ?? win32.join(env.USERPROFILE ?? home, "AppData", "Roaming");
    return {
      ...base,
      autostart: win32.join(dir, "start-hidden.js"),
      shortcut: win32.join(roaming, "Microsoft", "Windows", "Start Menu", "Programs", `${SHORTCUT_NAME}.url`),
    };
  }
  const h = env.HOME ?? home;
  if (platform === "darwin") {
    return {
      ...base,
      autostart: posix.join(h, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`),
      shortcut: posix.join(h, "Applications", `${SHORTCUT_NAME}.webloc`),
    };
  }
  return {
    ...base,
    autostart: posix.join(env.XDG_CONFIG_HOME ?? posix.join(h, ".config"), "systemd", "user", SYSTEMD_UNIT),
    shortcut: posix.join(env.XDG_DATA_HOME ?? posix.join(h, ".local", "share"), "applications", "dafkedd-eid-testen.desktop"),
  };
}

// --- bestanden die we schrijven (zuivere functies, getest) ---

/** JScript (geen VBScript: dat wordt uitgefaseerd) dat het programma zonder venster start. */
export function windowsLauncher(exe: string): string {
  return [
    "// Start DafkeDD eID zonder consolevenster. Gemaakt door dafke-eid install.",
    'var shell = new ActiveXObject("WScript.Shell");',
    `shell.Run(${JSON.stringify(`"${exe}" serve`)}, 0, false);`,
    "",
  ].join("\r\n");
}

export function windowsUrlShortcut(url: string): string {
  return `[InternetShortcut]\r\nURL=${url}\r\n`;
}

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function macLaunchAgent(exe: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(exe)}</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>/dev/null</string>
</dict>
</plist>
`;
}

export function macWebloc(url: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>URL</key>
  <string>${xml(url)}</string>
</dict>
</plist>
`;
}

export function linuxUnit(exe: string): string {
  return `[Unit]
Description=DafkeDD eID (eID-lezer voor websites)

[Service]
ExecStart="${exe}" serve
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

export function linuxDesktopLink(url: string): string {
  return `[Desktop Entry]\nType=Link\nName=${SHORTCUT_NAME}\nURL=${url}\nIcon=web-browser\n`;
}

// --- installeren en verwijderen ---

export interface InstallOptions {
  /** Overschrijft de bewaarde instellingen (config.json); niet opgegeven = behouden. */
  config?: BridgeConfig;
  /** Ingebakken instellingen als basis bij een eerste installatie. */
  embedded?: BridgeConfig;
}

export interface InstallResult {
  paths: InstallPaths;
  url: string;
  running: boolean;
  upgraded: boolean;
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Stopt een draaiende bridge (niet dit proces zelf). */
export async function stopRunning(deps: InstallDeps): Promise<void> {
  if (deps.platform === "win32") {
    await deps.run("taskkill", ["/F", "/FI", `IMAGENAME eq ${exeName("win32")}`, "/FI", `PID ne ${deps.pid}`]);
  } else if (deps.platform === "darwin") {
    await deps.run("launchctl", ["bootout", `gui/${deps.uid}/${LAUNCH_AGENT_LABEL}`]);
  } else {
    await deps.run("systemctl", ["--user", "stop", SYSTEMD_UNIT]);
  }
}

export async function install(options: InstallOptions = {}, deps: InstallDeps = defaultInstallDeps()): Promise<InstallResult> {
  const paths = installPaths(deps);
  const upgraded = deps.fs.exists(paths.exe);

  // Instellingen: nieuw opgegeven > bestaande config.json > ingebakken.
  const existingText = upgraded ? deps.fs.readFile(paths.config) : undefined;
  let existing: BridgeConfig | undefined;
  try {
    existing = existingText ? normalizeConfig(JSON.parse(existingText.replace(/^\uFEFF/, "")), paths.config) : undefined;
  } catch {
    existing = undefined; // kapotte config.json: opnieuw beginnen met de nieuwe/ingebakken instellingen
  }
  const merged = normalizeConfig({ ...options.embedded, ...existing, ...options.config }, "instellingen");
  const resolved = resolveConfig(merged);
  const url = `http://127.0.0.1:${resolved.port}/`;

  await stopRunning(deps);

  deps.fs.mkdir(paths.dir);
  if (!samePath(deps.execPath, paths.exe, deps.platform)) {
    // Bij een update kan het oude programma nog even vastzitten: een paar keer proberen.
    for (let attempt = 0; ; attempt++) {
      try {
        deps.fs.copyFile(deps.execPath, paths.exe);
        break;
      } catch (error) {
        if (attempt >= 10) throw new EidError("internal", `Kan ${paths.exe} niet schrijven. Draait het programma nog?`, { cause: error });
        await deps.sleep(300);
      }
    }
  }
  if (deps.platform !== "win32") deps.fs.chmod(paths.exe, 0o755);
  deps.fs.writeFile(paths.config, JSON.stringify(merged, null, 2) + "\n");

  if (deps.platform === "win32") {
    deps.fs.writeFile(paths.autostart, windowsLauncher(paths.exe));
    const launcher = ["//E:jscript", "//B", paths.autostart];
    const runValue = `wscript.exe ${launcher.slice(0, 2).join(" ")} "${paths.autostart}"`;
    const code = await deps.run("reg", ["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", runValue, "/f"]);
    if (code !== 0) throw new EidError("internal", `Autostart registreren mislukt (reg.exe, code ${code})`);
    deps.fs.mkdir(win32.dirname(paths.shortcut));
    deps.fs.writeFile(paths.shortcut, windowsUrlShortcut(url));
    // Vermelding in Instellingen → Apps, met een knop Verwijderen.
    const values: Array<[string, string, string]> = [
      ["DisplayName", "REG_SZ", "DafkeDD eID"],
      ["DisplayVersion", "REG_SZ", VERSION],
      ["Publisher", "REG_SZ", "DafkeDD"],
      ["InstallLocation", "REG_SZ", paths.dir],
      ["DisplayIcon", "REG_SZ", paths.exe],
      ["UninstallString", "REG_SZ", `"${paths.exe}" uninstall`],
      ["QuietUninstallString", "REG_SZ", `"${paths.exe}" uninstall --silent`],
      ["NoModify", "REG_DWORD", "1"],
      ["NoRepair", "REG_DWORD", "1"],
    ];
    for (const [name, type, data] of values) await deps.run("reg", ["add", UNINSTALL_KEY, "/v", name, "/t", type, "/d", data, "/f"]);
    deps.spawnDetached("wscript.exe", launcher);
  } else if (deps.platform === "darwin") {
    await deps.run("xattr", ["-d", "com.apple.quarantine", paths.exe]);
    deps.fs.mkdir(posix.dirname(paths.autostart));
    deps.fs.writeFile(paths.autostart, macLaunchAgent(paths.exe));
    deps.fs.mkdir(posix.dirname(paths.shortcut));
    deps.fs.writeFile(paths.shortcut, macWebloc(url));
    const code = await deps.run("launchctl", ["bootstrap", `gui/${deps.uid}`, paths.autostart]);
    if (code !== 0) throw new EidError("internal", `LaunchAgent laden mislukt (launchctl, code ${code})`);
  } else {
    deps.fs.mkdir(posix.dirname(paths.autostart));
    deps.fs.writeFile(paths.autostart, linuxUnit(paths.exe));
    deps.fs.mkdir(posix.dirname(paths.shortcut));
    deps.fs.writeFile(paths.shortcut, linuxDesktopLink(url));
    await deps.run("systemctl", ["--user", "daemon-reload"]);
    const code = await deps.run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT]);
    if (code !== 0) throw new EidError("internal", `systemd-dienst starten mislukt (systemctl, code ${code})`);
  }

  // Wachten tot de bridge antwoordt (max. ±10 s).
  let running = false;
  for (let i = 0; i < 20 && !running; i++) {
    running = await deps.isRunning(resolved.port);
    if (!running) await deps.sleep(500);
  }
  return { paths, url, running, upgraded };
}

export interface UninstallResult {
  paths: InstallPaths;
  /** Windows: de map wordt pas na het afsluiten van dit programma verwijderd. */
  deferred: boolean;
}

export async function uninstall(deps: InstallDeps = defaultInstallDeps()): Promise<UninstallResult> {
  const paths = installPaths(deps);
  await stopRunning(deps);
  let deferred = false;

  if (deps.platform === "win32") {
    await deps.run("reg", ["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]);
    await deps.run("reg", ["delete", UNINSTALL_KEY, "/f"]);
    deps.fs.rm(paths.shortcut);
    if (samePath(deps.execPath, paths.exe, "win32")) {
      // Een draaiend programma kan zichzelf niet verwijderen: even wachten en dan de map wissen.
      deps.spawnDetached("cmd.exe", ["/d", "/c", `ping 127.0.0.1 -n 3 > nul & rmdir /s /q "${paths.dir}"`]);
      deferred = true;
    } else {
      deps.fs.rm(paths.dir);
    }
  } else if (deps.platform === "darwin") {
    deps.fs.rm(paths.autostart);
    deps.fs.rm(paths.shortcut);
    deps.fs.rm(paths.dir);
  } else {
    await deps.run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT]);
    deps.fs.rm(paths.autostart);
    await deps.run("systemctl", ["--user", "daemon-reload"]);
    deps.fs.rm(paths.shortcut);
    deps.fs.rm(paths.dir);
  }
  return { paths, deferred };
}

/** Opent een adres in de standaardbrowser. */
export function openInBrowser(url: string, deps: Pick<InstallDeps, "platform" | "spawnDetached"> = defaultInstallDeps()): void {
  if (deps.platform === "win32") deps.spawnDetached("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
  else if (deps.platform === "darwin") deps.spawnDetached("open", [url]);
  else deps.spawnDetached("xdg-open", [url]);
}
