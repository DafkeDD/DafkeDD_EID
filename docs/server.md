# Aanmelden controleren op de server

`@dafkedd/eid/server` controleert het token dat de browser na het aanmelden met PIN krijgt
(zie [bridge.md](bridge.md#aanmelden-met-pin)). Alleen Node, geen extra afhankelijkheden.

## Wat er gecontroleerd wordt

| Stap | Fout bij falen |
| --- | --- |
| Nonce: door jou uitgegeven, nog geldig, nog niet gebruikt (wordt meteen verbruikt) | `nonce-invalid` |
| Tokenvorm: `web-eid:1.0`, gekend algoritme, geldige base64 | `token-invalid` |
| Certificaat leesbaar, geen CA, sleuteltype past bij het algoritme | `certificate-invalid` |
| Certificaat geldig op dit moment | `certificate-expired` |
| Handtekening over `hash(origin) ‖ hash(nonce)` met **jouw** origin | `signature-invalid` |
| Keten tot een vertrouwde root (Belgium Root CA), tussencertificaten ook via AIA | `chain-untrusted` |
| OCSP: niet ingetrokken | `certificate-revoked` |
| OCSP onbereikbaar, onleesbaar, vals ondertekend of te oud → **geen login** (fail closed) | `revocation-unavailable` |
| Geen vertrouwde roots ingesteld | `config-invalid` |

Elke fout is een `EidVerifyError` met een vaste `code`. Toon de gebruiker een algemene melding en
log de code.

## Gewone Node / Next.js

```ts
import { EidAuthenticator, EidVerifyError } from "@dafkedd/eid/server";

const eid = new EidAuthenticator({ origin: "https://sso.voorbeeld.be" });

// GET /api/eid/challenge
const { nonce, expiresAt } = await eid.createChallenge();
// → bewaar nonce in de sessie, stuur hem naar de browser

// POST /api/eid/login  (body = token van useEidLogin)
try {
  const who = await eid.verify(token, session.nonce);
  // who.nationalNumber, who.firstNames, who.lastName, who.certificate …
} catch (error) {
  if (EidVerifyError.is(error)) return unauthorized(error.code);
  throw error;
}
```

## NestJS

```ts
import { EidAuthModule, EidAuthService, EidVerifyError } from "@dafkedd/eid/nestjs";

@Module({
  imports: [EidAuthModule.forRoot({ origin: "https://sso.voorbeeld.be" })],
  // of: EidAuthModule.forRootAsync({ inject: [ConfigService], useFactory: (c: ConfigService) => ({ origin: c.get("SSO_ORIGIN") }) })
  controllers: [EidController],
})
export class AuthModule {}

@Controller("eid")
export class EidController {
  constructor(private readonly eid: EidAuthService) {}

  @Get("challenge")
  async challenge(@Session() session: Record<string, unknown>) {
    const { nonce } = await this.eid.createChallenge();
    session.eidNonce = nonce;
    return { nonce };
  }

  @Post("login")
  async login(@Body() token: unknown, @Session() session: Record<string, unknown>) {
    try {
      return await this.eid.verify(token, String(session.eidNonce));
    } catch (error) {
      if (EidVerifyError.is(error)) throw new UnauthorizedException(error.code);
      throw error;
    } finally {
      delete session.eidNonce;
    }
  }
}
```

De module gebruikt geen decorators en importeert NestJS niet zelf: `@nestjs/common` is een optionele
peer-dependency.

## Meerdere servers: een gedeelde NonceStore

`MemoryNonceStore` werkt alleen binnen één proces. Achter een load balancer:

```ts
import type { NonceStore } from "@dafkedd/eid/server";

const redisNonceStore: NonceStore = {
  async save(nonce, expiresAt) {
    await redis.set(`eid:nonce:${nonce}`, "1", { PXAT: expiresAt.getTime() });
  },
  async consume(nonce) {
    return (await redis.getDel(`eid:nonce:${nonce}`)) === "1"; // atomisch: maar één keer
  },
};

new EidAuthenticator({ origin, nonceStore: redisNonceStore });
```

## Vertrouwde roots

Standaard vertrouwt de server de Belgium Root CA's uit `BELGIUM_ROOT_CAS`. Die lijst vul je met:

```bash
npm run fetch-roots   # downloadt van certs.eid.belgium.be en toont de SHA-256-vingerafdrukken
```

Het script haalt Belgium Root CA3 en CA4 op, en volgt voor nieuwere kaarten (2025+, PKI op
`crt.eidpki.belgium.be`) de keten van een Citizen CA naar **Belgium Root CA6**. Mist er een root,
dan toont `npm run test:integration` (met `EID_TEST_PIN`) de keten van je kaart; geef het CA
Issuers-adres dan mee: `npm run fetch-roots -- http://crt.eidpki.belgium.be/eid/eidcXXXXXX.crt`.

Vergelijk de vingerafdrukken met de officiële bron (eid.belgium.be) en commit
`packages/eid/src/server/belgium-roots.generated.ts`. Je kan ook zelf roots meegeven:

```ts
new EidAuthenticator({
  origin,
  trust: {
    roots: [fs.readFileSync("belgiumrs4.pem", "utf8")],
    intermediates: [/* Citizen CA's, optioneel */],
    fetchIssuer: false, // tussencertificaten niet via AIA ophalen
  },
});
```

Tussencertificaten (Citizen CA's) zitten niet in het token. Zonder `intermediates` haalt de server
ze op via het CA Issuers-adres in het certificaat (en onthoudt ze); ze worden alleen gebruikt als
de keten tot een vertrouwde root klopt.

## OCSP

De server vraagt de OCSP-responder uit het certificaat (bij de eID: `http://ocsp.eid.belgium.be`)
of het certificaat ingetrokken is: met nonce, antwoord ondertekend door de uitgever of een
gedelegeerde responder (EKU OCSPSigning), niet ouder dan `nextUpdate` (of 24 uur), 5 minuten
klokverschil toegelaten. Je server moet dat adres dus kunnen bereiken (firewall, proxy).

```ts
new EidAuthenticator({ origin, revocation: { timeoutMs: 3000 } });
// revocation: false → NIET controleren (alleen voor tests!)
```

## Testen zonder echte kaart

De virtuele kaart (`@dafkedd/eid/mock`) tekent met een test-PKI (`tests/fixtures/pki`, gemaakt met
`npm run test-pki`). Geef die roots mee in je tests:

```ts
import { TEST_ROOT_CA, TEST_CITIZEN_CA } from "@dafkedd/eid/mock";
new EidAuthenticator({ origin, trust: { roots: [TEST_ROOT_CA], intermediates: [TEST_CITIZEN_CA] }, revocation: false });
```

Gebruik deze test-roots **nooit** in productie: hun privésleutels zijn openbaar.
