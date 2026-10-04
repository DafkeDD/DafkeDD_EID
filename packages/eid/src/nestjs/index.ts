/**
 * @dafkedd/eid/nestjs — NestJS-module rond @dafkedd/eid/server.
 *
 *   @Module({ imports: [EidAuthModule.forRoot({ origin: "https://sso.voorbeeld.be" })] })
 *   export class AuthModule {}
 *
 *   constructor(private readonly eid: EidAuthService) {}
 *   const { nonce } = await this.eid.createChallenge();
 *   const who = await this.eid.verify(token, nonce);
 *
 * Geen decorators en alleen type-imports van @nestjs/common: het pakket laadt NestJS nooit zelf.
 */
import type { DynamicModule, InjectionToken, ModuleMetadata, OptionalFactoryDependency, Provider } from "@nestjs/common";
import { EidAuthenticator, type EidAuthenticatorOptions } from "../server/authenticator";

export { VERSION } from "../version";
export { EidVerifyError, EID_VERIFY_ERROR_CODES, createNonce, MemoryNonceStore } from "../server";
export type { EidLoginIdentity, EidVerifyErrorCode, NonceStore, EidAuthenticatorOptions, EidChallenge } from "../server";

/** Injectietoken voor de opties. */
export const EID_AUTH_OPTIONS = Symbol.for("@dafkedd/eid:EID_AUTH_OPTIONS");

/** De service die je injecteert: createChallenge() en verify(token, nonce). */
export class EidAuthService extends EidAuthenticator {}

export interface EidAuthModuleOptions extends EidAuthenticatorOptions {
  /** Overal beschikbaar zonder opnieuw te importeren. Standaard false. */
  global?: boolean;
}

export interface EidAuthModuleAsyncOptions extends Pick<ModuleMetadata, "imports"> {
  useFactory: (...args: never[]) => EidAuthenticatorOptions | Promise<EidAuthenticatorOptions>;
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  global?: boolean;
}

const serviceProvider: Provider = {
  provide: EidAuthService,
  useFactory: (options: EidAuthenticatorOptions) => new EidAuthService(options),
  inject: [EID_AUTH_OPTIONS],
};

export class EidAuthModule {
  static forRoot(options: EidAuthModuleOptions): DynamicModule {
    const { global = false, ...rest } = options;
    return {
      module: EidAuthModule,
      global,
      providers: [{ provide: EID_AUTH_OPTIONS, useValue: rest }, serviceProvider],
      exports: [EidAuthService, EID_AUTH_OPTIONS],
    };
  }

  /** Opties uit bv. ConfigService: `forRootAsync({ inject: [ConfigService], useFactory: (c) => ({ origin: c.get("SSO_ORIGIN") }) })`. */
  static forRootAsync(options: EidAuthModuleAsyncOptions): DynamicModule {
    return {
      module: EidAuthModule,
      global: options.global ?? false,
      imports: options.imports ?? [],
      providers: [{ provide: EID_AUTH_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] }, serviceProvider],
      exports: [EidAuthService, EID_AUTH_OPTIONS],
    };
  }
}
