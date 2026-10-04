# DafkeDD EID

Read Belgian eID cards in hosted Next.js/React apps, with optional PIN authentication and a NestJS module for the backend. Works on Windows and macOS.

> Status: phase 9. Reading, the end-user program, PIN login, server-side validation (`/server`, `/nestjs`: signature, chain to Belgium Root CA, OCSP) and the Dafke UI components all work, and an install test checks the package in fresh Next.js and NestJS projects. Still open: code signing, a real Mac test and where users download the program. See [docs/plan.md](docs/plan.md).

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

## Quick start

```bash
npm install @dafkedd/eid
npx dafke-eid --mock --auth-origin http://localhost:3000   # virtual card, PIN 1234
```

Reading the card in Next.js, PIN login and checking the token in Next.js or NestJS take five
minutes: [docs/aan-de-slag.md](docs/aan-de-slag.md) (Dutch), with working projects in
[examples/](examples).

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
npm run test:install   # installs the packed package in examples/ (Next.js + NestJS) and tests the whole chain
```

## Testing with a real card reader

```bash
npm run test:integration          # reads the inserted eID (personal data masked)
npm run build
npx dafke-eid readers             # list readers
npx dafke-eid read                # read the card (masked; --full shows everything)
npx dafke-eid read --mock         # virtual reader with a sample card
```

## Web app (React / Next.js)

```bash
npm run build
npm run bridge            # or: npm run bridge:mock (virtual reader)
npm run playground        # http://localhost:3000  (without bridge: /?mock=1)
```

See [docs/bridge.md](docs/bridge.md) for the protocol and React usage, and
[docs/beveiliging.md](docs/beveiliging.md) for security (both Dutch).

## Ready-made components (Dafke UI)

[Dafke UI](https://github.com/DafkeDD/DafkeDD_UI) has four eID components: `eid-status`, `eid-card`,
`eid-pin-dialog` and `eid-reader-picker` (`npx dafke-ui add eid-status eid-card`). They only take
props, so you wire the hooks into them:

```tsx
const eid = useEid();
<EidStatus phase={eid.phase} reader={eid.reader} error={eid.error} onRead={eid.read}
  downloads={{ windows: "/downloads/dafke-eid-setup.exe", mac: "/downloads/dafke-eid-macos" }} />
{eid.card && <EidCard identity={eid.card.identity} address={eid.card.address} photo={eid.card.photo} />}

const auth = useEidLogin();
<EidPinDialog open={open} onOpenChange={setOpen} onSubmit={(pin) => auth.login({ nonce, pin })}
  status={auth.status} error={auth.error} triesLeft={auth.triesLeft} />
```

## PIN login

For your own login/SSO website only: start the bridge with `--auth-origin https://sso.example.be`,
let your server create a nonce, ask the PIN in your own dialog and call
`useEidLogin().login({ nonce, pin })`. You get a Web eID token (`web-eid:1.0`) for your server.
Details (Dutch): [docs/bridge.md](docs/bridge.md#aanmelden-met-pin).

On your server (Node, Next.js or NestJS):

```ts
import { EidAuthenticator } from "@dafkedd/eid/server"; // or EidAuthModule from "@dafkedd/eid/nestjs"
const eid = new EidAuthenticator({ origin: "https://sso.example.be" });
const { nonce } = await eid.createChallenge();
const who = await eid.verify(token, nonce); // nationalNumber, firstNames, lastName, …
```

It checks the signature over your origin and nonce, the chain to Belgium Root CA and OCSP (fail
closed). Run `npm run fetch-roots` once to add the Belgian roots. Dutch docs: [docs/server.md](docs/server.md).

## Program for end users

Download links (always the **latest version**, handy for a download button):

| Platform | Link |
| --- | --- |
| Windows setup (recommended) | https://github.com/DafkeDD/DafkeDD_EID/releases/latest/download/dafke-eid-setup-windows-x64.exe |
| Windows, plain program | https://github.com/DafkeDD/DafkeDD_EID/releases/latest/download/dafke-eid-windows-x64.exe |
| macOS Apple Silicon | https://github.com/DafkeDD/DafkeDD_EID/releases/latest/download/dafke-eid-macos-arm64 |
| macOS Intel | https://github.com/DafkeDD/DafkeDD_EID/releases/latest/download/dafke-eid-macos-x64 |

Windows: download `dafke-eid-setup-windows-x64.exe` from the GitHub release and run it (or the plain
`dafke-eid-windows-x64.exe`, which installs itself). It installs in the user's profile (no admin
rights), starts with the computer and opens the **test page** at http://127.0.0.1:47820/ (status,
live readers, test read with masked data, diagnostics, log). Silent: `/VERYSILENT /ORIGINS=https://app.x.be`.

```bash
npm run build:exe                               # build the program for this platform
npm run build:exe -- --origin https://app.x.be  # with allowed websites baked in
npm run build:setup                             # Windows setup (Inno Setup) around the program
```

Dutch docs: [installeren.md](docs/installeren.md) (users), [uitrollen.md](docs/uitrollen.md) (IT),
[releasen.md](docs/releasen.md) (building and signing).

## Releases

Work on `developer`, release through a pull request `developer → main`. See [CLAUDE.md](CLAUDE.md).
