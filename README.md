# DafkeDD EID

Read Belgian eID cards in hosted Next.js/React apps, with optional PIN authentication and a NestJS module for the backend. Works on Windows and macOS.

> Status: phase 1 (repository setup). Nothing reads a card yet. See [docs/plan.md](docs/plan.md).

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

## Development

Requires Node 20+.

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Releases

Work on `developer`, release through a pull request `developer → main`. See [CLAUDE.md](CLAUDE.md).
