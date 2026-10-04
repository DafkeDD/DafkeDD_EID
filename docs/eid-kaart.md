# De Belgische eID-kaart

Technische achtergrond bij `@dafkedd/eid` (core). Gebaseerd op publiek beschikbare informatie
over de eID (Belpic) en ISO/IEC 7816-4.

## Bestanden

Geselecteerd via hun pad vanaf de root (`3F00` impliciet, `SELECT` met P1=`08`).

| Bestand | Pad | Inhoud |
| --- | --- | --- |
| Identiteit | `DF01 4031` | TLV, zie hieronder |
| Handtekening identiteit | `DF01 4032` | Handtekening van het rijksregister |
| Adres | `DF01 4033` | TLV |
| Handtekening adres | `DF01 4034` | Handtekening over adres + identiteitshandtekening |
| Foto | `DF01 4035` | JPEG |
| Authenticatiecertificaat | `DF00 5038` | X.509 DER (kan ontbreken) |
| Handtekeningcertificaat | `DF00 5039` | X.509 DER (kan ontbreken) |
| CA / Root / RRN | `DF00 503A` / `503B` / `503C` | X.509 DER |

Lezen vraagt geen PIN.

## Commando's

| Commando | Bytes |
| --- | --- |
| SELECT FILE | `00 A4 08 0C Lc <pad>` |
| READ BINARY | `00 B0 <offset hi> <offset lo> Le` (blokken van 240 bytes) |
| GET RESPONSE | `00 C0 00 00 Le` (na `61xx`) |
| GET CARD DATA | `80 E4 00 00 1C` (bytes 0–15 serienummer, byte 21 appletversie) |

`sendApdu()` handelt `61xx` (GET RESPONSE) en `6Cxx` (opnieuw met juiste Le) automatisch af.
`readFile()` stopt bij een kort blok, `6282` (einde bestand) of `6B00` (offset voorbij het einde).

| Applet | Sleutels | Foto-hash |
| --- | --- | --- |
| 1.8 (vanaf 2020) | EC P-384 | SHA-384 |
| 1.7 (2014–2020) | RSA 2048 | SHA-1 |

## TLV

`tag` (1 byte) · `lengte` (basis-128, hoogste bit = er volgt nog een byte) · `waarde`.
Tag `0x00` aan het begin = versie van de bestandsstructuur. Na het laatste veld: opvulling met nullen.

### Identiteit (`DF01 4031`)

| Tag | Veld | Formaat |
| --- | --- | --- |
| 01 | `cardNumber` | 12 cijfers |
| 02 | `chipNumber` | bytes → hex |
| 03 / 04 | `validFrom` / `validUntil` | `DD.MM.YYYY` → ISO |
| 05 | `issuingMunicipality` | tekst |
| 06 | `nationalNumber` | 11 cijfers |
| 07 | `lastName` | tekst |
| 08 | `firstNames` | tekst |
| 09 | `thirdNameInitial` | tekst |
| 0A | `nationality` | tekst |
| 0B | `placeOfBirth` | tekst |
| 0C | `dateOfBirth` | `15 MAAR 1985`, `15 MARS 1985`, `15.MÄR.1985`, soms gedeeltelijk → `PartialDate` |
| 0D | `gender` | `M` man; `F`/`V`/`W` vrouw; al de rest `"unknown"` |
| 0E | `nobleCondition` | tekst |
| 0F | `documentType` | code |
| 10 | `specialStatus` | code |
| 11 | `photoHash` | SHA-1 of SHA-384 van de foto |
| 12–15 | `duplicate`, `specialOrganisation`, `memberOfFamily`, `dateAndCountryOfProtection` | tekst |

Onbekende tags komen in `unknownFields` (hex), zodat nieuwere kaarten niets verliezen.

### Adres (`DF01 4033`)

| Tag | Veld |
| --- | --- |
| 01 | `streetAndNumber` (best-effort gesplitst in `street`, `houseNumber`, `box`) |
| 02 | `zipCode` |
| 03 | `municipality` |

## Rijksregisternummer

`JJMMDD-VVV-CC`, met `CC = 97 − (JJMMDDVVV mod 97)`; vanaf geboortejaar 2000 met `2JJMMDDVVV`.
`checkNationalNumber()` controleert beide en geeft de eeuw terug.

## Ontwerpkeuzes

| Keuze | Waarom |
| --- | --- |
| Kaart herkennen door `DF01 4031` te selecteren, niet via de ATR | Werkt voor alle kaartversies |
| Foto-hash standaard controleren | Detecteert een foto die niet bij de identiteit hoort |
| `dateOfBirth: null` + `dateOfBirthRaw` bij onleesbare datum | Nooit gokken |
| Geen `Buffer`, hashen via WebCrypto | Core draait ook in de browser |
