# DafkeDD EID

Read Belgian eID cards in hosted Next.js/React apps, with optional PIN authentication and a NestJS module for the backend. Works on Windows and macOS.

> Status: phase 3. Reading works with a real card reader (Windows, macOS, Linux) and with the virtual card (`@dafkedd/eid/mock`). The bridge for web apps follows in phase 4. See [docs/plan.md](docs/plan.md).

## How it works

A browser cannot talk to a card reader. Every user therefore runs a small local program, the **bridge** (`dafke-eid`), which talks to the reader via PC/SC and serves the card to allowed websites on `127.0.0.1`. Your web app uses the npm package `@dafkedd/eid`.

| Import | Where | What |
| --- | --- | --- |
| `@dafkedd/eid` | everywhere | types, errors, card logic |
| `@dafkedd/eid/node` | Node | PC/SC + bridge (`npx dafke-eid`) |
| `@dafkedd/eid/react` | browser | `useEid()`, `<EidProvider>` |
| `@dafkedd/eid/server` | Node | token validation |
| `@dafkedd/eid/nestjs` | Node | NestJS module |
| `@dafkedd/eid/mock` | everywhere | virtual card |

## Reading a card (virtual card)

```ts
import { readEid } from "@dafkedd/eid";
import { createSampleCard } from "@dafkedd/eid/mock";

const card = await createSampleCard();
const { identity, address, photo } = await readEid(card);
console.log(identity.firstNames, identity.lastName, address.municipality);
```

Card format and design choices: [docs/eid-kaart.md](docs/eid-kaart.md) (Dutch).

## Development

Requires Node 20+.

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Testing with a real card reader

```bash
npm run test:integration          # reads the inserted eID (personal data masked)
npm run build
npx dafke-eid readers             # list readers
npx dafke-eid read                # read the card (masked; --full shows everything)
npx dafke-eid read --mock         # virtual reader with a sample card
```

## Releases

Work on `developer`, release through a pull request `developer → main`. See [CLAUDE.md](CLAUDE.md).
