/** De Windows-setup (installer/dafke-eid.iss) moet passen bij het programma en de workflows. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runCli } from "../../packages/eid/src/node/cli";
import { appDir } from "../../packages/eid/src/node/runtime";

const raw = readFileSync("installer/dafke-eid.iss");
const iss = raw.toString("utf8");
const setting = (name: string) => iss.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim();

describe("Windows-setup (Inno Setup)", () => {
  it("is UTF-8 met BOM (anders leest Inno Setup é en ü verkeerd)", () => {
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("installeert per gebruiker in dezelfde map als het losse programma", () => {
    expect(setting("PrivilegesRequired")).toBe("lowest");
    expect(setting("DefaultDirName")).toBe("{localappdata}\\DafkeDD\\eid");
    const dir = appDir({ LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, "win32", "C:\\Users\\x");
    expect(dir).toBe("C:\\Users\\x\\AppData\\Local\\DafkeDD\\eid");
    expect(iss).toContain('DestName: "dafke-eid.exe"');
  });

  it("roept alleen opties aan die de CLI kent", async () => {
    expect(iss).toContain("install --from-setup --silent");
    expect(iss).toContain("uninstall --keep-files --silent");
    for (const flag of ["--origin", "--auth-origin", "--token", "--port", "--no-testpage"]) expect(iss).toContain(flag);
    const help = (await runCli(["--help"])).stdout;
    expect(help).toContain("--from-setup");
    expect(help).toContain("--keep-files");
  });

  it("gebruikt dezelfde AppId en bestandsnaam als CI en de release", () => {
    const appId = iss.match(/^AppId=\{\{([0-9A-F-]{36})\}/m)?.[1];
    expect(appId).toBeDefined();
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const release = readFileSync(".github/workflows/release.yml", "utf8");
    expect(ci).toContain(`{${appId}}_is1`);
    expect(setting("OutputBaseFilename")).toBe("dafke-eid-setup-windows-x64");
    expect(ci).toContain("dafke-eid-setup-windows-x64.exe");
    expect(release).toContain("dafke-eid-setup-windows-x64.exe");
  });

  it("schrijft standaard geen setup-logboek (de opdrachtregel kan /TOKEN bevatten)", () => {
    expect(setting("SetupLogging")).toBe("no");
  });
});
