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

## Waarom "no-bridge" ook bij een niet-toegelaten website?

Een website die niet in de allowlist staat, krijgt bewust geen CORS-headers. De browser ziet dat als
netwerkfout, net alsof de bridge niet draait. Zo kan een vreemde website zelfs niet te weten komen
dát de gebruiker dafke-eid heeft. Krijg je tijdens ontwikkeling `no-bridge` terwijl de bridge draait:
controleer `--origin` (start met `--debug` om de geweigerde aanvragen te zien).
