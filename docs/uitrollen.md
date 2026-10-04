# DafkeDD eID uitrollen (voor IT)

## Wat er gebeurt bij installeren

`dafke-eid install` (of dubbelklikken op het gedownloade programma) installeert **per gebruiker**,
zonder administratorrechten:

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Map | `%LOCALAPPDATA%\DafkeDD\eid` | `~/Library/Application Support/DafkeDD/eid` | `~/.local/share/dafkedd/eid` |
| Autostart | `HKCU\…\Run` → `wscript //E:jscript start-hidden.js` (geen venster) | LaunchAgent `be.dafkedd.eid` | systemd-gebruikersdienst `dafkedd-eid.service` |
| Snelkoppeling | Start-menu: "DafkeDD eID testen" | `~/Applications/DafkeDD eID testen.webloc` | `.desktop`-link |
| Apps-vermelding | `HKCU\…\Uninstall\DafkeDD-eID` | — | — |
| Instellingen | `config.json` in de map | idem | idem |
| Logbestand | `dafke-eid.log` in de map (max. 1 MB, daarna `.log.1`) | idem | idem |

Een nieuwere versie installeren = dezelfde stappen: het oude programma wordt gestopt en vervangen,
`config.json` blijft behouden (tenzij je nieuwe instellingen meegeeft).

## Stil installeren (Intune, aanmeldscript, …)

```cmd
dafke-eid-windows-x64.exe install --silent --origin https://app.jouwdomein.be
```

| Optie | Betekenis |
| --- | --- |
| `--origin <patroon>` | Websites die de kaart mogen lezen (meermaals of met komma's). `https://app.x.be`, `https://*.x.be` |
| `--auth-origin <patroon>` | Websites die mogen **aanmelden met PIN** (aparte lijst, standaard geen). Alleen je eigen login/SSO-website |
| `--token <geheim>` | Elke aanvraag moet dit token meesturen (de webapp krijgt het via een veilig kanaal) |
| `--port <poort>` | Andere poort dan 47820 (de webapp moet dan `url` meegeven aan `EidProvider`) |
| `--no-testpage` | Geen testpagina op http://127.0.0.1:47820/ |
| `--silent` | Geen browser openen, niet wachten |

Verwijderen zonder vensters: `"%LOCALAPPDATA%\DafkeDD\eid\dafke-eid.exe" uninstall --silent`.

## Instellingen in het programma inbakken

Dan hoeft niemand iets op te geven: dubbelklikken volstaat.

- Lokaal: `npm run build:exe -- --origin https://app.jouwdomein.be [--auth-origin https://sso.jouwdomein.be] [--token …] [--no-testpage]`
- In de release-workflow: repository-variabelen **`DAFKE_EID_ORIGINS`** en **`DAFKE_EID_AUTH_ORIGINS`** (komma's).

## Volgorde van instellingen

Opdrachtregel → omgevingsvariabelen (`DAFKE_EID_PORT`, `DAFKE_EID_ORIGINS`, `DAFKE_EID_AUTH_ORIGINS`, `DAFKE_EID_TOKEN`,
`DAFKE_EID_TESTPAGE`) → `config.json` → ingebakken → standaard.

`config.json`:

```json
{
  "origins": ["https://app.jouwdomein.be"],
  "authOrigins": ["https://sso.jouwdomein.be"],
  "token": "lang-willekeurig-geheim",
  "port": 47820,
  "testpage": true
}
```

## Testpagina: aan of uit?

Standaard **aan**: handig voor support (diagnose, logboek, "Website testen"). Ze is alleen
bereikbaar vanaf de computer zelf, toont persoonsgegevens alleen gemaskeerd in de eigen browser,
en geeft andere websites geen toegang. Wil je ze toch niet: `--no-testpage`.

Zie ook [beveiliging.md](beveiliging.md).
