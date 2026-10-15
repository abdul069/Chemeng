# Gezinsbord

Een slim gezinsscherm voor in de keuken: één groot touchscreen (of een tablet op een standaard) met de
gezinskalender, taken, maaltijden, lijsten, een fotolijst en een AI-assistent waarmee je kunt praten.
Telefoons van het gezin openen dezelfde app en zien alle wijzigingen meteen.

## Wat zit erin

| Onderdeel | Wat het doet |
|---|---|
| **Vandaag** | Begroeting en weer, voorstellen voor de assistent, de dag per gezinslid, wat er straks gebeurt, de maaltijden en taken van vandaag |
| **Kalender** | Dag- (een kolom per gezinslid), week-, maand- en lijstweergave. Tik op een gezinslid om die persoon te verbergen. Herhalende afspraken (dagelijks, wekelijks, tweewekelijks, maandelijks, jaarlijks), meerdaagse afspraken, "alleen deze dag" of "hele reeks" aanpassen |
| **Gekoppelde agenda's** | Google Agenda, Outlook en iCloud via het iCal-adres, elk kwartier bijgewerkt |
| **Taken** | Klusjes per gezinslid met icoontjes, per weekdag, met sterren die kinderen inruilen voor beloningen |
| **Maaltijden** | Weekmenu (ontbijt, lunch, diner), receptenboek, ingrediënten in één tik naar de boodschappenlijst |
| **Lijsten** | Boodschappen, to-do en eigen lijsten, live gedeeld tussen alle toestellen |
| **Foto's** | Foto's uploaden; na een tijdje zonder aanraking wordt het scherm een fotolijst met klok, weer en de volgende afspraak |
| **Assistent** | Claude, met spraak: "Zet volleybal op dinsdag om 17u voor Lina en Mama", "Wat eten we deze week?", "Zet melk op de boodschappenlijst", "Wat kunnen we dit weekend doen met een vierjarige?" |
| **Instellingen** | Gezinsleden (naam, kleur, figuurtje of foto, ouder/kind), woonplaats voor het weer, fotolijst, ouder-pincode, thema |

## Architectuur

```
web/      React-app (Vite, TypeScript). Installeerbaar als app (PWA) en als Android-app (Capacitor).
server/   Node.js-server (Express, TypeScript) met SQLite-database, websockets voor live updates,
          iCal-synchronisatie, weer (Open-Meteo) en de Claude-assistent met tools.
```

Alle gegevens staan in één SQLite-bestand (`data/gezinsbord.sqlite`) plus de map `data/photos`.
Maak daarvan een back-up en je hebt alles.

## Installeren

### Met Docker (aanbevolen, bv. op een NAS, Raspberry Pi of thuisserver)

```sh
cp .env.example .env        # vul ANTHROPIC_API_KEY in voor de assistent
docker compose up -d --build
```

Open daarna `http://<ip-van-je-server>:8080` op het keukenscherm en op de telefoons.

### In de cloud op Railway

Railway bouwt de `Dockerfile` rechtstreeks uit deze repo. Nodig in de service:

- een volume gekoppeld op `/data` (database en foto's);
- variabelen `PORT=8080`, `DATA_DIR=/data`, `TZ=Europe/Brussels`, `ACCESS_CODE=<eigen code>` en `ANTHROPIC_API_KEY`;
- een publiek domein naar poort 8080.

Elke push naar de gekoppelde branch zet automatisch een nieuwe versie online.

### Zonder Docker

Vereist Node.js 22.13 of nieuwer.

```sh
npm install
npm run build
ANTHROPIC_API_KEY=sk-ant-... npm start      # luistert op poort 8080
```

### Ontwikkelen

```sh
npm install
npm run dev          # server op :8080, app met hot reload op :5173
npm test             # tests van de server
npm run typecheck
```

## Het keukenscherm instellen

1. Open de app in Chrome op het scherm of de tablet.
2. Kies in het menu **Toevoegen aan startscherm** / **App installeren**. De app opent dan schermvullend.
3. Zet in de Android-instellingen het scherm op "altijd aan" bij opladen. De app vraagt zelf ook om het
   scherm wakker te houden.
4. Spraak: tik op **Praat** en geef de app toegang tot de microfoon. Spraakherkenning werkt in Chrome en Edge
   (op Android en desktop). Op een `http://`-adres staat de microfoon alleen open via `localhost`; gebruik
   voor andere toestellen `https://` (bv. via een reverse proxy zoals Caddy) of de Android-app.

### Android-app (APK)

De Android-app is een schil rond je eigen Gezinsbord-server. Nodig: Android Studio.

```sh
cd web
GEZINSBORD_URL=http://192.168.1.20:8080 npm run android:add    # eenmalig
GEZINSBORD_URL=http://192.168.1.20:8080 npm run android:sync
npm run android:open                                           # bouw de APK in Android Studio
```

## Google Agenda koppelen

1. Open Google Agenda op een computer → **Instellingen** → kies de agenda.
2. Kopieer **Geheim adres in iCal-indeling**.
3. In Gezinsbord: **Instellingen → Gekoppelde agenda's → Agenda**, plak het adres en kies bij wie de
   afspraken horen.

Gekoppelde agenda's zijn alleen-lezen in Gezinsbord; wijzigingen doe je in de oorspronkelijke agenda.

## Instellingen via de omgeving

| Variabele | Standaard | Betekenis |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Sleutel voor de assistent. Zonder sleutel staat alleen de assistent uit. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model voor de assistent |
| `ACCESS_CODE` | — | Verplichte toegangscode voor elk toestel. Zet dit als de server vanaf het internet bereikbaar is. |
| `PORT` | `8080` | Poort van de server |
| `DATA_DIR` | `data` | Map voor database en foto's |
| `TZ` | `Europe/Brussels` | Tijdzone voor gekoppelde agenda's |
| `CALENDAR_SYNC_MINUTES` | `15` | Hoe vaak gekoppelde agenda's bijgewerkt worden |
| `SEED_DEMO` | `1` | Bij een lege database een voorbeeldgezin aanmaken. Zet op `0` om leeg te starten. |

## Privacy

Alles blijft op je eigen server. Alleen deze gegevens verlaten je netwerk:

- de vragen aan de assistent, samen met de gezinsnamen en de agenda/taken/maaltijden die de assistent
  opvraagt, gaan naar de Claude API van Anthropic;
- je ingestelde woonplaats (coördinaten) gaat naar Open-Meteo voor het weer;
- de server haalt de gekoppelde iCal-adressen op.
