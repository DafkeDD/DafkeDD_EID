# CLAUDE.md — DafkeDD_EID

Instructies voor Claude (en andere AI-assistenten) die in deze repo werken.
Het volledige plan staat in [docs/plan.md](docs/plan.md).

## Git-regels (belangrijk)

- **Push altijd naar `developer`.** Nooit rechtstreeks naar `main` committen of pushen.
- Controleer vóór elke commit/push op welke branch je staat: `git branch --show-current`.
  Sta je op `main`, schakel dan eerst over: `git switch developer`.
- `main` krijgt enkel wijzigingen via een pull request `developer → main`.
  Elke merge naar `main` maakt automatisch een GitHub-release (`.github/workflows/release.yml`).
- Nooit force-pushen naar `main` of `developer`.
- Remote: `https://github.com/DafkeDD/DafkeDD_EID.git`

## Release maken

1. Op `developer`: `npm run version:patch` (of `version:minor` / `version:major`).
2. `git commit -am "chore: release vX.Y.Z"` en `git push` (naar developer).
3. Pull request `developer → main` openen en mergen (`gh pr create --base main --head developer --fill`).
4. De workflow maakt tag `vX.Y.Z` + release. Bestaat de tag al, dan wordt er niets gereleased.
5. Daarna `developer` gelijkzetten met `main`:
   `git switch developer && git pull --ff-only origin main && git push`.

Maak nooit zelf tags of releases met de hand; dat doet de workflow.

## Tests (verplicht)

- **Alles wat erbij komt krijgt een test**, in dezelfde commit.
- Waar: `tests/**/*.test.ts` (Vitest). `tests/structuur.test.ts` bewaakt de pakketstructuur
  (exports ↔ tsup-entries, geen Node-API's in core/react/mock, koffi alleen in /node, README's).
- Een bugfix begint met een test die de bug aantoont.
- `it.fails(...)` met "BEKENDE BUG" in de naam = gedocumenteerde, nog niet opgeloste bug.
- Hardware-tests (echte lezer) staan in `tests/integration/*.int.ts` en draaien alleen met
  `npm run test:integration` (niet in CI). Toon daar nooit ongemaskeerde persoonsgegevens.
- `tests/node/native-ffi.test.ts` test de koffi-koppeling tegen een nep-PC/SC-bibliotheek
  (`tests/fixtures/fake-pcsc.c`, Linux- én macOS-ABI); draait op Linux met gcc.

## Vóór elke push

```bash
npm run typecheck
npm test
npm run build
```

CI (`.github/workflows/ci.yml`) draait dit op Windows, macOS en Linux; de job `CI-check` is
de vereiste check voor `main`.

## Projectstructuur & conventies

- `apps/playground` — Next.js-testpagina (`npm run playground`, zonder bridge: `/?mock=1`).
- `packages/eid` — het pakket `@dafkedd/eid` (subpaden: `.`, `/node`, `/react`, `/server`, `/nestjs`, `/mock`).
  Nieuw subpad = entry in `tsup.config.ts` **én** in `exports` van package.json.
- `src/core`, `src/react`, `src/mock` draaien ook in de browser: geen `node:`-imports, geen `Buffer`, geen `process`.
- `koffi` (PC/SC) wordt alleen in `src/node` geïmporteerd, en daar lazy (`createNativeBackend`), zodat de
  mock-backend werkt zonder native bibliotheek. Alle ABI-verschillen per platform zitten in `src/node/pcsc/native.ts`.
- React en NestJS zijn optionele peer-dependencies, nooit gewone dependencies.
- Fouten altijd als `EidError` met een code uit `EID_ERROR_CODES`. Codes alleen toevoegen, nooit hernoemen.
- Nooit persoonsgegevens of PIN loggen, ook niet in debug-uitvoer.
- Wijzigingen aan de bridge (`src/node/bridge.ts`): eerst [docs/beveiliging.md](docs/beveiliging.md) lezen;
  elke beveiligingsregel heeft een test in `tests/node/bridge.test.ts`.
- Testpagina (`src/node/testpage.ts`): gewoon script zonder build, strikte CSP (geen inline script/style,
  geen externe bronnen). Endpoints onder `/v1/test/` alleen voor de eigen pagina. Toont persoonsgegevens
  alleen in de browser en standaard gemaskeerd.
- Logboek (`src/node/logbook.ts`): nooit persoonsgegevens; tests in `bridge.test.ts` controleren dat.
- Installeren (`src/node/install.ts`): alles via `InstallDeps`, tests in `tests/node/install.test.ts`
  schrijven nooit buiten de neppe omgeving. Windows-starter is JScript (geen VBScript, dat wordt uitgefaseerd).
- Het zelfstandige programma: `npm run build:exe` (Node 22/24, op het doelplatform); CI bouwt en test het
  op Windows, macOS en Linux (job `exe`), en installeert/verwijdert het echt op Windows.
- Aanmelden (`src/core/auth.ts`): PIN wordt TUSSEN kaartstappen gevraagd (Windows reset een kaart na 5 s
  stilstand in een transactie). De ondertekende origin komt altijd uit de Origin-header, nooit uit de body.
  PIN, PIN-blok en nonce nooit loggen of bewaren; tests in `bridge.test.ts` en `auth.test.ts` controleren dat.
- Test-PKI: `scripts/make-test-pki.sh` (maakt `tests/fixtures/pki/` en `src/mock/test-pki.ts`). Alleen voor tests.
- Het bridge-protocol staat in `src/core/protocol.ts` (`PROTOCOL_VERSION`). Een brekende wijziging = versie omhoog.
- Zichtbare UI hoort niet in deze repo maar in de DafkeDD UI-registry (`DafkeDD/DafkeDD_UI`).
- Regeleindes: LF (zie `.gitattributes`). Code-commentaar en docs: Nederlands.
- README in twee talen: `README.md` (Engels) en `README.nl.md` (Nederlands), met dezelfde hoofdstukken.
- Productnaam in teksten: **DafkeDD EID**. Pakketnaam `@dafkedd/eid`, commando `dafke-eid`.
