# De bridge (`dafke-eid`) en React

Een browser kan niet met een kaartlezer praten. De **bridge** is een klein programma op de pc van
de gebruiker dat de kaartlezer via PC/SC aanspreekt en de kaart aanbiedt op
`http://127.0.0.1:47820`, alleen aan toegelaten websites.

## Starten

```bash
npx dafke-eid                                   # = dafke-eid serve, standaardpoort 47820
npx dafke-eid --origin https://app.voorbeeld.be # welke websites mogen lezen
npx dafke-eid --mock                            # virtuele lezer met voorbeeldkaart
npx dafke-eid --debug                           # toon methode/pad/status van elke aanvraag
```

| Optie | Omgevingsvariabele | Standaard |
| --- | --- | --- |
| `--port <poort>` | `DAFKE_EID_PORT` | `47820` |
| `--origin <patroon>` (meermaals of met komma's) | `DAFKE_EID_ORIGINS` | `http://localhost:*`, `http://127.0.0.1:*` |
| `--auth-origin <patroon>` | `DAFKE_EID_AUTH_ORIGINS` | geen (niemand mag aanmelden) |
| `--token <geheim>` | `DAFKE_EID_TOKEN` | geen |

Origin-patronen: `https://app.voorbeeld.be` (exact), `http://localhost:*` (elke poort),
`https://*.voorbeeld.be` (elk subdomein, niet het domein zelf). `*` alleen is nooit toegelaten.

## Protocol (v1)

| Aanvraag | Antwoord |
| --- | --- |
| `GET /v1/status` | `{ name, version, protocol, readers }` |
| `GET /v1/readers` | `{ readers: [{ name, cardPresent, atr? }] }` |
| `GET /v1/card?reader=…&photo=0` | `{ reader, card }` — bytes (foto, certificaten) in base64 |
| `GET /v1/events` | Server-Sent Events: eerst `status`, daarna `reader-added`, `reader-removed`, `card-inserted`, `card-removed` |
| `POST /v1/authenticate` | Body `{ nonce, pin, reader? }` → `{ reader, token }` (Web eID-token). Alleen voor `authOrigins` |

Fouten: HTTP-status + `{ "error": { "code": "no-card", "message": "…" } }` (codes uit `EID_ERROR_CODES`).
De bridge onthoudt een gelezen kaart tot ze eruit gaat; een tweede `GET /v1/card` leest dus niet opnieuw.

## React / Next.js

```tsx
"use client";
import { EidProvider, useEid, fullName } from "@dafkedd/eid/react";

function Kaart() {
  const eid = useEid();
  if (eid.phase === "no-bridge") return <p>Start de eID-lezer (dafke-eid).</p>;
  if (eid.phase === "no-card") return <p>Steek je eID in.</p>;
  if (eid.phase !== "done" || !eid.card) return <p>{eid.phase}…</p>;
  return <p>Welkom, {fullName(eid.card.identity)}</p>;
}

export default function Pagina() {
  return (
    <EidProvider>
      <Kaart />
    </EidProvider>
  );
}
```

`phase`: `connecting` → `no-bridge` | `bridge-outdated` | `no-reader` | `no-card` → `reading` → `done` | `error`
(of `ready` met `autoRead={false}`). De store leest automatisch één keer per insteekbeurt, negeert
resultaten van een kaart die al uitgetrokken is, en wist de gegevens bij het uittrekken.

Opties van `<EidProvider>`: `url`, `token`, `autoRead` (standaard `true`), `photo` (standaard `true`),
`reader` (vaste lezer), of een eigen `client`.

Zonder bridge (demo's, tests): `import { MockEidClient } from "@dafkedd/eid/mock"` en
`<EidProvider client={new MockEidClient()}>`. Met `insertCard()`, `removeCard()` en
`setBridgeAvailable()` bootst je alle toestanden na.

Formatters: `fullName`, `formatNationalNumber`, `formatDate` (ook gedeeltelijke datums),
`formatAddress`, `photoDataUrl`, `ageOn`.

## Aanmelden met PIN

Voor een SSO- of login-website. Zo werkt het:

1. Je **server** maakt een nonce (minstens 44 tekens, bv. base64 van 32 willekeurige bytes) en bewaart hem.
2. De **website** vraagt de PIN in een eigen dialoog en roept `useEidLogin().login({ nonce, pin })` aan.
3. De **bridge** controleert dat de website in `authOrigins` staat, laat de kaart de PIN controleren
   en `hash(origin) ‖ hash(nonce)` ondertekenen met de authenticatiesleutel. De origin is de
   **Origin-header van de browser**: een website kan zich niet voor een andere uitgeven.
4. Het **token** (`web-eid:1.0`: certificaat, algoritme, handtekening) gaat naar je server, die het
   controleert met `@dafkedd/eid/server` (fase 7): nonce, handtekening, keten tot Belgium Root CA, OCSP.

```tsx
"use client";
import { useState } from "react";
import { useEidLogin } from "@dafkedd/eid/react";

function Aanmelden({ nonce }: { nonce: string }) {
  const login = useEidLogin();
  const [pin, setPin] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const token = await login.login({ nonce, pin });
        setPin("");
        if (token) await fetch("/api/eid/login", { method: "POST", body: JSON.stringify(token) });
      }}
    >
      <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
      <button disabled={login.status === "signing"}>Aanmelden</button>
      {login.error?.code === "pin-incorrect" && <p>Verkeerde PIN, nog {login.triesLeft} poging(en).</p>}
      {login.error?.code === "pin-blocked" && <p>Je PIN is geblokkeerd.</p>}
    </form>
  );
}
```

| Fout | Betekenis |
| --- | --- |
| `auth-not-allowed` | Deze website staat niet in `authOrigins` |
| `pin-incorrect` | Verkeerde PIN; `triesLeft` = resterende pogingen. Vraag opnieuw (nieuwe aanvraag) |
| `pin-blocked` | Geen pogingen meer; deblokkeren met de PUK bij de gemeente |
| `unsupported-card` | Kaart te oud (applet 1.1) |
| `bad-request` | Ongeldige nonce of PIN-formaat (de kaart werd niet aangesproken) |

Applet 1.8 geeft `ES384` (ECDSA P-384), applet 1.7 `RS256` (RSA 2048). Elke aanvraag doet één
PIN-poging. De PIN wordt niet gelogd of bewaard; de testpagina heeft een knop **Test aanmelden**
die ook de handtekening in de browser controleert.

De PIN in de website zelf is de lichtste oplossing, maar de website kan de PIN zien. Zet daarom
alleen je eigen, vertrouwde login-website in `authOrigins`. Een eigen PIN-venster van de bridge en
lezers met een PIN-toetsenbord komen later.

## Waarom "no-bridge" ook bij een niet-toegelaten website?

Een website die niet in de allowlist staat, krijgt bewust geen CORS-headers. De browser ziet dat als
netwerkfout, net alsof de bridge niet draait. Zo kan een vreemde website zelfs niet te weten komen
dát de gebruiker dafke-eid heeft. Krijg je tijdens ontwikkeling `no-bridge` terwijl de bridge draait:
controleer `--origin` (start met `--debug` om de geweigerde aanvragen te zien).
