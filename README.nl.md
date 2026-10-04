# DafkeDD EID

Belgische eID-kaarten uitlezen in gehoste Next.js/React-apps, met optioneel aanmelden met PIN en een NestJS-module voor de backend. Werkt op Windows en macOS.

> Status: fase 9. Lezen, het programma voor gebruikers, aanmelden met PIN, de controle op de server (`/server`, `/nestjs`: handtekening, keten tot Belgium Root CA, OCSP) en de componenten in Dafke UI werken, en een installatietest controleert het pakket in lege Next.js- en NestJS-projecten. Nog open: code signing, een test op een echte Mac en waar gebruikers het programma downloaden. Zie [docs/plan.md](docs/plan.md).

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

## Aan de slag in 5 minuten

```bash
npm install @dafkedd/eid
npx dafke-eid --mock --auth-origin http://localhost:3000   # virtuele kaart, PIN 1234
```

De kaart lezen in Next.js, aanmelden met PIN en het token controleren in Next.js of NestJS:
[docs/aan-de-slag.md](docs/aan-de-slag.md), met werkende projecten in [examples/](examples).

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
npm run test:install   # installeert het ingepakte pakket in examples/ (Next.js + NestJS) en test de hele keten
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

## Kant-en-klare componenten (Dafke UI)

[Dafke UI](https://github.com/DafkeDD/DafkeDD_UI) heeft vier eID-componenten: `eid-status`, `eid-card`,
`eid-pin-dialog` en `eid-reader-picker` (`npx dafke-ui add eid-status eid-card`). Ze werken enkel
met props; je koppelt de hooks er zelf aan:

```tsx
const eid = useEid();
<EidStatus phase={eid.phase} reader={eid.reader} error={eid.error} onRead={eid.read}
  downloads={{ windows: "/downloads/dafke-eid-setup.exe", mac: "/downloads/dafke-eid-macos" }} />
{eid.card && <EidCard identity={eid.card.identity} address={eid.card.address} photo={eid.card.photo} />}

const auth = useEidLogin();
<EidPinDialog open={open} onOpenChange={setOpen} onSubmit={(pin) => auth.login({ nonce, pin })}
  status={auth.status} error={auth.error} triesLeft={auth.triesLeft} />
```

## Aanmelden met PIN

Alleen voor je eigen login/SSO-website: start de bridge met `--auth-origin https://sso.voorbeeld.be`,
laat je server een nonce maken, vraag de PIN in je eigen dialoog en roep
`useEidLogin().login({ nonce, pin })` aan. Je krijgt een Web eID-token (`web-eid:1.0`) voor je server.
Zie [docs/bridge.md](docs/bridge.md#aanmelden-met-pin).

Op je server (Node, Next.js of NestJS):

```ts
import { EidAuthenticator } from "@dafkedd/eid/server"; // of EidAuthModule uit "@dafkedd/eid/nestjs"
const eid = new EidAuthenticator({ origin: "https://sso.voorbeeld.be" });
const { nonce } = await eid.createChallenge();
const who = await eid.verify(token, nonce); // nationalNumber, firstNames, lastName, …
```

Dat controleert de handtekening over jouw origin en nonce, de keten tot Belgium Root CA en OCSP
(fail closed). Draai één keer `npm run fetch-roots` om de Belgische roots toe te voegen. Zie
[docs/server.md](docs/server.md).

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
