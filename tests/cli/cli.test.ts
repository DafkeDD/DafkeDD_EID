import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runCli } from "../../packages/eid/src/node/cli";

const { version } = JSON.parse(readFileSync("packages/eid/package.json", "utf8")) as { version: string };

describe("dafke-eid CLI", () => {
  it("--version en -v tonen de versie uit package.json", () => {
    expect(runCli(["--version"])).toEqual({ code: 0, stdout: `${version}\n`, stderr: "" });
    expect(runCli(["-v"]).stdout).toBe(`${version}\n`);
  });

  it("--help en zonder argumenten tonen de hulp", () => {
    expect(runCli(["--help"]).stdout).toContain("dafke-eid");
    expect(runCli([]).code).toBe(0);
  });

  it("onbekende optie geeft exitcode 1 en een melding op stderr", () => {
    const result = runCli(["--bestaat-niet"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Onbekende optie: --bestaat-niet");
  });
});
