# DafkeDD eID installeren (voor gebruikers)

Websites die je eID lezen, hebben een klein programma op je computer nodig: **DafkeDD eID**.
Het praat met je kaartlezer en geeft je kaart alleen aan websites die daarvoor toegelaten zijn.
Je hebt geen administratorrechten nodig.

## Downloaden

Deze links wijzen altijd naar de **nieuwste versie** (handig voor een downloadknop op je website):

| Platform | Bestand | Link |
| --- | --- | --- |
| Windows (aanbevolen) | Setup | https://github.com/DafkeDD/DafkeDD_EID/releases/latest/download/dafke-eid-setup-windows-x64.exe |
| Windows | Los programma (installeert zichzelf) | https://github.com/DafkeDD/DafkeDD_EID/releases/latest/download/dafke-eid-windows-x64.exe |
| macOS Apple Silicon (M1/M2/M3/…) | Programma | https://github.com/DafkeDD/DafkeDD_EID/releases/latest/download/dafke-eid-macos-arm64 |
| macOS Intel | Programma | https://github.com/DafkeDD/DafkeDD_EID/releases/latest/download/dafke-eid-macos-x64 |

Alle versies, met `.sha256`-controlebestanden: https://github.com/DafkeDD/DafkeDD_EID/releases

## Windows

1. Download **`dafke-eid-setup-windows-x64.exe`** (de setup).
2. Dubbelklik erop. De setup installeert DafkeDD eID en start het meteen; vink **Testpagina openen**
   aan om te zien of je kaartlezer werkt.
3. Klaar. Het programma start voortaan vanzelf mee met Windows, zonder venster.

Je hebt geen administratorrechten nodig. Een nieuwe versie installeer je op dezelfde manier: je
instellingen blijven bewaard.

Zolang de setup niet digitaal ondertekend is, toont Windows "Windows heeft uw pc beschermd".
Kies **Meer info → Toch uitvoeren**.

Het staat daarna in **Instellingen → Apps → Geïnstalleerde apps** als "DafkeDD eID", met een knop **Verwijderen**.

Liever zonder setup? Download `dafke-eid-windows-x64.exe` en dubbelklik erop: het programma
installeert zichzelf op dezelfde plek, met hetzelfde resultaat.

## macOS

1. Download `dafke-eid-macos-arm64` (Apple Silicon: M1/M2/M3/…) of `dafke-eid-macos-x64` (Intel).
2. Open **Terminal** en voer uit (pas de naam aan):
   ```bash
   chmod +x ~/Downloads/dafke-eid-macos-arm64
   ~/Downloads/dafke-eid-macos-arm64
   ```
3. De testpagina opent. Het programma start voortaan vanzelf mee (LaunchAgent).

## De testpagina

Open **"DafkeDD eID testen"** in het Start-menu (Windows) of in je map Apps/Programma's (macOS),
of surf naar **http://127.0.0.1:47820/**.

| Onderdeel | Wat je ziet |
| --- | --- |
| Status | Versie, toegelaten websites, of er een token nodig is |
| Kaartlezers | Je lezer(s) en of er een kaart in zit — verandert live als je de kaart insteekt of uittrekt |
| Test lezen | Leest je kaart en toont de gegevens **gemaskeerd**; vink "Toon alles" aan om alles te zien. Er wordt niets opgeslagen |
| Test aanmelden | Controleert je PIN en laat de kaart een test ondertekenen. Opgelet: na 3 verkeerde PIN's is je PIN geblokkeerd |
| Website testen | Vul het adres van een website in om te zien of die je kaart mag lezen |
| Diagnose | Technische gegevens zonder persoonsgegevens; met **Kopieer voor support** plak je ze in een mail |
| Logboek | De laatste gebeurtenissen (kaart in/uit, welke website iets vroeg), zonder persoonsgegevens |

## Problemen

| Melding op de website | Oplossing |
| --- | --- |
| "De eID-lezer draait niet" | Open de testpagina. Werkt die niet, start het programma opnieuw (dubbelklik) |
| "Sluit een kaartlezer aan" | Kijk of de lezer op de testpagina verschijnt. Zo niet: andere USB-poort, of controleer in Apparaatbeheer → Smartcardlezers |
| "Steek je eID in" | Chip naar boven/in de lezer; op de testpagina moet "kaart" verschijnen |
| De website staat niet toegelaten | Test het adres onder "Website testen" en vraag je IT-dienst om het toe te voegen |

Support vraagt soms het **logbestand**: `%LOCALAPPDATA%\DafkeDD\eid\dafke-eid.log` (Windows) of
`~/Library/Application Support/DafkeDD/eid/dafke-eid.log` (macOS). Er staan geen persoonsgegevens in.

## Verwijderen

- Windows: **Instellingen → Apps → DafkeDD eID → Verwijderen** (geldt voor de setup én het losse programma).
- Alle platformen: `dafke-eid uninstall` vanuit de installatiemap.
