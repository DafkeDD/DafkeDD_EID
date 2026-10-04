import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configFromEnv, normalizeConfig, readConfigFile, resolveConfig, writeConfigFile } from "../../packages/eid/src/node/config";
import { appDir, embeddedConfig, exeName, isSea, runningInstalled } from "../../packages/eid/src/node/runtime";

describe("config", () => {
  it("standaardwaarden", () => {
    expect(resolveConfig()).toEqual({
      port: 47820,
      origins: ["http://localhost:*", "http://127.0.0.1:*"],
      authOrigins: [],
      token: undefined,
      testpage: true,
    });
  });

  it("eerste laag die een instelling heeft, wint (per instelling)", () => {
    expect(resolveConfig({ port: 1 }, { port: 2, origins: ["https://a.be"] }, { token: "t", testpage: false, authOrigins: ["https://sso.be"] })).toEqual({
      port: 1,
      origins: ["https://a.be"],
      authOrigins: ["https://sso.be"],
      token: "t",
      testpage: false,
    });
  });

  it("leest omgevingsvariabelen", () => {
    expect(configFromEnv({ DAFKE_EID_PORT: "5000", DAFKE_EID_ORIGINS: "https://a.be, https://b.be", DAFKE_EID_TOKEN: "x", DAFKE_EID_TESTPAGE: "0" })).toEqual({
      port: 5000,
      origins: ["https://a.be", "https://b.be"],
      token: "x",
      testpage: false,
    });
    expect(configFromEnv({})).toEqual({});
    expect(configFromEnv({ DAFKE_EID_AUTH_ORIGINS: "https://sso.be" })).toEqual({ authOrigins: ["https://sso.be"] });
    expect(() => normalizeConfig({ authOrigins: [1] }, "x")).toThrow(/authOrigins/);
    expect(() => configFromEnv({ DAFKE_EID_PORT: "x" })).toThrow(/DAFKE_EID_PORT/);
  });

  it("schrijft en leest config.json (ook met BOM), en weigert rommel", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const file = join(dir, "sub", "config.json");
    expect(readConfigFile(file)).toBeUndefined();
    writeConfigFile(file, { origins: ["https://a.be"], testpage: false });
    expect(readConfigFile(file)).toEqual({ origins: ["https://a.be"], testpage: false });
    writeFileSync(file, "\uFEFF" + JSON.stringify({ port: 1234 }));
    expect(readConfigFile(file)).toEqual({ port: 1234 });
    writeFileSync(file, "{kapot");
    expect(() => readConfigFile(file)).toThrow(/geen geldige JSON/);
    expect(() => normalizeConfig({ port: "80" }, "x")).toThrow(/port/);
    expect(() => normalizeConfig({ origins: "https://a.be" }, "x")).toThrow(/origins/);
    expect(() => normalizeConfig({ testpage: "nee" }, "x")).toThrow(/testpage/);
    expect(() => normalizeConfig([], "x")).toThrow(/object/);
  });
});

describe("runtime", () => {
  it("kiest per platform de juiste installatiemap", () => {
    expect(appDir({ LOCALAPPDATA: "C:\\Users\\Jan\\AppData\\Local" }, "win32")).toBe("C:\\Users\\Jan\\AppData\\Local\\DafkeDD\\eid");
    expect(appDir({ HOME: "/Users/jan" }, "darwin")).toBe("/Users/jan/Library/Application Support/DafkeDD/eid");
    expect(appDir({ HOME: "/home/jan" }, "linux")).toBe("/home/jan/.local/share/dafkedd/eid");
    expect(appDir({ HOME: "/home/jan", XDG_DATA_HOME: "/data" }, "linux")).toBe("/data/dafkedd/eid");
  });

  it("weet buiten een zelfstandig programma dat het geen SEA is", () => {
    expect(isSea()).toBe(false);
    expect(embeddedConfig()).toEqual({});
    expect(exeName("win32")).toBe("dafke-eid.exe");
    expect(exeName("darwin")).toBe("dafke-eid");
    expect(runningInstalled("/x/dafkedd/eid/dafke-eid", "/x/dafkedd/eid")).toBe(true);
    expect(runningInstalled("/tmp/dafke-eid", "/x/dafkedd/eid")).toBe(false);
  });
});
