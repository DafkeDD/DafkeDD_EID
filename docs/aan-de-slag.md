# Aan de slag in 5 minuten

Een Next.js-website die de eID leest en laat aanmelden met PIN, met de controle op de server in
Next.js zelf of in een NestJS-API. Werkende voorbeelden: [`examples/next-app`](../examples/next-app)
en [`examples/nest-api`](../examples/nest-api). `npm run test:install` installeert precies die
twee in een lege map en test de hele keten (ook in CI).

Je hebt **geen kaartlezer** nodig om te beginnen: `npx dafke-eid --mock` geeft een virtuele kaart
(PIN `1234`).

## 1. Installeren

```bash
npm install @dafkedd/eid
```

Eén pakket voor browser én server. Getest met Next.js 16 (Turbopack en webpack) en NestJS 12; ook
CommonJS-projecten met oudere TypeScript-instellingen (`moduleResolution: "node"`, zoals NestJS 10/11)
vinden alle subpaden.

## 2. Het programma starten (ontwikkelen)

```bash
npx dafke-eid --mock --auth-origin http://localhost:3000   # virtuele kaart, PIN 1234
npx dafke-eid --auth-origin http://localhost:3000          # je echte lezer
```

`http://localhost:*` mag standaard lezen; aanmelden met PIN moet je per website toelaten met
`--auth-origin`. Laat je `--auth-origin` weg, dan werkt alleen het lezen.

> Staat het programma voor gebruikers al op je pc, dan bezet dat poort 47820. Start dan met
> `--port 47821` en geef `<EidProvider url="http://127.0.0.1:47821">` mee.

## 3. De kaart lezen (browser)

```tsx
// app/eid-demo.tsx
"use client";
import { EidProvider, useEid, fullName } from "@dafkedd/eid/react";

function Kaart() {
  const eid = useEid();
  if (eid.phase === "no-bridge") return <p>Start het eID-programma (dafke-eid).</p>;
  if (eid.phase === "no-card") return <p>Steek je eID in.</p>;
  if (eid.phase !== "done" || !eid.card) return <p>{eid.phase}…</p>;
  return <p>Welkom, {fullName(eid.card.identity)}</p>;
}

export default function EidDemo() {
  return (
    <EidProvider>
      <Kaart />
    </EidProvider>
  );
}
```

Zet `<EidDemo />` in een pagina (`app/page.tsx`). Meer: [bridge.md](bridge.md#react--nextjs).

## 4. Aanmelden met PIN

De server maakt een **nonce**, de browser laat de kaart die ondertekenen, de server controleert het
**token**. De nonce gaat ook in een httpOnly-cookie, zodat hij bij deze browser hoort.

**Server in Next.js** — één gedeelde instantie (de nonces zitten in het geheugen):

```ts
// lib/eid.ts
import { EidAuthenticator } from "@dafkedd/eid/server";

const shared = globalThis as typeof globalThis & { __dafkeEid?: EidAuthenticator };
export const eid = (shared.__dafkeEid ??= new EidAuthenticator({
  origin: process.env.APP_ORIGIN ?? "http://localhost:3000", // precies zoals in de adresbalk
}));
```

```ts
// app/api/eid/route.ts
import { cookies } from "next/headers";
import { EidVerifyError } from "@dafkedd/eid/server";
import { eid } from "@/lib/eid";

export async function GET() {
  const { nonce } = await eid.createChallenge();
  (await cookies()).set("eid_nonce", nonce, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/api/eid", maxAge: 300,
  });
  return Response.json({ nonce });
}

export async function POST(request: Request) {
  const jar = await cookies();
  const nonce = jar.get("eid_nonce")?.value;
  jar.delete("eid_nonce");
  if (!nonce) return Response.json({ error: "nonce-invalid" }, { status: 401 });
  try {
    const who = await eid.verify(await request.json(), nonce);
    // Hier je sessie aanmaken.
    return Response.json({ firstNames: who.firstNames, lastName: who.lastName });
  } catch (error) {
    if (EidVerifyError.is(error)) return Response.json({ error: error.code }, { status: 401 });
    throw error;
  }
}
```

**Browser:**

```tsx
// in app/eid-demo.tsx, binnen <EidProvider>
import { useState } from "react";
import { useEidLogin } from "@dafkedd/eid/react";

function Aanmelden() {
  const login = useEidLogin();
  const [pin, setPin] = useState("");

  async function aanmelden(event: React.FormEvent) {
    event.preventDefault();
    const { nonce } = await (await fetch("/api/eid")).json();
    const token = await login.login({ nonce, pin });
    setPin(""); // PIN nooit laten staan
    if (token) await fetch("/api/eid", { method: "POST", body: JSON.stringify(token) });
  }

  return (
    <form onSubmit={aanmelden}>
      <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
      <button disabled={login.status === "signing"}>Aanmelden</button>
      {login.error && <p>{login.error.code}{login.triesLeft != null ? ` (nog ${login.triesLeft})` : ""}</p>}
    </form>
  );
}
```

Met [Dafke UI](https://github.com/DafkeDD/DafkeDD_UI) krijg je dit kant-en-klaar:
`npx dafke-ui add eid-status eid-card eid-pin-dialog`.

**Met de virtuele kaart** tekent het token met een test-PKI. Laat de server die alleen dan
vertrouwen (zo doen de voorbeelden het, met `EID_TEST_CARD=1`):

```ts
import { TEST_ROOT_CA, TEST_CITIZEN_CA } from "@dafkedd/eid/mock";
new EidAuthenticator({ origin, trust: { roots: [TEST_ROOT_CA], intermediates: [TEST_CITIZEN_CA] }, revocation: false });
```

Met een echte kaart hoeft dat niet: de Belgische roots zitten in het pakket en OCSP gebeurt vanzelf.

## 5. Of: de server in NestJS

```ts
// app.module.ts
import { Module } from "@nestjs/common";
import { EidAuthModule } from "@dafkedd/eid/nestjs";
import { EidController } from "./eid.controller.js";

@Module({
  imports: [EidAuthModule.forRoot({ origin: process.env.APP_ORIGIN ?? "http://localhost:3000" })],
  controllers: [EidController],
})
export class AppModule {}
```

De controller (`GET /eid/challenge`, `POST /eid/login`) staat volledig in
[`examples/nest-api/src/eid.controller.ts`](../examples/nest-api/src/eid.controller.ts): zelfde
werking als hierboven, met `EidAuthService` in plaats van `EidAuthenticator`. Draait de API op een
ander adres dan de website, zet dan CORS aan met `credentials: true` en roep `fetch` aan met
`credentials: "include"`. `origin` is altijd het adres van de **website**, niet van de API.

## 6. Naar productie

| Wat | Hoe |
| --- | --- |
| `origin` op de server | Je echte adres, bv. `https://sso.jouwdomein.be` |
| Gebruikers | Installeren het programma één keer: [installeren.md](installeren.md) |
| Welke websites mogen | Bak ze in het programma: `npm run build:exe -- --origin https://app.jouwdomein.be --auth-origin https://sso.jouwdomein.be` ([uitrollen.md](uitrollen.md)) |
| Programma ontbreekt of is te oud | `useEid().phase` is `no-bridge` of `bridge-outdated`: toon een downloadknop (`eid-status` in Dafke UI doet dat) |
| Meerdere servers | Gedeelde `NonceStore`, bv. Redis ([server.md](server.md#meerdere-servers-een-gedeelde-noncestore)) |
| OCSP | Je server moet `http://ocsp.eidpki.belgium.be` en `http://ocsp.eid.belgium.be` kunnen bereiken; anders wordt elke aanmelding geweigerd (fail closed) |
| Test-PKI | `EID_TEST_CARD` / `TEST_ROOT_CA` nooit in productie |
