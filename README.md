# Gezinsbord

Een slim gezinsscherm voor in de keuken: één groot touchscreen (of een tablet op een standaard) met de
gezinskalender, taken, maaltijden, lijsten, een fotolijst en een AI-assistent waarmee je kunt praten.
Telefoons van het gezin openen dezelfde app en zien alle wijzigingen meteen.

## Boodschappen

- Elk gezin heeft een eigen **boodschappenlijst** (soort "Boodschappen"), automatisch gesorteerd per afdeling in de winkel (groenten, zuivel, vlees, brood, droge voeding, diepvries, dranken, huishouden). De afdeling van een item kun je zelf kiezen via ✎.
- **Vaste boodschappen**: een standaardlijst van het gezin (Nederlandse en Turkse basisproducten, zelf uit te breiden) die je aanvinkt in plaats van te typen. Aangevinkt staat meteen op de lijst; nog eens tikken haalt het er weer af.
- **Boodschappen en voorraad houden elkaar bij**: afvinken op Boodschappen (gekocht) zet het product in de Voorraad; afvinken in de Voorraad (op) zet het terug op Boodschappen. Terug aanvinken draait dat weer terug.
- Bij een **recept** staan alle ingrediënten aangevinkt; vink af wat je al in huis hebt en zet de rest met één knop op de boodschappenlijst.

## Gebedstijden, ezan en Koran

- **Gebedstijden** worden op de server astronomisch berekend voor de ingestelde woonplaats, met keuze uit rekenmethodes (Diyanet, Muslim World League, ISNA, Egypte, Umm al-Qura, Karachi, UOIF, Koeweit, Singapore, Teheran, Jafari) en de asr-school (standaard of Hanafi). Per gebed kun je minuten bijstellen.
- **Ezan**: zet de ezan aan en elk scherm van het gezin laat op de gebedstijd de oproep horen. Kies per gebed welk geluid klinkt (eigen mp3's uit de ezan-bibliotheek, een zacht belletje of stil). Geluiden voeg je toe via een bestand of een link; de server bewaart ze. Per toestel kun je het geluid uitzetten.
- **Koran**: alle 114 soera's lezen in het Arabisch met vertaling (Nederlands, Turks, Engels, Frans), luisteren per vers met meevolgen (het spelende vers licht op en blijft in beeld), en op de achtergrond verder luisteren terwijl je andere schermen gebruikt (kleine speler onderaan). Tekst via alquran.cloud (met blijvende cache op de server), audio via cdn.islamic.network.

## Wat zit erin

| Onderdeel | Wat het doet |
|---|---|
| **Vandaag** | Begroeting en weer, voorstellen voor de assistent, de dag per gezinslid, wat er straks gebeurt, de maaltijden en taken van vandaag |
| **Kalender** | Dag- (een kolom per gezinslid), week-, maand- en lijstweergave. Tik op een gezinslid om die persoon te verbergen. Herhalende afspraken (dagelijks, wekelijks, tweewekelijks, maandelijks, jaarlijks), meerdaagse afspraken, "alleen deze dag" of "hele reeks" aanpassen |
| **Gekoppelde agenda's** | Google Agenda, Outlook en iCloud via het iCal-adres, elk kwartier bijgewerkt |
| **Taken** | Klusjes per gezinslid met icoontjes, per weekdag en per dagdeel, met sterren die kinderen inruilen voor beloningen. Tik op een gezinslid voor zijn of haar profiel: sterren van vandaag, beloningen inruilen, taken afvinken en eigen to-do's. Sterrenklassement van de week, en een "Ta-da!"-viering als alles af is. Huisdieren kunnen ook een profiel hebben |
| **Maaltijden en recepten** | Weekmenu (ontbijt, lunch, diner) en een receptenbibliotheek met foto's. Recepten zoeken op Turkse receptsites (nefisyemektarifleri, yemek.com, lezzet, Arda'nın Mutfağı, Refika'nın Mutfağı, ...) of toevoegen via een link. Recepten staan in het Nederlands; het origineel (bv. Turks) blijft bewaard en is met één tik te tonen. Per recept: ingrediënten afvinken die je al hebt, de ontbrekende op de boodschappenlijst zetten en het recept op een dag inplannen. Elk gerecht krijgt automatisch een foto: die van de receptpagina zelf, anders een foto van een receptsite of Wikipedia; je kunt ook een andere kiezen of zelf een foto nemen |
| **Apps** | Foto's, weer (7 dagen), klok met kookwekkers en wekkers, gedeelde spraakmemo's, en snelkoppelingen naar YouTube, Spotify, Google Foto's/Agenda/Maps |
| **Mijn recepten** | Favorieten (★), "Vaak gekookt" en categorieën (soep, kip, dessert …) om snel te kiezen |
| **Weekmenu-hulpjes** | "Week vullen" zet op lege avonden een recept uit je bibliotheek (gevarieerd, niet wat de voorbije twee weken al op tafel stond); "Boodschappen voor de week" zet de ingrediënten van alle ingeplande recepten in één keer op de lijst. In elk recept: portiecalculator (− / + porties, hoeveelheden rekenen mee) en Kookmodus (één stap per scherm in grote letters, scherm blijft aan, kookwekker rechtstreeks uit de stap) |
| **Receptenbibliotheek** | Alle recepten van de Turkse receptsites worden automatisch opgehaald (via hun sitemaps) en per categorie in een gedeelde bibliotheek gezet: soepen, börek & deeg, kebab & grill, vlees, kip, vis, groenten, peulvruchten, rijst & pasta, salades & meze, desserts, ontbijt, dranken, sauzen. Blader of zoek (Nederlands of Turks), bekijk het recept en zet het met één tik in je eigen bibliotheek. Titels en recepten worden naar het Nederlands vertaald zodra de assistent ingesteld is; de bibliotheek wordt wekelijks bijgewerkt |
| **Lijsten** | Boodschappen, to-do en eigen lijsten, live gedeeld tussen alle toestellen. Voorraad met aantal en houdbaarheidsdatum: waarschuwing bij bijna of al over datum, met één tik op de boodschappenlijst, en "Koken met wat in huis is" zoekt in de bibliotheek de recepten die het meest van je voorraad gebruiken |
| **Delen** | Een lijst of recept delen via WhatsApp, sms of e-mail (of kopiëren); gekochte boodschappen met één tik naar de voorraad |
| **Zoeken** | Eén zoekvak voor afspraken, recepten, lijsten, taken en de hele bibliotheek |
| **Foto's** | Foto's uploaden; na een tijdje zonder aanraking wordt het scherm een fotolijst met klok, weer en de volgende afspraak |
| **Assistent** | Claude als laag over het scherm, met handsfree praten (tot je op Stop tikt), voorlezen, opgemaakte antwoorden, antwoordknoppen en duimpjes. "Zet volleybal op dinsdag om 17u voor Lina en Mama", "Wat kook ik vanavond?", "Zoek een recept voor mercimek çorbası en plan het vrijdag", "Zet de ingrediënten op de boodschappenlijst" |
| **Instellingen** | Gezinsleden (naam, kleur, figuurtje of foto, ouder/kind), woonplaats voor het weer, fotolijst, ouder-pincode, thema |

## Accounts, gezinnen en delen

- **Account maken.** Iedereen maakt een account met e-mail en wachtwoord en krijgt meteen een eigen gezin,
  met zichzelf als eerste gezinslid en beheerder.
- **Iemand in je gezin uitnodigen** (bv. je partner): Instellingen → *Toegang tot het gezin* → tik op het
  profiel (bv. "Mama") of op *Uitnodigen*. Je krijgt een link (WhatsApp, e-mail of kopiëren). Wie de link opent,
  maakt een account of meldt zich aan, en ziet en beheert daarna alles van het gezin.
- **Je eigen agenda delen met iemand buiten je gezin** (bv. een vriend): Instellingen → *Mijn agenda delen*.
  Die persoon ziet enkel de afspraken waaraan jij zelf deelneemt. Afspraken samen met je partner of kinderen
  ziet die persoon als "Niet beschikbaar – familiale reden"; afspraken van je gezin zonder jou en je taken,
  maaltijden of lijsten ziet die persoon nooit. Delen is persoonlijk: wie jouw vriend op zijn beurt uitnodigt,
  is alleen voor je vriend zichtbaar. Kies "alleen bezet" om enkel te tonen wanneer je bezet bent.
  Je kunt het delen altijd stoppen. Hij of zij kan met één tik terugdelen.
- **Rollen.** Een *beheerder* nodigt mensen uit, koppelt accounts aan profielen en kan toegang intrekken.
  Een *lid* gebruikt alles in het gezin.
- **Meerdere gezinnen.** Een account kan bij meerdere gezinnen horen en wisselt in Instellingen.

Wachtwoord vergeten kan nog niet via e-mail worden hersteld.

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
- variabelen `PORT=8080`, `DATA_DIR=/data`, `TZ=Europe/Brussels` en `ANTHROPIC_API_KEY`;
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
| `ANTHROPIC_API_KEY` | — | Sleutel voor de assistent. Niet verplicht: een beheerder kan de sleutel ook in de app invullen (Instellingen → Assistent); ze wordt gecontroleerd en in de database bewaard. |
| `ANTHROPIC_WORKSPACE_ID` | — | Alleen nodig als de sleutel niet aan een workspace gekoppeld is (Anthropic vraagt dan de header `anthropic-workspace-id`); ook in de app in te vullen. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model voor de assistent |
| `PORT` | `8080` | Poort van de server |
| `DATA_DIR` | `data` | Map voor database en foto's |
| `TZ` | `Europe/Brussels` | Tijdzone voor gekoppelde agenda's |
| `CALENDAR_SYNC_MINUTES` | `15` | Hoe vaak gekoppelde agenda's bijgewerkt worden |
| `LIBRARY_AUTOCRAWL` | `1` | `0` zet het automatisch opbouwen van de receptenbibliotheek uit |
| `LIBRARY_MAX_PER_SITE` | `4000` | Hoeveel recepten per receptsite maximaal opgehaald worden per (dagelijkse) beurt |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | automatisch | Sleutels voor pushmeldingen (worden anders zelf aangemaakt en bewaard) |

## Privacy

Alles blijft op je eigen server. Alleen deze gegevens verlaten je netwerk:

- de vragen aan de assistent, samen met de gezinsnamen en de agenda/taken/maaltijden die de assistent
  opvraagt, gaan naar de Claude API van Anthropic (ook zoeken en vertalen van recepten);
- de server haalt receptpagina's op van de receptsites die je kiest;
- je ingestelde woonplaats (coördinaten) gaat naar Open-Meteo voor het weer;
- de server haalt de gekoppelde iCal-adressen op.
