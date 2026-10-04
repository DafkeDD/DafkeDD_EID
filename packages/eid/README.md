# @dafkedd/eid

Read Belgian eID cards in hosted Next.js/React apps.

A browser cannot talk to a card reader, so every user runs the small **DafkeDD eID** program
(`dafke-eid`) that serves the card to allowed websites on `http://127.0.0.1:47820`. This package
contains everything else.

```bash
npm install @dafkedd/eid
```

```tsx
"use client";
import { EidProvider, useEid, fullName } from "@dafkedd/eid/react";

function Card() {
  const eid = useEid();
  if (eid.phase === "no-bridge") return <p>Start DafkeDD eID.</p>;
  if (eid.phase !== "done" || !eid.card) return <p>{eid.phase}…</p>;
  return <p>Welcome, {fullName(eid.card.identity)}</p>;
}

export default function Page() {
  return (
    <EidProvider>
      <Card />
    </EidProvider>
  );
}
```

During development: `npx dafke-eid` (real reader) or `npx dafke-eid --mock` (virtual card),
or `<EidProvider client={new MockEidClient()}>` from `@dafkedd/eid/mock` without any bridge.

| Import | Where | What |
| --- | --- | --- |
| `@dafkedd/eid` | everywhere | types, errors, card reading (`readEid`), bridge protocol |
| `@dafkedd/eid/react` | browser | `EidProvider`, `useEid`, `useEidLogin` (PIN login), `EidReader`, `EidClient`, formatters |
| `@dafkedd/eid/node` | Node | PC/SC (koffi), `createEidReader`, `startBridge`; command `dafke-eid` |
| `@dafkedd/eid/mock` | everywhere | `VirtualCard`, `MockEidClient` |
| `@dafkedd/eid/server` | Node | `EidAuthenticator`, `verifyEidToken`: signature, chain to Belgium Root CA, OCSP |
| `@dafkedd/eid/nestjs` | Node | `EidAuthModule.forRoot()`, `EidAuthService` |

Documentation (Dutch): https://github.com/DafkeDD/DafkeDD_EID/tree/main/docs
