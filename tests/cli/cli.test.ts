import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSampleCard } from "../../packages/eid/src/mock";
import { maskWord, MOCK_READER_NAME, runCli } from "../../packages/eid/src/node/cli";
import { createEidReader, MockPcscBackend } from "../../packages/eid/src/node";

const { version } = JSON.parse(readFileSync("packages/eid/package.json", "utf8")) as { version: string };

describe("dafke-eid CLI", () => {
  it("--version en -v tonen de versie uit package.json", async () => {
    expect(await runCli(["--version"])).toEqual({ code: 0, stdout: `${version}\n`, stderr: "" });
    expect((await runCli(["-v"])).stdout).toBe(`${version}\n`);
  });

  it("--help toont de hulp", async () => {
    const { code, stdout } = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("serve");
    expect(stdout).toContain("--origin");
  });

  it("onbekende optie of commando geeft exitcode 1", async () => {
    const option = await runCli(["--bestaat-niet"]);
    expect(option.code).toBe(1);
    expect(option.stderr).toContain("Onbekende optie: --bestaat-niet");
    expect((await runCli(["vliegen"])).stderr).toContain("Onbekend commando: vliegen");
    expect((await runCli(["read", "--reader"])).stderr).toContain("--reader verwacht een naam");
  });

  it("readers toont de virtuele lezer met kaart", async () => {
    const result = await runCli(["readers", "--mock"]);
    expect(result).toEqual({ code: 0, stdout: `[kaart] ${MOCK_READER_NAME}\n`, stderr: "" });
  });

  it("read maskeert persoonsgegevens standaard", async () => {
    const { code, stdout } = await runCli(["read", "--mock"]);
    expect(code).toBe(0);
    expect(stdout).toContain("S*******, J** P*****");
    expect(stdout).toContain("85.03.15-***.**");
    expect(stdout).toContain("Geboortejaar:     1985");
    expect(stdout).toContain("***, 9000 Gent");
    expect(stdout).not.toContain("Specimen");
    expect(stdout).not.toContain("Voorbeeldstraat");
    expect(stdout).not.toContain("85031512369");
    expect(stdout).toContain("Applet:           1.8");
  });

  it("read --full toont alles", async () => {
    const { stdout } = await runCli(["read", "--mock", "--full"]);
    expect(stdout).toContain("Specimen, Jan Pieter K");
    expect(stdout).toContain("85.03.15-123.69");
    expect(stdout).toContain("Voorbeeldstraat 12 bus 3, 9000 Gent");
  });

  it("read --json geeft JSON met de foto in base64", async () => {
    const { stdout } = await runCli(["read", "--mock", "--json"]);
    const json = JSON.parse(stdout);
    expect(json.reader).toBe(MOCK_READER_NAME);
    expect(json.identity.nationalNumber).toBe("85031512369");
    expect(typeof json.photo.data).toBe("string");
  });

  it("read zonder kaart geeft een duidelijke fout en exitcode 2", async () => {
    const result = await runCli(["read"], {
      createReader: () => createEidReader({ backend: new MockPcscBackend().addReader("Lege lezer") }),
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Fout (no-card)");
  });

  it("read zonder lezer geeft no-reader", async () => {
    const result = await runCli(["read"], { createReader: () => createEidReader({ backend: new MockPcscBackend() }) });
    expect(result.stderr).toContain("Fout (no-reader)");
  });

  it("read --reader kiest een specifieke lezer", async () => {
    const backend = new MockPcscBackend().addReader("A").addReader("B");
    backend.insertCard("B", await createSampleCard());
    const result = await runCli(["read", "--reader", "B"], { createReader: () => createEidReader({ backend }) });
    expect(result.stdout).toContain("Kaartlezer:       B");
  });

  it("maskWord", () => {
    expect(maskWord("Van der Berghe")).toBe("V** d** B*****");
    expect(maskWord("Anne-Marie")).toBe("A***-M****");
    expect(maskWord("")).toBe("");
  });
});

describe("dafke-eid CLI --debug", () => {
  it("geeft debug door aan createReader", async () => {
    let seen: unknown;
    await runCli(["readers", "--debug"], {
      createReader: async (options) => {
        seen = options;
        return createEidReader({ backend: new MockPcscBackend() });
      },
    });
    expect(seen).toEqual({ mock: false, debug: true });
  });
});

describe("dafke-eid diag", () => {
  it("toont de ruwe toestand van de virtuele lezer zonder persoonsgegevens", async () => {
    const { code, stdout } = await runCli(["diag", "--mock"]);
    expect(code).toBe(0);
    expect(stdout).toContain(`Lezers (1): "${MOCK_READER_NAME}"`);
    expect(stdout).toMatch(/getStatusChange direct \(0 ms\): 0x\w+ \[CHANGED PRESENT\] teller=1 atr=3b7f/);
    expect(stdout).toContain("GET CARD DATA: SW 9000, 28 bytes");
    expect(stdout).toContain("SELECT identiteit: SW 9000");
    expect(stdout).not.toContain("Specimen");
  });

  it("toont 'geen' zonder lezers", async () => {
    const { stdout } = await runCli(["diag"], { createReader: async () => never(), createBackend: async () => new MockPcscBackend() });
    expect(stdout).toContain("Lezers (0): geen");
  });
});

function never(): never {
  throw new Error("niet gebruikt");
}

describe("dafke-eid serve", () => {
  const mockDeps = { createReader: async () => createEidReader({ backend: new MockPcscBackend().addReader("L") }) };

  it("start de bridge, ook zonder commando, en stopt netjes", async () => {
    for (const argv of [["serve", "--port", "0"], ["--port", "0"]]) {
      const result = await runCli(argv, mockDeps, {});
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/luistert op http:\/\/127\.0\.0\.1:\d+/);
      expect(result.stdout).toContain("Toegelaten websites: http://localhost:*, http://127.0.0.1:*");
      const port = result.server!.bridge.port;
      const res = await fetch(`http://127.0.0.1:${port}/v1/status`);
      expect((await res.json()).name).toBe("dafke-eid");
      await result.server!.stop();
    }
  });

  it("neemt --origin (meermaals en met komma's) en --token over", async () => {
    const result = await runCli(
      ["serve", "--port", "0", "--origin", "https://a.voorbeeld.be,https://b.voorbeeld.be", "--origin", "https://*.c.be", "--token", "x"],
      mockDeps,
      {},
    );
    expect(result.server!.bridge.origins).toEqual(["https://a.voorbeeld.be", "https://b.voorbeeld.be", "https://*.c.be"]);
    expect(result.stdout).toContain("Token: vereist");
    const res = await fetch(`http://127.0.0.1:${result.server!.bridge.port}/v1/status`);
    expect(res.status).toBe(401);
    await result.server!.stop();
  });

  it("leest instellingen uit omgevingsvariabelen", async () => {
    const result = await runCli(["serve"], mockDeps, { DAFKE_EID_PORT: "0", DAFKE_EID_ORIGINS: "https://env.voorbeeld.be", DAFKE_EID_TOKEN: "t" });
    expect(result.server!.bridge.origins).toEqual(["https://env.voorbeeld.be"]);
    expect(result.stdout).toContain("Token: vereist");
    await result.server!.stop();
  });

  it("weigert een ongeldige poort of origin", async () => {
    expect((await runCli(["serve", "--port", "99999"], mockDeps, {})).stderr).toContain("--port verwacht");
    expect((await runCli(["serve"], mockDeps, { DAFKE_EID_PORT: "abc" })).stderr).toContain("DAFKE_EID_PORT");
    const bad = await runCli(["serve", "--port", "0", "--origin", "*"], mockDeps, {});
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("Ongeldig origin-patroon");
  });
});
