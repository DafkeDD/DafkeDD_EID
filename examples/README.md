# Voorbeelden

Kopieer een map naar een eigen project, of lees mee met [docs/aan-de-slag.md](../docs/aan-de-slag.md).

| Map | Wat |
| --- | --- |
| `next-app` | Next.js: kaart lezen en aanmelden met PIN, controle in een route handler |
| `nest-api` | NestJS: dezelfde aanmelding gecontroleerd met `EidAuthModule` |

Snel proberen (virtuele kaart, PIN `1234`):

```bash
cd examples/next-app
npm install
npx dafke-eid --mock --auth-origin http://localhost:3000   # in een tweede venster
EID_TEST_CARD=1 npm run dev                                # PowerShell: $env:EID_TEST_CARD="1"; npm run dev
```

Zolang `@dafkedd/eid` nog niet gepubliceerd is, installeer je eerst het gebouwde pakket
(`npm run build` in de root):

```bash
npm pack ../../packages/eid
npm install ./dafkedd-eid-<versie>.tgz
```

Gebruik geen `npm install ../../packages/eid` (een link): dan laadt Next.js React twee keer.

Deze mappen zijn geen workspaces: ze installeren `@dafkedd/eid` zoals een gebruiker dat doet.
`npm run test:install` (in de root) installeert ze met het net gebouwde pakket en test alles.
