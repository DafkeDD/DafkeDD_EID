# DafkeDD EID

Belgische eID-kaarten uitlezen in gehoste Next.js/React-apps, met optioneel aanmelden met PIN en een NestJS-module voor de backend. Werkt op Windows en macOS.

> Status: fase 6. Lezen werkt, het programma voor gebruikers installeert zichzelf, en aanmelden met PIN (`useEidLogin`, Web eID-token) werkt voor websites in `authOrigins`. De controle van het token op de server (`/server`, `/nestjs`) volgt in fase 7. Zie [docs/plan.md](docs/plan.md).

## Hoe het werkt

Een browser kan niet met een kaartlezer praten. Elke gebruiker draait daarom een klein lokaal programma, de **bridge** (`dafke-eid`), die via PC/SC met de lezer praat en de kaart aan toegelaten websites aanbiedt op `127.0.0.1`. Je webapp gebruikt het npm-pakket `@dafkedd/eid`.

| Import | Waar | Wat |
| --- | --- | --- |
| `@dafkedd/eid` | overal | types, fouten, kaartlogica |
| `@dafkedd/eid/node` | Node | PC/SC + bridge (`npx dafke-eid`) |
| `@dafkedd/eid/react` | browser | `useEid()`, `<EidProvider>` |
| `@dafkedd/eid/server` | Node | token controleren |
| `@dafkedd/eid/nestjs` | Node | NestJS-module |
| `@dafkedd/eid/mock` | overal | virtuele kaart |

## Een kaart uitlezen (virtuele kaart)

```ts
import { readEid } from "@dafkedd/eid";
import { createSampleCard } from "@dafkedd/eid/mock";

const card = await createSampleCard();
const { identity, address, photo } = await readEid(card);
console.log(identity.firstNames, identity.lastName, address.municipality);
```

Kaartformaat en ontwerpkeuzes: [docs/eid-kaart.md](docs/eid-kaart.md).

## Ontwikkelen

Vereist Node 20+.

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Testen met een echte kaartlezer

```bash
npm run test:integration          # leest de ingestoken eID (persoonsgegevens gemaskeerd)
npm run build
npx dafke-eid readers             # toon de kaartlezers
npx dafke-eid read                # lees de kaart (gemaskeerd; --full toont alles)
npx dafke-eid read --mock         # virtuele lezer met voorbeeldkaart
```

## Webapp (React / Next.js)

```bash
npm run build
npm run bridge            # of: npm run bridge:mock (virtuele lezer)
npm run playground        # http://localhost:3000  (zonder bridge: /?mock=1)
```

Zie [docs/bridge.md](docs/bridge.md) voor het protocol en het gebruik in React, en
[docs/beveiliging.md](docs/beveiliging.md) voor de beveiliging.

## Aanmelden met PIN

Alleen voor je eigen login/SSO-website: start de bridge met `--auth-origin https://sso.voorbeeld.be`,
laat je server een nonce maken, vraag de PIN in je eigen dialoog en roep
`useEidLogin().login({ nonce, pin })` aan. Je krijgt een Web eID-token (`web-eid:1.0`) voor je server.
Zie [docs/bridge.md](docs/bridge.md#aanmelden-met-pin).

## Programma voor gebruikers

Downloaden uit de GitHub-release en dubbelklikken (Windows): het installeert zichzelf in het
profiel van de gebruiker (geen administratorrechten), start mee met de computer en opent de
**testpagina** op http://127.0.0.1:47820/ (status, lezers live, test lezen met gemaskeerde
gegevens, diagnose, logboek).

```bash
npm run build:exe                               # bouwt het programma voor dit platform
npm run build:exe -- --origin https://app.x.be  # met ingebakken toegelaten websites
```

Zie [installeren.md](docs/installeren.md) (gebruikers), [uitrollen.md](docs/uitrollen.md) (IT) en
[releasen.md](docs/releasen.md) (bouwen en ondertekenen).

## Releases

Werk op `developer`, release via een pull request `developer → main`. Zie [CLAUDE.md](CLAUDE.md).
