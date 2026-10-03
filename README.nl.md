# DafkeDD EID

Belgische eID-kaarten uitlezen in gehoste Next.js/React-apps, met optioneel aanmelden met PIN en een NestJS-module voor de backend. Werkt op Windows en macOS.

> Status: fase 2. Uitlezen werkt met de virtuele kaart (`@dafkedd/eid/mock`); een echte lezer volgt in fase 3. Zie [docs/plan.md](docs/plan.md).

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

## Releases

Werk op `developer`, release via een pull request `developer → main`. Zie [CLAUDE.md](CLAUDE.md).
