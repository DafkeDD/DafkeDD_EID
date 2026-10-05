import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  install,
  installPaths,
  linuxUnit,
  macLaunchAgent,
  macWebloc,
  RUN_KEY,
  SETUP_UNINSTALLER,
  UNINSTALL_KEY,
  uninstall,
  windowsLauncher,
  windowsUrlShortcut,
  type InstallDeps,
} from "../../packages/eid/src/node/install";

const config = (files: Map<string, string>, path: string) => JSON.parse(files.get(path) ?? "null");

/** Neppe omgeving: echte bestanden in een tijdelijke map, commando's worden alleen opgeschreven. */
function fakeDeps(platform: NodeJS.Platform, options: { running?: boolean; failRun?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), `install-${platform}-`));
  const source = join(root, "download", platform === "win32" ? "dafke-eid-windows-x64.exe" : "dafke-eid-macos-arm64");
  const files = new Map<string, string>();
  const runs: string[] = [];
  const spawned: string[] = [];
  const env: NodeJS.ProcessEnv =
    platform === "win32" ? { LOCALAPPDATA: join(root, "Local"), APPDATA: join(root, "Roaming") } : { HOME: join(root, "home") };
  const deps: InstallDeps = {
    platform,
    env,
    home: join(root, "home"),
    uid: 501,
    pid: 4242,
    execPath: source,
    fs: {
      exists: (p) => files.has(p),
      readFile: (p) => files.get(p),
      mkdir: () => {},
      copyFile: (from, to) => files.set(to, `kopie van ${from}`),
      writeFile: (p, c) => files.set(p, c),
      chmod: () => {},
      rm: (p) => {
        for (const key of [...files.keys()]) if (key === p || key.startsWith(p)) files.delete(key);
      },
    },
    run: async (command, args) => {
      const line = [command, ...args].join(" ");
      runs.push(line);
      return options.failRun && line.includes(options.failRun) ? 1 : 0;
    },
    spawnDetached: (command, args) => spawned.push([command, ...args].join(" ")),
    isRunning: async () => options.running ?? true,
    sleep: async () => {},
  };
  return { deps, files, runs, spawned, root };
}

describe("installeren op Windows", () => {
  it("kopieert het programma, schrijft starter + snelkoppeling + config en registreert autostart en Apps", async () => {
    const { deps, files, runs, spawned } = fakeDeps("win32");
    const result = await install({ config: { origins: ["https://app.voorbeeld.be"] } }, deps);
    const paths = installPaths(deps);
    expect(paths.dir.endsWith("Local\\DafkeDD\\eid")).toBe(true);
    expect(result).toMatchObject({ url: "http://127.0.0.1:47820/", running: true, upgraded: false });
    expect(files.get(paths.exe)).toContain("dafke-eid-windows-x64.exe");
    expect(files.get(paths.autostart)).toBe(windowsLauncher(paths.exe));
    expect(files.get(paths.shortcut)).toBe(windowsUrlShortcut("http://127.0.0.1:47820/"));
    expect(paths.shortcut).toContain("Start Menu\\Programs\\DafkeDD eID testen.url");
    expect(config(files, paths.config)).toEqual({ origins: ["https://app.voorbeeld.be"] });
    expect(runs[0]).toContain("taskkill /F /FI IMAGENAME eq dafke-eid.exe /FI PID ne 4242");
    expect(runs).toContainEqual(expect.stringContaining(`reg add ${RUN_KEY} /v DafkeDD eID /t REG_SZ /d wscript.exe //E:jscript //B "${paths.autostart}"`));
    expect(runs).toContainEqual(expect.stringContaining(`reg add ${UNINSTALL_KEY} /v UninstallString /t REG_SZ /d "${paths.exe}" uninstall`));
    expect(spawned).toEqual([`wscript.exe //E:jscript //B ${paths.autostart}`]);
  });

  it("behoudt bij een update de bestaande instellingen, tenzij nieuwe opgegeven worden", async () => {
    const { deps, files } = fakeDeps("win32");
    await install({ config: { origins: ["https://a.be"], port: 48000 } }, deps);
    const update = await install({ embedded: { origins: ["https://ingebakken.be"] } }, deps);
    expect(update.upgraded).toBe(true);
    expect(update.url).toBe("http://127.0.0.1:48000/");
    expect(config(files, installPaths(deps).config)).toEqual({ origins: ["https://a.be"], port: 48000 });
    await install({ config: { origins: ["https://b.be"] } }, deps);
    expect(config(files, installPaths(deps).config)).toEqual({ origins: ["https://b.be"], port: 48000 });
  });

  it("gebruikt ingebakken instellingen bij een eerste installatie", async () => {
    const { deps, files } = fakeDeps("win32");
    await install({ embedded: { origins: ["https://ingebakken.be"], token: "t" } }, deps);
    expect(config(files, installPaths(deps).config)).toEqual({ origins: ["https://ingebakken.be"], token: "t" });
  });

  it("meldt als de autostart niet geregistreerd kan worden", async () => {
    const { deps } = fakeDeps("win32", { failRun: "CurrentVersion\\Run" });
    await expect(install({}, deps)).rejects.toThrow(/Autostart registreren mislukt/);
  });

  it("meldt running: false als de bridge niet antwoordt", async () => {
    const { deps } = fakeDeps("win32", { running: false });
    expect((await install({}, deps)).running).toBe(false);
  });

  it("verwijdert alles; draait het programma vanuit de map, dan later", async () => {
    const { deps, files, runs, spawned } = fakeDeps("win32");
    await install({}, deps);
    const paths = installPaths(deps);
    const result = await uninstall({}, { ...deps, execPath: paths.exe });
    expect(result.deferred).toBe(true);
    expect(runs).toContainEqual(`reg delete ${RUN_KEY} /v DafkeDD eID /f`);
    expect(runs).toContainEqual(`reg delete ${UNINSTALL_KEY} /f`);
    expect(files.has(paths.shortcut)).toBe(false);
    expect(spawned.at(-1)).toContain(`rmdir /s /q "${paths.dir}"`);
  });
});

describe("Windows-setup (Inno Setup)", () => {
  it("install --from-setup schrijft geen eigen Apps-vermelding en ruimt een oude op", async () => {
    const { deps, files, runs, spawned } = fakeDeps("win32");
    const paths = installPaths(deps);
    const result = await install({ fromSetup: true }, { ...deps, execPath: paths.exe });
    expect(result.fromSetup).toBe(true);
    expect(runs.some((r) => r.startsWith(`reg add ${UNINSTALL_KEY}`))).toBe(false);
    expect(runs).toContainEqual(`reg delete ${UNINSTALL_KEY} /f`);
    // Autostart, snelkoppeling en config doet het programma wel zelf.
    expect(runs).toContainEqual(expect.stringContaining(`reg add ${RUN_KEY}`));
    expect(files.has(paths.shortcut)).toBe(true);
    expect(files.has(paths.config)).toBe(true);
    expect(spawned).toEqual([`wscript.exe //E:jscript //B ${paths.autostart}`]);
  });

  it("herkent een setup-installatie aan unins000.exe, ook bij het losse programma", async () => {
    const { deps, files, runs } = fakeDeps("win32");
    const paths = installPaths(deps);
    files.set(`${paths.dir}\\${SETUP_UNINSTALLER}`, "inno");
    const result = await install({}, deps);
    expect(result.fromSetup).toBe(true);
    expect(runs.some((r) => r.startsWith(`reg add ${UNINSTALL_KEY}`))).toBe(false);
  });

  it("uninstall --keep-files laat de bestanden staan (de setup verwijdert ze)", async () => {
    const { deps, files, runs, spawned } = fakeDeps("win32");
    await install({}, deps);
    const paths = installPaths(deps);
    files.set(`${paths.dir}\\${SETUP_UNINSTALLER}`, "inno");
    spawned.length = 0;
    const result = await uninstall({ keepFiles: true }, { ...deps, execPath: paths.exe });
    expect(result).toMatchObject({ deferred: false, viaSetup: false });
    expect(runs).toContainEqual(`reg delete ${RUN_KEY} /v DafkeDD eID /f`);
    expect(files.has(paths.shortcut)).toBe(false);
    expect(files.has(paths.autostart)).toBe(false);
    expect(files.has(paths.exe)).toBe(true);
    expect(files.has(paths.config)).toBe(true);
    expect(spawned).toEqual([]);
  });

  it("uninstall zonder --keep-files geeft door aan het verwijderprogramma van de setup", async () => {
    const { deps, files, runs, spawned } = fakeDeps("win32");
    await install({}, deps);
    const paths = installPaths(deps);
    files.set(`${paths.dir}\\${SETUP_UNINSTALLER}`, "inno");
    runs.length = 0;
    spawned.length = 0;
    const result = await uninstall({}, deps);
    expect(result.viaSetup).toBe(true);
    expect(spawned).toEqual([`${paths.dir}\\${SETUP_UNINSTALLER} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`]);
    expect(runs).toEqual([]);
    expect(files.has(paths.exe)).toBe(true);
  });
});

describe("installeren op macOS", () => {
  it("schrijft LaunchAgent en webloc en laadt de agent", async () => {
    const { deps, files, runs } = fakeDeps("darwin");
    await install({}, deps);
    const paths = installPaths(deps);
    expect(paths.dir.endsWith("/Library/Application Support/DafkeDD/eid")).toBe(true);
    expect(files.get(paths.autostart)).toBe(macLaunchAgent(paths.exe));
    expect(files.get(paths.autostart)).toContain("<string>serve</string>");
    expect(files.get(paths.shortcut)).toBe(macWebloc("http://127.0.0.1:47820/"));
    expect(runs).toEqual([
      "launchctl bootout gui/501/be.dafkedd.eid",
      `xattr -d com.apple.quarantine ${paths.exe}`,
      `launchctl bootstrap gui/501 ${paths.autostart}`,
    ]);
  });

  it("verwijdert agent, snelkoppeling en map", async () => {
    const { deps, files } = fakeDeps("darwin");
    await install({}, deps);
    const paths = installPaths(deps);
    await uninstall({}, deps);
    expect(files.has(paths.autostart)).toBe(false);
    expect(files.has(paths.shortcut)).toBe(false);
    expect(files.has(paths.exe)).toBe(false);
  });

  it("escapet XML in paden", () => {
    expect(macLaunchAgent("/Users/a&b/x")).toContain("/Users/a&amp;b/x");
  });
});

describe("installeren op Linux", () => {
  it("schrijft een systemd-gebruikersdienst en start die", async () => {
    const { deps, files, runs } = fakeDeps("linux");
    await install({}, deps);
    const paths = installPaths(deps);
    expect(files.get(paths.autostart)).toBe(linuxUnit(paths.exe));
    expect(runs).toContain("systemctl --user enable --now dafkedd-eid.service");
    expect(files.get(paths.shortcut)).toContain("URL=http://127.0.0.1:47820/");
  });
});

describe("JScript-starter", () => {
  it("start het programma verborgen en escapet het pad correct", () => {
    const exe = 'C:\\Users\\Jan "X"\\dafke-eid.exe';
    const script = windowsLauncher(exe);
    expect(script).toContain(`shell.Run(${JSON.stringify(`"${exe}" serve`)}, 0, false);`);
    expect(script).not.toContain("\n\n");
  });

  it("schrijft niets buiten de neppe omgeving", async () => {
    const { deps } = fakeDeps("win32");
    await install({}, deps);
    expect(existsSync(installPaths(deps).config)).toBe(false);
  });
});
