# DafkeDD_EID — plan

Universeel pakket om de Belgische eID in te lezen in **gehoste** Next.js/React-apps (backend NestJS), met optioneel PIN (authenticatie). Werkt op **Windows en macOS** (Linux later).

- Repo: `DafkeDD/DafkeDD_EID`
- npm-pakket: `@dafkedd/eid` (npm laat geen hoofdletters toe; scope = GitHub-owner, nodig voor GitHub Packages)
- **Taal: alles TypeScript** (ook de bridge), Node ≥ 20, npm workspaces (zelfde als Dafke UI).
- Werkafspraken = die van Dafke UI: push naar `developer`, `main` alleen via PR, release-workflow bij merge, alles krijgt een test, `it.fails` + "BEKENDE BUG".

## Belangrijk uitgangspunt

De apps zijn gehoste websites. Een browser kan nooit zelf aan de kaartlezer, dus **elke gebruiker heeft een klein programma (de bridge) op zijn pc nodig**. Dat geldt voor elke taal. Gekozen: TypeScript, gebundeld als zelfstandig programma (Node SEA, ±70–100 MB), zodat alles één taal is. Gebruiker hoeft geen Node te hebben.

- In de apps zelf: gewoon `npm i @dafkedd/eid` (niets globaal op de dev-pc).
- Ontwikkelen: `npx dafke-eid` vanuit het project, geen installatie nodig.

## Wat we uit de voorbeelden halen

- **lorenthi-eid** (basis voor architectuur en beveiliging): transport-abstractie (`transmit()`), kaart detecteren via SELECT i.p.v. ATR, origin-allowlist + Host-check, niets loggen/cachen, één store met `phase`, vaste foutcodes, `PartialDate`, geslacht `"unknown"`, zelf-installatie per gebruiker met autostart.
- Weggelaten t.o.v. lorenthi: Inno-setup, apart React-PIN-venster + OS-dialogen, 3 manieren van config, `ws`-dependency (→ SSE), changesets, gekopieerde UI.
- **CareConnect**: enkel als referentie voor parsing/pinpad. Niet overnemen: `AllowAnyOrigin`, PIN via HTTP gecachet + gelogd, ATR-detectie, enkel T0, enkel RSA/SHA1.

## Scope

- **Wel:** lezers + kaart in/uit volgen, identiteit, adres, foto (+ hash-controle), kaartgegevens/applet-versie, optioneel `authenticate()` met PIN (Web eID-token `web-eid:1.0`), servercontrole van dat token, NestJS-module, bridge als programma voor eindgebruikers (zelf-installatie, autostart, update-melding).
- **Niet hier (SSO-repo):** OIDC (`oidc-provider`), mTLS, sessies, uitloggen. De SSO-repo gebruikt `@dafkedd/eid` als dependency.
- **Later:** pinpad-lezers (CCID `VERIFY_PIN_DIRECT`), ondertekenen met handtekeningsleutel, Linux-binary, Windows arm64, eigen PIN-venster in de bridge.

## Pakketstructuur (`@dafkedd/eid`, subpaden)

| Import | Waar | Inhoud |
|---|---|---|
| `@dafkedd/eid` | overal | types, `EidError` + codes, APDU's, TLV, parsers, `readEid(transport)`, `authenticate(transport, …)`, bridge-protocol |
| `@dafkedd/eid/node` | Node | PC/SC via koffi (WinSCard / PCSC.framework), monitor, `createEidReader()`, bridge-server; bin `dafke-eid` |
| `@dafkedd/eid/react` | browser | `EidClient`, `EidStore`, `<EidProvider>`, `useEid()`, `useEidLogin()`, formatters |
| `@dafkedd/eid/server` | Node | `verifyEidToken()`, `NonceStore`-interface (memory + Redis-voorbeeld), keten tot Belgium Root CA, OCSP (fail closed) |
| `@dafkedd/eid/nestjs` | Node | `EidAuthModule.forRoot()`, `EidAuthService` (`createChallenge`, `verify`) |
| `@dafkedd/eid/mock` | overal | `VirtualCard` + `MockEidClient` (ook met PIN), testsleutels |

Dependencies: `koffi` (enkel /node). Optionele peers: `react`, `@nestjs/common`. Bundel via tsup (ESM + CJS + .d.ts), `sideEffects: false`.

UI (in **Dafke UI-repo**, registry): `eid-card`, `eid-status` (incl. "eID-lezer installeren"-melding met downloadknop Win/Mac en "bijwerken"-melding), `eid-reader-picker`, `eid-pin-dialog` → `npx dafke-ui add eid-card`.

## Kaart (kort)

- Bestanden onder `3F00/DF01`: `4031` identiteit, `4032` handtekening identiteit, `4033` adres, `4034` handtekening adres, `4035` foto. Certificaten onder `3F00/DF00`: `5038` auth, `5039` handtekening, `503A` CA, `503B` root, `503C` RRN.
- SELECT (`00 A4 08 0C`) + READ BINARY (`00 B0`) in blokken; GET CARD DATA (`80 E4 00 00 1C`) voor applet-versie.
- Applet 1.7 = RSA 2048, applet 1.8 = EC P-384 → beide ondersteunen.
- Datums in NL/FR/DE-maandnotatie, soms gedeeltelijk → `PartialDate`.
- Foto-hash uit identiteitsbestand controleren.
- Applet-info lezen vóór PIN-status (lege VERIFY kost een poging op 1.1).
- Windows reset een kaart na ±5 s stilstand in een transactie → PIN vragen **buiten** de transactie, korte stappen.

## Bridge (`dafke-eid`)

- Luistert enkel op `127.0.0.1` (poort configureerbaar, standaard vast).
- Endpoints: `GET /v1/status` (incl. versie), `GET /v1/readers`, `GET /v1/card?reader=…`, `GET /v1/events` (SSE), `POST /v1/authenticate`.
- Beveiliging: Host-check (anti DNS-rebinding), `Origin`-allowlist, aparte `authOrigins`-lijst (standaard leeg) voor PIN, optioneel token, CORS + Private Network Access-preflight enkel voor toegelaten origins, `Cache-Control: no-store`, niets loggen, cache gewist bij kaart eruit.
- Standaard enkel lezen; PIN alleen voor `authOrigins`. PIN-invoer in v1 via Dafke UI-dialoog in de pagina.
- Config: CLI-opties/env-variabelen + toegelaten origins ingebakken bij build (gebruiker hoeft niets in te stellen).
- Monitor: `SCardGetStatusChange` op worker-thread (time-out 1 s), aparte context voor monitor en kaartoperaties, één operatie per lezer tegelijk.

### Als programma voor eindgebruikers

- Eén bestand per platform (Node SEA + koffi-binary ingebed): `dafke-eid-windows-x64.exe`, `dafke-eid-macos-arm64`, `dafke-eid-macos-x64`.
- **Zelf-installatie bij eerste start**, per gebruiker, geen admin: Windows `%LOCALAPPDATA%\DafkeDD\eid` + autostart (HKCU Run of opstartmap, zonder consolevenster); macOS `~/Library/Application Support/DafkeDD/eid` + LaunchAgent.
- `dafke-eid uninstall` (en vermelding in Apps op Windows indien haalbaar zonder installer).
- Bijwerken: website leest versie via `/v1/status` en toont "bijwerken" met download; nieuwe versie vervangt de oude en behoudt instellingen.
- Stil uitrollen door IT (Intune/script) met parameters voor origins.
- **Code signing verplicht**: Windows Authenticode-certificaat (anders SmartScreen), Apple Developer-account + notarisatie (anders blokkeert Gatekeeper).

## Windows & macOS

| | Windows | macOS |
|---|---|---|
| PC/SC | `winscard.dll` (ingebouwd, dienst "Smart Card") | `PCSC.framework` (ingebouwd) |
| koffi-aandachtspunten | `DWORD` = 4 bytes, W-functies (UTF-16) | `DWORD` = uint32, **packed** structs, `SCardControl132` |
| Drivers | standaard CCID-driver volstaat | standaard CCID-driver volstaat |
| Dev via `npm install` | werkt meteen | werkt meteen |
| Programma gebruiker | `.exe`, ondertekend | arm64 + x64, ondertekend + genotariseerd |
| Autostart | HKCU Run / opstartmap | LaunchAgent |

## Tests

- Vitest: parsers, TLV/APDU, `readEid` + `authenticate` tegen `VirtualCard`, store, React-hooks, servercontrole met test-PKI (ketens, ingetrokken, foute origin, hergebruikte nonce), NestJS-module.
- Bridge: contracttests met mock-backend (Host/Origin/token-weigeringen, SSE), tests voor install/uninstall/autostart in tijdelijke mappen.
- Integratietest met echte lezer achter env-flag (`EID_PCSC_INTEGRATION=1`), handmatig op Windows én Mac per release.
- Playground (Next.js + Dafke UI) + Playwright-e2e met `--mock`.
- CI-matrix: `windows-latest` + `macos-latest` + `ubuntu-latest`: typecheck, test, build (later: programma's bouwen en ondertekenen).

## Fasen

| # | Fase | Klaar als |
|---|---|---|
| 1 | Repo opzetten (workspaces, tsup, Vitest, CI-matrix Win/Mac, CLAUDE.md, release-workflow) | CI groen op lege skeleton |
| 2 | Core: APDU, TLV, parsers, `readEid`, `VirtualCard` | identiteit/adres/foto correct uit virtuele kaart |
| 3 | PC/SC via koffi + monitor (Windows, dan macOS) | echte kaart lezen + in/uit-events op beide OS |
| 4 | Bridge + `/react` (alleen lezen) | playground toont kaart live via `npx dafke-eid` |
| 5 | Programma voor eindgebruikers: SEA-build, zelf-installatie, autostart, update-melding, signing | ondertekend programma installeert zich op Win + Mac, website op ander domein leest kaart → **eerste bruikbare versie (0.1.0)** |
| 6 | PIN + `authenticate()` (+ `useEidLogin`) | geldig `web-eid:1.0`-token uit echte kaart (RSA én EC) |
| 7 | `/server` + `/nestjs` | token geverifieerd incl. keten + OCSP, negatieve tests groen |
| 8 | Dafke UI-componenten (andere repo) | `npx dafke-ui add eid-card`/`eid-status` werkt, tests + docs-pagina |
| 9 | Installatietest | leeg Next.js- + NestJS-project met `@dafkedd/eid`, gebruiker met enkel het programma |

## Open beslissingen

1. Distributie npm-pakket: GitHub Packages (privé, token nodig) of publiek npm.
2. Waar staan de downloads van het programma voor gebruikers (GitHub Releases, eigen website)?
3. Code signing: Windows-certificaat en Apple Developer-account aanvragen.
4. Standaardpoort van de bridge.

## Risico's

- macOS-structs/koffi-details en Gatekeeper → vroeg testen (fase 3), niet pas op het einde.
- Node SEA + ingebedde koffi-binary ondertekenen/notariseren op macOS → vroeg proberen (fase 5).
- Chrome Private Network Access-regels veranderen → preflight correct afhandelen, testen in doelbrowsers.
- PIN in de pagina = website kan PIN zien → enkel `authOrigins`, later optioneel eigen venster/pinpad.
