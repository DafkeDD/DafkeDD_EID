import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { authenticateWithCard } from "../../packages/eid/src/core";
import { createSampleCard, SAMPLE_PIN } from "../../packages/eid/src/mock";
import { EID_AUTH_OPTIONS, EidAuthModule, EidAuthService, EidVerifyError } from "../../packages/eid/src/nestjs";
import { pem } from "../server/helpers";

const ORIGIN = "https://sso.voorbeeld.be";
const options = { origin: ORIGIN, trust: { roots: [pem("root")], intermediates: [pem("citizen-ca")] }, revocation: false as const };

async function login(service: EidAuthService) {
  const { nonce } = await service.createChallenge();
  const token = await authenticateWithCard(await createSampleCard(), { origin: ORIGIN, nonce, pin: async () => SAMPLE_PIN });
  return service.verify(token, nonce);
}

describe("EidAuthModule", () => {
  it("forRoot levert een werkende EidAuthService", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [EidAuthModule.forRoot(options)] }).compile();
    const service = moduleRef.get(EidAuthService);
    expect(service).toBeInstanceOf(EidAuthService);
    expect(service.origin).toBe(ORIGIN);
    expect((await login(service)).nationalNumber).toBe("85031512369");
    expect(moduleRef.get(EID_AUTH_OPTIONS)).toMatchObject({ origin: ORIGIN });
  });

  it("forRootAsync met een factory en inject", async () => {
    const CONFIG = "CONFIG";
    const moduleRef = await Test.createTestingModule({
      imports: [
        EidAuthModule.forRootAsync({
          imports: [{ module: class ConfigModule {}, providers: [{ provide: CONFIG, useValue: { origin: ORIGIN } }], exports: [CONFIG], global: true }],
          inject: [CONFIG],
          useFactory: async (config: { origin: string }) => ({ ...options, origin: config.origin }),
        }),
      ],
    }).compile();
    expect((await login(moduleRef.get(EidAuthService))).lastName).toBe("Specimen");
  });

  it("geeft EidVerifyError door (bv. hergebruikte nonce)", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [EidAuthModule.forRoot(options)] }).compile();
    const service = moduleRef.get(EidAuthService);
    const { nonce } = await service.createChallenge();
    const token = await authenticateWithCard(await createSampleCard(), { origin: ORIGIN, nonce, pin: async () => SAMPLE_PIN });
    await service.verify(token, nonce);
    const error = await service.verify(token, nonce).catch((e: unknown) => e);
    expect(EidVerifyError.is(error, "nonce-invalid")).toBe(true);
  });
});
