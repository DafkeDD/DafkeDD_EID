# Releasen

## Gewone release

1. Op `developer`: `npm run version:patch` (of `:minor` / `:major`), commit en push.
2. Pull request `developer → main`, mergen.
3. De workflow **Release** bouwt het programma op Windows, macOS (Apple Silicon) en macOS (Intel),
   ondertekent het als de geheimen ingesteld zijn, en maakt release `vX.Y.Z` met:
   - `dafkedd-eid-X.Y.Z.tgz` (npm-pakket)
   - `dafke-eid-setup-windows-x64.exe` (Windows-setup), `dafke-eid-windows-x64.exe` (los),
     `dafke-eid-macos-arm64`, `dafke-eid-macos-x64` (+ `.sha256`)

## Programma lokaal bouwen

```bash
npm ci
npm run build:exe                                  # dist-bin/dafke-eid-<os>-<arch>[.exe]
npm run build:exe -- --origin https://app.x.be     # met ingebakken websites
```

Bouw met **Node 22 of 24** en op het doelplatform (Windows-.exe op Windows, Mac op een Mac).
Het programma bevat Node zelf, de bridge en de koffi-addon (±80–120 MB).

## Windows-setup lokaal bouwen

```powershell
winget install JRSoftware.InnoSetup   # eenmalig, Inno Setup 6.3+
npm run build:exe
npm run build:setup                   # dist-bin/dafke-eid-setup-windows-x64.exe
```

Het script staat in `installer/dafke-eid.iss`. De setup pakt het programma uit `dist-bin` in, dus
onderteken eerst het programma en daarna de setup (zo doet de release-workflow het). Verander de
`AppId` nooit: daaraan herkent Windows een update.

## Ondertekenen

Zonder handtekening werkt alles, maar:
- **Windows** toont SmartScreen ("Windows heeft uw pc beschermd"), voor de setup én het losse programma.
- **macOS** krijgt alleen een ad-hoc handtekening; Gatekeeper blokkeert een gedownload programma.

Geheimen (Settings → Secrets and variables → Actions):

| Geheim | Inhoud |
| --- | --- |
| `WINDOWS_CERT_PFX` | Code-signing-certificaat (.pfx) in base64 |
| `WINDOWS_CERT_PASSWORD` | Wachtwoord van de .pfx |
| `APPLE_CERT_P12` | "Developer ID Application"-certificaat (.p12) in base64 |
| `APPLE_CERT_PASSWORD` | Wachtwoord van de .p12 |
| `APPLE_SIGN_IDENTITY` | bv. `Developer ID Application: DafkeDD (TEAMID)` |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` | Voor notarisatie (`xcrun notarytool`) |

macOS gebruikt de hardened runtime met `scripts/macos-entitlements.plist` (JIT voor Node, en het
laden van de uitgepakte koffi-addon).

Variabelen (niet geheim): `DAFKE_EID_ORIGINS` (websites die mogen lezen) en `DAFKE_EID_AUTH_ORIGINS`
(websites die mogen aanmelden met PIN), met komma's.
