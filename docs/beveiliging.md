# Beveiliging van de bridge

De eID bevat gevoelige gegevens (rijksregisternummer, adres, foto). De bridge maakt die via HTTP
bereikbaar, dus bepaalt hij strikt **wie** ze mag opvragen.

| Dreiging | Maatregel |
| --- | --- |
| Een andere pc in het netwerk leest de kaart | Luistert alleen op `127.0.0.1` (of `::1`); een ander adres wordt geweigerd bij het starten |
| Een willekeurige website vraagt `http://127.0.0.1:47820/v1/card` op | **Origin-allowlist.** Niet toegelaten = 403 zonder CORS-headers, dus de site kan het antwoord niet lezen |
| DNS-rebinding (`evil.com` wijst naar 127.0.0.1) | **Host-controle:** alleen `127.0.0.1:<poort>`, `localhost:<poort>` en `[::1]:<poort>` |
| Cross-site verzoek zonder Origin-header | Geweigerd als de browser `Sec-Fetch-Site` meestuurt met iets anders dan `none`/`same-origin` |
| Misbruik van een toegelaten site (bv. XSS) | Optioneel **token** (`--token`); hou de allowlist zo kort mogelijk |
| WebSocket/SSE van een vreemde site | Dezelfde Host-, Origin- en tokencontrole |
| Gegevens blijven hangen | `Cache-Control: no-store`; de cache in het geheugen wordt gewist zodra de kaart eruit gaat; niets naar schijf |
| Logbestanden met persoonsgegevens | `--debug` logt alleen methode, pad (zonder querystring), status en duur |
| Een `*` in de allowlist | Wordt geweigerd bij het starten |
| Programma's zonder browser (curl, malware) | Sturen geen Origin; die kunnen PC/SC sowieso rechtstreeks aanspreken. Gebruik het token als je dat toch wil afschermen |

## Browsers

- **Chrome/Edge**: een https-site mag `http://127.0.0.1` aanspreken. Voor Private Network Access
  stuurt Chrome eerst een preflight; de bridge antwoordt `Access-Control-Allow-Private-Network: true`
  alleen voor toegelaten origins. Nieuwere versies kunnen de gebruiker éénmalig om toestemming vragen
  voor "apparaten op het lokale netwerk".
- **Firefox**: `http://127.0.0.1` geldt als veilige context, geen mixed-content-blokkering.
- **Safari**: staat `http://localhost`/`127.0.0.1` toe vanaf https. Test in je doelomgeving.

## Aanbevolen instellingen

- Ontwikkeling: de standaard (`http://localhost:*`, `http://127.0.0.1:*`).
- Productie: `dafke-eid --origin https://app.jouwdomein.be` en eventueel `--token`.
