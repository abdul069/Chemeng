# Projectdossier — Kinday (code-werknaam Gezinsbord)

Stand: 21 oktober 2026 · tak `ccr-7a0c27b6-t5r72q` · laatste commit `5b0cc81` · 83 commits · 38 servertests slagen.

Dit document beschrijft het volledige project: wat het is, welke beslissingen vastliggen, hoe het technisch in elkaar zit, wat er gebouwd is, wat er nog komt en wat open staat. Het is bedoeld als één leesbaar overzicht voor eigenaar, ontwikkelaars en partners.

---

## 1. Wat het is

Een **huishoudplatform voor gezinnen** met twee gezichten op één codebasis:

- **De hub**: een groot aanraakscherm aan de muur (wandscherm) of op een standaard (tafelmodel) in de keuken of hal. Altijd aan, voor het hele gezin. Toont het Bord: de dag per gezinslid, eten, taken, prikbord, aftellers, de briefing van de manager, widgets van koppelingen, en wordt een fotolijst als niemand het aanraakt.
- **De telefoon-app**: elk gezinslid heeft zijn eigen app (Android via Capacitor, iPhone via PWA) met "Mijn dag": eigen afspraken, taken, lijsten, briefing, en een afstandsbediening voor het keukenscherm (cast).

Daarbovenop zit **de manager**: een AI-laag die elke ochtend en avond per persoon een briefing maakt, conflicten ziet, voorstellen doet die je met één tik aanvaardt (eten plannen, afspraak verzetten, boodschappen toevoegen, keuring in de agenda, verwarming lager) en onthoudt wat het gezin belangrijk vindt.

**Voor wie**: alle gezinnen, gesegmenteerd op levenssituatie (jonge kinderen, tieners, co-ouderschap, drie generaties, mantelzorg), **niet** op cultuur, religie of herkomst. Cultuur en religie zijn opt-in pakketten in de categorie "Kalenders en tradities" (gebedstijden, ezan, Koran, Ramadan en Bayram, Sinterklaas, Kerst, …), gelijkwaardig naast elkaar.

**Markt**: eerst België en Nederland, dan VK en Duitsland, dan verder. Elk land krijgt een landenpakket met eigen koppelingen (afval, vervoer, winkels, nieuws, weer, feestdagen, schoolvakanties).

---

## 2. Beslissingen die vastliggen

| Onderwerp | Beslissing |
|---|---|
| Platform | Eén codebasis, één server, twee rollen per toestel (hub of telefoon). Rol staat op het toestel; server houdt het toestelregister bij. |
| Doelgroep | Alle gezinnen, per levenssituatie. Nooit per gemeenschap, cultuur of godsdienst. Culturele en religieuze inhoud als opt-in pakket. |
| Naam | **Kinday** (beslist 21 oktober 2026). De merknaam is één instelling (`BRAND_NAME`, standaard "Kinday"; overal `{brand}` in de teksten). "Gezinsbord" blijft als interne werknaam in bestandsnamen en sleutels. "Kinvo" is afgevallen (Braziliaanse beleggingsapp met geregistreerd merk, en "Kinvo" van Kinvolved/PowerSchool). Bij een eerste webcheck is op Kinday niets gevonden; wel bestaat "Kindy" (één letter verschil). Nog te doen: merkonderzoek door een merkenbureau bij EUIPO en USPTO (klassen 9 en 42) en registratie van kinday.com en kinday.app. Tot dat rond is: geen drukwerk of hardware met de naam. |
| Basistaal | **Engels is de basistaal van het product**: de app, de briefings, de voorstellen, de koppelingen, feestdagen en meldingen bestaan in Engels, Nederlands en Turks (Instellingen → Taal). Later Frans, Duits, Spaans. In de code zijn de vertaalsleutels nog Nederlands; het omdraaien naar Engelse sleutels is een mechanische stap (zie §9). |
| Lanceervolgorde | België en Nederland eerst, daarna VK en Duitsland. |
| Koppelingen | Eén systeem: catalogus, alles standaard uit, eigenaar gezin of persoon, ouders zien de koppelingen van kinderen, koppelingen met kosten bij de aanbieder alleen in Gezin+, geen nieuw scherm per koppeling, maximaal zes widgets op het bord, onzichtbaar als er niets te melden is, landenpakketten. |
| School | Via de gezinsinbox (e-mail doorsturen, AI haalt afspraken en taken eruit). Geen Smartschool-API (bestaat niet voor derden). |
| Winkelen | Boodschappenlijst → zoekvak van de winkel (deeplink); kassatickets → voorraad via de inbox; folders en deals via een aggregator-feed (Promojagers, Tiendeo/ShopFully), nooit zelf folders scrapen of hosten; bestellen via partnerschappen met commissie. |
| Eten en vervoer | Deeplinks naar Takeaway, Uber Eats, Deliveroo, Uber, Bolt, Google Maps. Geen eigen bestelflow. |
| AI-kosten | Klein model (Haiku-klasse) voor sjabloonwerk (briefings, importeren, vertalen), middelgroot model (Sonnet-klasse) voor de chat-assistent, het grootste model nooit standaard. Maandbudget per gezin met terugval op sjablonen. |
| Prijzen | Zelf hosten gratis · Gezin €4,99/maand of €49/jaar · Gezin+ €8,99/maand. Hardware €449 incl. 1 jaar Gezin+, ledenprijs €349 (partner betaalt €50), huur €12,99/maand over 24 maanden, leden-huur €9,99, eigen tablet gratis + houder €39. |
| Partners | Ledenvoordeel (gratis upgrade of korting) voor leden van Gezinsbond, mutualiteiten, Test-Aankoop, werkgevers; feeds van Promojagers, Tiendeo/ShopFully, Colruyt Group. Ledencodes met verificatie (geen, e-maildomein, ledenlijst). |
| Hosting | Railway (EU). Later een VS-regio voor Amerika. Alles is per gezin gescheiden in de database, dus multi-regio is haalbaar. |

---

## 3. Architectuur

```
┌──────────────────────────────────────────────────────────────────────┐
│  Toestellen                                                          │
│  Hub (wandscherm / tafelmodel)      Telefoon (Android-app / PWA)     │
│  React 19 · Vite 7 · TypeScript · Capacitor 8 (Android)              │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ HTTPS /api/*                  │ WebSocket (realtime, cast)
┌───────────────▼───────────────────────────────▼──────────────────────┐
│  Server · Node 22 · Express 5 · TypeScript · node:sqlite · zod 4      │
│  Per gezin gescheiden via AsyncLocalStorage (hid())                   │
│  Modules: accounts, auth, store, events, recipes, library, nutrition, │
│  manager, billing, connectors, home, smarthome, family, prayer, ezan, │
│  quran, weather, holidays, push, realtime, importer, assistant        │
│  Schedulers: agenda-sync, bibliotheek-crawl, manager (briefings,      │
│  afval, medicatie, HA-scènes), koppelingen (elke 5 min)              │
└───────────────┬──────────────────────────────────────────────────────┘
                │
   SQLite (één bestand, 48 tabellen) · foto's op schijf · Claude API ·
   externe bronnen (Open-Meteo, iRail, KMI, RSS, UiTdatabank, alquran.cloud,
   Home Assistant van het gezin, iCal-agenda's, receptsites)
```

**Realtime**: elke wijziging stuurt een topic over de websocket (`members, events, chores, meals, recipes, lists, photos, calendars, settings, rewards, access, sharing, memos, devices, notes, family, home, connections`); schermen herladen alleen wat bij dat topic hoort. Cast-berichten (recept, scherm, bericht, briefje) gaan over dezelfde verbinding.

**Beveiliging**: sessies met cookie, wachtwoorden gehasht, ouder-pincode voor instellingen, koppelingsinstellingen en Home Assistant-token versleuteld met AES-256-GCM (sleutel uit `GB_SECRET` of een gegenereerde serversleutel), geheimen nooit naar de browser (gemaskeerd), alle queries per gezin gefilterd.

**Deploy**: Dockerfile + `docker-compose.yml`; Railway bouwt vanuit GitHub. Android-APK via GitHub Actions. Live-URL: `https://gezinsbord-production-69b1.up.railway.app`.

### Omgevingsvariabelen

| Variabele | Waarvoor |
|---|---|
| `ANTHROPIC_API_KEY` (of `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_WORKSPACE_ID`) | AI; zonder sleutel werken alle niet-AI-functies gewoon, assistent staat uit |
| `CLAUDE_MODEL_CHAT`, `CLAUDE_MODEL_LIGHT`, `CLAUDE_MODEL_PREMIUM` | modelkeuze per taak (standaard Sonnet-klasse, Haiku-klasse, Opus-klasse) |
| `DEFAULT_PLAN` | formule voor gezinnen zonder abonnement (standaard `gezin`) |
| `DATA_DIR`, `DB_FILE`, `WEB_DIR`, `PORT`, `TZ` | opslag en server |
| `BRAND_NAME` | merknaam die overal in de app en meldingen verschijnt (standaard "Kinday") |
| `GB_SECRET` | versleutelingssleutel voor koppelingen en HA-token |
| `GB_BUILD` | bouwnummer; verschilt het van het scherm, dan herlaadt de app |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | pushmeldingen |
| `CALENDAR_SYNC_MINUTES`, `LIBRARY_AUTOCRAWL`, `LIBRARY_MAX_PER_SITE`, `LIBRARY_MODEL` | agenda-sync en receptenbibliotheek |
| `UIT_API_KEY` | UiTdatabank (publiq) voor de koppeling UiTinVlaanderen |
| `DELIJN_API_KEY`, `MIVB_API_KEY` | gedeelde sleutels voor De Lijn en MIVB (anders vult elk gezin er zelf één in) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_GEZIN_MONTH`, `STRIPE_PRICE_GEZIN_YEAR`, `STRIPE_PRICE_PLUS_MONTH`, `STRIPE_PRICE_PLUS_YEAR`, `PUBLIC_URL` | betalen in de app via Stripe Checkout; zonder sleutel staat er "komt eraan" |
| `INBOX_IMAP_HOST`, `INBOX_IMAP_PORT`, `INBOX_IMAP_USER`, `INBOX_IMAP_PASS`, `INBOX_ADDRESS` | gedeelde mailbox voor de gezinsinbox (plus-adres per gezin) |
| `GEZINSBORD_URL`, `API_URL` | publieke URL (links in e-mails en app) |

---

## 4. Datamodel (48 tabellen)

| Groep | Tabellen |
|---|---|
| Accounts en toegang | `users, sessions, households, household_users, invites, shares, settings, global_settings, devices` |
| Agenda | `events, calendars` |
| Taken en beloningen | `chores, chore_done, rewards, reward_claims, learn_stars` |
| Eten | `meals, recipes, library, library_seen, dish_photos, staples, lists, list_items, diet_profiles, diet_log, weights` |
| Communicatie | `notes` (prikbord), `memos` (spraakmemo's), `push_subscriptions, push_sent` |
| Manager en netwerk | `memory, household_links` |
| Het huis | `upkeep, upkeep_log, waste, waste_dates, health` |
| Koppelingen | `connections` |
| Geld | `ai_usage, subscriptions, partners, partner_codes, partner_members` |
| Religie (opt-in) | `ezan_sounds, quran_cache` |
| Overig | `photos, assistant_feedback` |

Instellingen per gezin (tabel `settings`): gezinsnaam, woonplaats en coördinaten, fotolijst, weekstart, taal, feestdagen, nachtrust (`sleep_from`, `sleep_until`), terug-naar-Bord, ezan (`ezan_*`), Koran, briefings (`briefing_morning`, `briefing_evening`, `briefing_push`), land (`country`), afval (`waste_ical`, `waste_notify`), Home Assistant (`ha_url`, `ha_token`, `ha_entities`, `ha_scenes`), ouder-pincode.

---

## 5. Wat er gebouwd is (per onderdeel)

### 5.1 Kern (het oorspronkelijke Gezinsbord, ongeveer 80 % van de functies)

| Onderdeel | Inhoud |
|---|---|
| **Bord / Vandaag** | begroeting en weer, assistentvoorstellen, dagraster per gezinslid, straks eten (weekmenu-fotoraster), taken vandaag, prikbord, familie, Het huis, koppelingswidgets, aftellen |
| **Kalender** | dag (kolom per persoon), week, maand, lijst; herhalingen; meerdaags; "alleen deze dag" of "hele reeks"; snel toevoegen in natuurlijke taal; gekoppelde iCal-agenda's (Google, Outlook, iCloud) elk kwartier; feestdagen; gedeelde agenda's tussen personen |
| **Taken** | klusjes per persoon, per weekdag en dagdeel, sterren, beloningen en spaarpot, weekklassement, profielen, huisdieren |
| **Maaltijden en recepten** | weekmenu, receptenbibliotheek met foto's, zoeken op receptsites, importeren via link, vertalen met origineel bewaard, portiecalculator, kookmodus, "Week vullen", "Boodschappen voor de week", voedingswaarde en allergenen, dieetdagboek en caloriedoel per persoon |
| **Receptenbibliotheek** | automatisch gecrawld vanuit sitemaps van receptsites, categorieën, zoeken NL/TR, met één tik in eigen bibliotheek |
| **Lijsten** | boodschappen per winkelafdeling, vaste producten, voorraad met houdbaarheid, boodschappen ↔ voorraad synchroon, "Koken met wat in huis is", delen via WhatsApp/sms/e-mail |
| **Foto's en fotolijst** | uploads, screensaver met klok, weer en volgende afspraak |
| **Apps** | prikbord, Het huis, foto's, weer, klok en timers, spraakmemo's, recepten, gebedstijden en ezan, Koran, leren en spelen, dieet, snelkoppelingen (YouTube, Spotify, Google, Netflix, WhatsApp, nieuws), instellingen |
| **Leren en spelen (kids)** | Islam-spelletjes (quiz, woordparen, op volgorde, soera's leren) en rekenen (sommen, tafels, snelheidsronde), sterren in de spaarpot |
| **Assistent** | Claude met tools: afspraken, maaltijden, recepten, lijsten, taken, geheugen; handsfree spraak, voorlezen; antwoordt in de gekozen taal |
| **Zoeken** | één zoekvak over afspraken, recepten, lijsten, taken, bibliotheek |
| **Taal** | Engels, Nederlands en Turks, ~1.340 teksten per taal, datums, feestdagen, briefings en meldingen in de gekozen taal |
| **Accounts** | registreren, aanmelden, gezinnen, uitnodigingen (gezin, agenda, gezinskoppeling), rollen beheerder/lid, wachtwoordherstel-link, back-up downloaden |
| **Android-app** | Capacitor, ezan-alarmen met gesloten app, batterijbeperking, APK via GitHub Actions |

### 5.2 Gezinsbord 2.0: hub en telefoon-app (commit `67fc43a`, `18e613a`)

Toestelrol bij eerste start (wandscherm, tafelmodel, telefoon, van wie), Mijn dag op de telefoon met vijf tabbladen, cast naar het keukenscherm (recept, Bord, bericht), prikbord met gekleurde briefjes, toestellenregister met online-status en QR-koppeling, grote letters voor grootouders, zelfherstel na een update (stale chunks), dekkend assistentvenster op de telefoon.

### 5.3 De manager (commit `4b020ba`)

Ochtendbriefing en avondafsluiting per gezinslid en voor het gezin: afspraken, vroeg op, taken, eten, weer, gebed, aftellen, voorraad, boodschappen, onderhoud, afval, gezondheid en medicatie, slim huis, koppelingen. Voorstellen met één tik: `plan_meal, move_event, add_list, remind, upkeep_event, ha_service, link`. Conflictdetectie met eerste vrije plek. Sjabloontekst, verrijkt door het kleine AI-model als het budget het toelaat; zes uur cache. Gezinsgeheugen (`memory`) via assistent en instellingen. Pushmeldingen op vaste uren; hubs verversen de briefingkaart.

### 5.4 Gezinsnetwerk (commit `9cac762`)

Gezinnen verbinden over huizen heen (grootouders, co-ouder, familie in het buitenland) via een eenmalige link. Elk gezin kiest wat het deelt: agenda (titels en uren), foto's, prikbord, verjaardagen. Familie-widget op Bord en Mijn dag; briefjes naar het andere huis met afzender en gezinsnaam.

### 5.5 Geld (commit `95d1561`)

- Modelkeuze per taak: `chat` (Sonnet-klasse), `light` (Haiku-klasse, voor briefings, importeren, vertalen), `premium` (nooit standaard).
- Verbruik per gezin in microdollar (`ai_usage`), maandbudget per formule: free 0, gezin $2,50, plus $8, operator onbeperkt. Chat en zoeken stoppen op het budget; sjabloonwerk mag tot 120 %. Nette budgetboodschap in NL/TR.
- Abonnementen (`subscriptions`), operator = eerste gezin op de server, `DEFAULT_PLAN`.
- Partners, ledencodes en ledenlijsten: `redeem(code, identifier)` met verificatie `none | domain | list`, gratis maanden en korting daarna, partnerstatistieken, operator-only partnerbeheer in Instellingen → Abonnement.
- **Betalen in de app** (`server/src/stripe.ts`): Stripe Checkout voor Gezin en Gezin+ per maand of per jaar (knoppen in Instellingen → Abonnement, alleen beheerder), klantenportaal (kaart, factuur, opzeggen), webhook `POST /api/billing/stripe/webhook` met HMAC-handtekening en ruwe body, idempotent (`stripe_events`); `customer.subscription.*` zet de formule (`source: "stripe"`, geldig tot periode-einde + 3 dagen), opzegging valt terug op `DEFAULT_PLAN`. Ledenkorting na de gratis periode via coupon `STRIPE_COUPON_<pct>`. Geen SDK, gewone HTTPS-calls. Zonder sleutel: "komt eraan".

### 5.6 Koppelingen-kader (commit `8e88e4a`)

- `server/src/connectors.ts`: elke koppeling is een module met vaste vorm: id, naam, categorie, eigenaar (gezin of persoon), formule (gezin of plus), landen, status (`ready | unofficial | soon`), velden (met type `secret` voor sleutels), wat ze levert (`calendar, briefing, widget, links, proposal`), verversinterval, en functies `sync, briefing, proposals, widget, calendar, links`.
- Opslag in `connections` met AES-256-GCM-versleutelde instellingen; geheimen gemaskeerd naar de browser; masker terugsturen laat het geheim staan.
- Scheduler elke vijf minuten; status en foutmelding per koppeling; handmatig verversen.
- Catalogus gefilterd op land, met aanbevelingen; plan-poort (402) voor Gezin+-koppelingen.
- Zichtbaar op bestaande plekken: widgets op Bord (gezinsbreed + "ook op het bord") en Mijn dag (eigen), "Zoek bij …" op de boodschappenlijst, Uber- en routeknoppen bij een afspraak met adres, agenda-laag (alleen-lezen), briefingregels (max. twee per koppeling) en voorstellen (max. één).
- UI: Instellingen → Koppelingen (wat aan staat met status, aanbevolen, zoeken, hele catalogus per categorie, één formulier per koppeling met persoonkeuze en "ook op het Bord").

**Koppelingen die werken**

| Koppeling | Eigenaar | Levert | Bron |
|---|---|---|---|
| Afvalkalender (iCal) | gezin | briefing, afvalmelding | iCal van de intercommunale (Limburg.net, Ilva, IVAREM, IOK, Interza, …) |
| Trein (NMBS) | persoon | briefing, widget | iRail API |
| KMI-waarschuwingen | gezin | briefing, widget | RSS van meteo.be |
| Nieuws (RSS) | persoon | widget | elke RSS/Atom-feed |
| Jouw winkels | gezin | lijstknoppen, folderwidget | deeplinks Collect&Go, Delhaize, Carrefour Drive, Albert Heijn, Lidl, Aldi, Jumbo, Kruidvat |
| Eten bestellen | gezin | voorstel 's avonds als er niets gepland is, links | deeplinks Takeaway, Uber Eats, Deliveroo |
| Rit bestellen | persoon | knoppen bij afspraak met adres | Uber-deeplink, Google Maps-route |
| UiTinVlaanderen | gezin | widget, briefing op vrijdag | UiTdatabank (publiq), API-sleutel nodig |

| Schoolvakanties | gezin | agendalaag, briefing de dag ervoor | vaste data Vlaanderen, Wallonië-Brussel, Nederland noord/midden/zuid (2026-2028) |
| Webhooks (Siri, IFTTT, n8n) | gezin, Gezin+ | boodschappen, briefje of afspraak van buitenaf | geheime sleutel per gezin, `POST /api/hooks/<sleutel>` |
| Folders en deals (partnerfeed) | gezin | promo's in het prijsgeheugen | JSON-feed van een partner (Promojagers, Tiendeo/ShopFully, een keten) |

| Gezinsinbox | gezin | briefing, widget, scherm "Gezinsinbox" | IMAP: eigen mailbox van het gezin, of de gedeelde mailbox van de operator (`INBOX_IMAP_HOST/USER/PASS`, `INBOX_ADDRESS`) met een plus-adres per gezin (`inbox+code@domein`). Elke 5 minuten; het kleine AI-model maakt van een mail afspraken en boodschappen (importer) of van een ticketfoto prijzen (prijsgeheugen). Nakijken en met één tik toepassen. Zonder AI-sleutel blijft de tekst leesbaar. Route `/inbox/raw` voor een mailserver die rechtstreeks doorstuurt. Zelfde verwerking (`processMessage`) voor de Telegram-bot. |
| Tuya / Smart Life | plus | widget, Slim huis | `server/src/tuya.ts`: Tuya Cloud OpenAPI (HMAC-SHA256-handtekening, token-cache), Access ID/Secret/regio van een cloudproject met het Smart Life-account eraan gekoppeld. Apparaten (Action LSC, Lidl Silvercrest, Nedis, Calex, …) worden entiteiten zoals in Home Assistant (`light.tuya_…`, `switch.`, `climate.`, `binary_sensor.`, `sensor.`) en verschijnen in Het huis → Slim huis naast HA; `/ha/states` voegt beide samen, `/ha/call` stuurt Tuya-entiteiten naar de Tuya-cloud (aan/uit, dimmen, thermostaat-instelpunt, schaal ×10 herkend). Later: eigen Tuya-client-ID zodat gezinnen alleen een QR scannen. |
| Telegram-bot | gezin | briefing, widget | `server/src/telegram.ts`: het gezin maakt via @BotFather een bot en plakt de token; elke minuut `getUpdates`; tekst, foto of beeldbestand → gezinsinbox (kassaticket → prijzen, brief → afspraken en boodschappen); de bot antwoordt in de gezinstaal; `/start` geeft uitleg. Geen operator-sleutel nodig. |

**Zichtbaar als "Binnenkort"**: De Lijn, MIVB (vragen een API-sleutel), Recycle!, Teams-status, Withings, Telegram-bot.

### 5.7 Het huis (commits `1fc087f`, `5b0cc81`)

App "Het huis" met vier tabbladen en een widget op het Bord die alleen verschijnt als er iets te doen is.

| Tab | Inhoud |
|---|---|
| **Onderhoud en keuringen** | 21 Belgische sjablonen (autokeuring, autoverzekering, banden, CV gas/stookolie, schoorsteen, rookmelders, CO-melder, brandblusser, ventilatiefilters, waterverzachter, boiler, dakgoten, septische put, zonnepanelen, brandverzekering, hospitalisatie, meterstanden, Kids-ID, paspoort, huisdier), eigen items, interval in maanden, uiterste datum, verwittigen vooraf, wie regelt het, firma met telefoon en afspreeklink, kosten, notities, afvinken met datum en notitie (volgende datum schuift vanzelf), attest of foto bewaren, logboek, status in orde / binnenkort / nu plannen / te laat. De manager zet een keuring op voorstel in de agenda. |
| **Afvalkalender** | komende ophalingen, iCal van de intercommunale inlezen, vaste ophaaldagen per fractie (rest, PMD, papier, GFT, glas, grof, textiel, snoeihout), melding de avond ervoor. |
| **Gezondheid** | per persoon: doktersbezoeken, controles met automatische opvolging (na X maanden staat de volgende klaar), vaccins, medicatie met innametijden, dagen en voorraad; medicatie in de briefing van die persoon en als pushmelding op het uur. |
| **Slim huis** | Home Assistant koppelen (adres en token, versleuteld), toestellen kiezen voor het bord, lampen en schakelaars schakelen, sloten en rolluiken bedienen, scènes en scripts starten, momenten (ochtend, slapen, weg, thuis, gebedstijd) die automatisch lopen op de slaaptijden, de ezan en het aanwezigheidsgevoel van HA. De manager stelt voor de verwarming lager te zetten als niemand thuis is. |

### 5.8 Prijsgeheugen (ronde Weekbox, stap 1)

Wat kostte wat, waar en wanneer. Bronnen: kassaticket (foto, het kleine AI-model leest winkel, datum, regels en prijzen), prijsetiket in de winkel (foto), handmatig. Elke prijs wordt omgerekend per kg, liter of stuk. Op de boodschappenlijst en in de voorraad staat bij elk item de laatste prijs en waar het goedkoper is; bij "Prijzen" de beste winkel voor de hele lijst (per winkel totaal en dekking, en de besparing bij splitsen), het prijsverloop per product en de uitgaven per maand per winkel uit de tickets. Een folderpagina fotograferen zet de promo's met einddatum in het geheugen (bron "deal"); een lopende promo wint in de vergelijking en staat als 🏷️ op de lijst, een verlopen promo telt niet meer mee. Een ingelezen ticket vinkt gekochte items af op de boodschappenlijst (ze gaan naar de voorraad) en zet de rest in de voorraad. Tabellen `receipts` en `prices`; routes onder `/prices`. Gedeelde, anonieme prijzen over gezinnen heen (opt-in) komen in een latere ronde.

### 5.9 Weekbox (ronde Weekbox, stap 3)

Maaltijden → "✨ Weekbox": kies de avonden (standaard vanaf vandaag), de manager stelt per avond een gerecht voor: snel (≤ 35 min) op avonden met een afspraak tussen 16u30 en 19u30, met wat binnen vier dagen vervalt in de voorraad, zonder wat iemand vermijdt, niet wat de voorbije twee weken op tafel stond, elk recept één keer, lievelingen licht bevoordeeld; geen ontbijt, dessert, drank of saus als avondeten. "Andere" geeft een ander voorstel, ✕ slaat een avond over, "Plannen" zet alles in het weekmenu. Daarna het mandje: alle ingrediënten gebundeld (twee recepten met ui = één regel), geschaald van de porties van het recept naar het aantal gezinsleden, wat in de voorraad staat grijs, per item de goedkoopste bekende prijs en winkel, een schatting van het totaal, "Zoek bij …" en "Op de boodschappenlijst" zonder dubbels. De zondagavondbriefing wijst op een lege week. Server `weekbox.ts`, routes `/meals/weekbox/*`.

### 5.10 Routinepakketten (Taken)

Per gezinslid een knop "Routine": kant-en-klare dagelijkse taken (aankleden, tanden poetsen ochtend en avond, bed opmaken, boekentas, huiswerk op schooldagen, 10 minuten lezen, kamer opruimen, pyjama, schermen uit, tafel, vaatwasser, huisdier, planten, vuilnis, eigen was) in vier groepen, met een voorstel per leeftijd (kleuter, lagere school, tiener) dat uit de verjaardag geraden wordt. `server/src/routines.ts`, routes `GET/POST /chores/routines`; titels in NL/TR/EN; wat al bestaat wordt overgeslagen. Afvinken, sterren, reeksen en het feestje als alles af is bestonden al in Taken. **Herinneringen**: op een ochtend- en avonduur (Instellingen → De manager, standaard 07:45 en 19:30) krijgt wie nog routinetaken open heeft een pushmelding met de lijst, op de eigen telefoon of via de ouders (`routineReminders` in manager.ts). **Weekoverzicht** in het profiel van elk gezinslid: per dag gedaan/totaal, sterren en volle dagen (`GET /chores/week`).

### 5.11 Kindertablet (toestelrol "kid")

Een gewone Android-tablet wordt een tablet voor één kind. Toestelrol **Kindertablet** bij de eerste start of bij Instellingen → Toestellen (kies het kind). Scherm `web/src/screens/Kid.tsx`: grote tegels Mijn dag (routine per dagdeel afvinken met sterren en feestje, afspraken van vandaag), Leren & spelen, Koran (als het pakket islam aanstaat), Foto's, Wat eten we?, en de apps die de ouders toelaten. Geen menu, geen assistent, geen instellingen. **Bedtijd** (`kid_bedtime_from/until`) toont een gedimde slaapkaart; **schermtijd per dag** (`kid_screen_minutes`, telt per kwartier op het toestel) stopt het spelen. **Ouderpoort**: lang drukken bovenaan → pincode → 30 minuten extra, oudermodus (volledige app met terugknop) of toestelrol wijzigen. Instellingen → Kindertablet (`components/KidSettings.tsx`): bedtijd, schermtijd, toegelaten apps (pakketnaam en webadres, voorstellen zoals YouTube Kids en Ketnet), kiosk-status en de QR-code voor provisionering.

**Android** (`KioskPlugin.java`, `KioskAdminReceiver.java`): Kinday kan het startscherm zijn (HOME-intent), en als *device owner* zet het de tablet in lock task mode (geen meldingenbalk, geen andere apps behalve de toegelaten pakketten) en opent het toegelaten apps op pakketnaam. Device owner worden gaat via **QR-provisionering** op een fabrieksnieuwe tablet: de Android-workflow maakt bij een ondertekende release `provisioning.json` (download-URL van de APK plus checksum) en zet die in de release; `GET /kiosk/provisioning` haalt hem op en Instellingen toont de QR. Zonder keystore werkt alles behalve de echte vergrendeling.

### 5.12 Kalenders en tradities (opt-in, aanwezig)

Pakketten bij Instellingen → Feestdagen, vrij te combineren: 🇧🇪 Belgische feestdagen, 🇳🇱 Nederlandse feestdagen (Koningsdag verschuift naar zaterdag als 27 april een zondag is), 🎁 Sinterklaas, advent en Kerst (adventsaftelling op het Bord), 🌙 Ramadan, Suiker- en Offerfeest (tijdens de ramadan een widget met dag x van 30, iftar met aftelling, sahur en de datum van het Suikerfeest). Alles komt in de agenda als alleen-lezen laag en in het aftellen, in de taal van het gezin. Route `/traditions/today`. **Bayram-modus**: een week vóór en tijdens Suiker- en Offerfeest een widget op het Bord met aftelling of dag x, hoeveel familiebezoeken in de agenda staan (Plannen), feestboodschappen met één tik op de lijst (`POST /traditions/bayram-list`, NL/TR/EN) en een sprong naar het weekmenu.

**Leren & spelen per leeftijd** (`web/src/learn-age.ts`): de leeftijdsgroep (kleuter, lagere school, tiener) komt uit de verjaardag en is per kind te wisselen. Kleuter: kleuren, dieren(geluiden), tellen, vormen, zonder lezen (vraag wordt voorgelezen, antwoorden zijn plaatjes; op de kindertablet leest een tik op het plaatje van een taak die voor). Lagere school: rekenen (sommen, tafels, snelheidsronde, klok lezen), lezen, spelling, Engels, wereld. Tiener: hoofdsteden, Frans, Engels, wetenschap en wereld. Islam-spelletjes alleen als het pakket aanstaat. Alles met grote plaatjes, voorlezen, sterren voor de spaarpot. Toegelaten apps op de kindertablet openen via de pakketnaam; niet geïnstalleerd → Play Store-pagina met een melding voor de ouders.

Gebedstijden (astronomisch berekend, elf methodes, asr-school, bijstellen per gebed), ezan op elk scherm met eigen geluiden, Koran (114 soera's, vertalingen NL/TR/EN/FR, audio per vers, achtergrondspeler), islamitische feestdagen tot 2028, Belgische feestdagen, islam-leerspelletjes voor kinderen. Alles staat standaard uit.

---

## 6. API (185 routes, gegroepeerd)

| Groep | Voorbeelden |
|---|---|
| Auth en accounts | `/auth/*`, `/me`, `/households`, `/invites`, `/access/*`, `/shares` |
| Bootstrap en instellingen | `/bootstrap`, `/settings`, `/backup` |
| Agenda | `/events` (met iCal- en koppelingslagen), `/calendars`, `/holidays` |
| Taken | `/chores`, `/chores/:id/done`, `/rewards`, `/points` |
| Eten | `/meals`, `/recipes`, `/library/*`, `/nutrition/*`, `/diet/*`, `/photos` |
| Lijsten | `/lists`, `/lists/:id/items`, `/staples` |
| Communicatie | `/notes`, `/memos`, `/push/*`, `/cast`, `/devices` |
| Manager | `/manager/briefing`, `/manager/apply`, `/manager/memory` |
| Netwerk | `/family/links`, `/family/feed`, `/family/links/:id/note` |
| Het huis | `/upkeep`, `/upkeep/templates`, `/upkeep/:id/done`, `/upkeep/:id/attest`, `/waste`, `/waste/sync`, `/care`, `/care/:id/done`, `/ha/states`, `/ha/call`, `/ha/moment`, `/ha/test` |
| Koppelingen | `/connectors`, `/connections`, `/connections/:id/sync`, `/connections/widgets`, `/connections/links` |
| Geld | `/billing`, `/billing/redeem`, `/billing/plan/:householdId`, `/partners*` |
| Religie | `/prayer`, `/ezan/*`, `/quran/*` |
| Assistent | `/assistant`, `/assistant/key`, `/import` |
| Overig | `/weather`, `/health` (healthcheck), `/search` |

---

## 7. Verdienmodel

| Formule | Prijs | Inhoud |
|---|---|---|
| Zelf hosten | gratis | alles, eigen server en eigen AI-sleutel, geen budgetgrens |
| Gezin | €4,99/maand of €49/jaar | manager, briefings, 150 assistentvragen per maand (budget $2,50), gezinsinbox, koppelingen zonder kosten bij de aanbieder |
| Gezin+ | €8,99/maand | onbeperkte assistent binnen budget $8, gezinsnetwerk, slim huis, koppelingen met kosten bij de aanbieder |

**Hardware**: wandscherm of tafelmodel €449 incl. 1 jaar Gezin+; ledenprijs €349 (partner betaalt €50); huur €12,99/maand over 24 maanden; leden-huur €9,99; eigen tablet gratis + houder €39.

**Partnerinkomsten**: ledenvoordeel (partner betaalt een deel), affiliate-commissie op bestellingen (Takeaway, Deliveroo, Uber Eats, supermarkten), aggregator-feeds voor folders en deals.

**Kostenbeheersing AI**: klein model voor alles wat sjabloonwerk is, chat alleen op het middelgrote model, budget per gezin, cache van zes uur op briefings, sjabloon als terugval. Doel: AI-kost onder 25 % van de abonnementsprijs.

---

## 8. Roadmap

| Stap | Status | Inhoud |
|---|---|---|
| 1. Geld | ✅ klaar | modelkeuze, budget, abonnementen, partnercodes, partnerdashboard |
| 2. Koppelingen-kader | ✅ klaar | kader, catalogus, versleuteling, acht werkende koppelingen |
| 3. Het huis | ✅ klaar | vier tabbladen en widget |
| **Merk en taal** | ✅ klaar | merknaam als instelling (`BRAND_NAME`), Engels als derde taal op web en server (1.340 teksten, briefings, koppelingen, feestdagen, meldingen), taalkeuze EN/NL/TR |
| **Weekbox** | ✅ stap 1–3 | prijsgeheugen ✅; beste winkel en prijsverloop ✅; Weekbox-wizard ✅ (avonden kiezen, voorstel per avond op maat van agenda, dieet, voorraad en variatie, "Andere", plannen, gebundeld mandje geschaald naar het gezin met voorraad eraf en prijsschatting, op de boodschappenlijst); nog: stap 4 productkoppeling per keten, stap 5 mandje vullen via partner-API (Colruyt Group, Ahold Delhaize, Jumbo, Picnic) |
| 4. Rondes van koppelingen | bezig | ✅ schoolvakanties, webhooks, folders en deals (foto en partnerfeed), gezinsinbox (IMAP, plus-adres per gezin, extractie via AI), barcode scannen op de lijsten (camera of intikken, Open Food Facts), Telegram-bot van het gezin (eigen BotFather-token, foto of tekst → gezinsinbox, bevestiging in de gezinstaal), Tuya / Smart Life (Action, Lidl, Nedis en andere Smart Life-merken zonder Home Assistant); De Lijn en MIVB (realtime doorkomsten aan je halte, gratis sleutel per gezin of `DELIJN_API_KEY`/`MIVB_API_KEY` voor iedereen); nog: NEVO, Teams-status (Azure-app), Apple Health en Withings (OAuth-app), Twizzit, rechtstreekse merkkoppelingen; PSD2 als laatste |
| 5b. Kindertablet | ✅ | toestelrol kind, kinderscherm, bedtijd, schermtijd, toegelaten apps, ouderpoort met pincode, Android launcher en lock task, QR-provisionering (vraagt ondertekende APK); nog: testen op een echte tablet (Denver), scènes en pushmeldingen naar de kindertablet |
| 5. Hub als apparaat | grotendeels ✅ | ✅ widgets op het Bord herschikken en verbergen (Instellingen → Scherm), ✅ volledig scherm zonder statusbalk op de hub (Android), wake lock en nachtrust bestonden al; ✅ GitHub Actions bouwt met keystore-secrets de ondertekende APK en de Play Store-bundle (.aab); ✅ handmatige iOS-workflow (`.github/workflows/ios.yml`, macOS, compileert zonder ondertekening; .ipa met Apple-secrets); nog: dimmen op omgevingslicht, keystore en Apple-account van de eigenaar |
| 6. Kalenders en tradities | deels ✅ | ✅ Ramadan-modus, Bayram-modus, Sinterklaas en Kerst met adventsaftelling, BE- en NL-feestdagen; nog: pakketten voor andere landen (UK, DE, FR, TR, MA) |
| 7. Zakelijk, parallel | lopend | merkonderzoek, Gezinsbond, een mutualiteit, Promojagers, Tiendeo/ShopFully, Colruyt Group, affiliate-aanmeldingen, leasing- en fulfilmentpartner, Test-Aankoop later |

---

## 9. Open punten en risico's

1. **Merkonderzoek Kinday.** De naam is gekozen; een merkenbureau moet EUIPO en USPTO checken (klassen 9 en 42) en de domeinen kinday.com en kinday.app moeten geregistreerd worden voor er drukwerk of hardware komt.
2. **Deploy.** Op 21 en 22 oktober had Railway een platformstoring: builds voor Hobby-accounts waren uitgeschakeld ("Limited Access"), vandaar dat de live versie op `185c0de` bleef hangen. Sindsdien bouwt **GitHub Actions de Docker-image** (`.github/workflows/image.yml` → `ghcr.io/abdul069/kinday:latest`) en start Railway alleen nog die image (bron "Docker image" met een GitHub-token met `read:packages`); de workflow laat Railway na elke build herstarten via een project-token (`RAILWAY_TOKEN`). Railway hoeft dus niets meer te bouwen. Controle na een deploy: Instellingen → Over toont het bouwnummer.
3. **Engelse sleutels in de code.** Engels, Nederlands en Turks werken volledig; de vertaalsleutels in de code zijn nog Nederlands. Het omdraaien (Engelse sleutels, NL en TR als woordenboeken) is een scriptmatige stap zodra de naam vastligt. Valuta en maten per land volgen met de landenpakketten.
4. **UiTinVlaanderen** vraagt een gratis API-sleutel van publiq (`UIT_API_KEY`), anders moet elk gezin er zelf een invullen.
5. **Gezinsinbox**: gebouwd; om de gedeelde inbox aan te zetten zijn een mailbox met IMAP en een domein nodig (`INBOX_IMAP_*` in Railway), anders vult elk gezin zijn eigen mailbox in.
6. **Betalen in de app** is gebouwd maar staat uit tot de Stripe-sleutels in Railway staan: in Stripe twee producten (Gezin, Gezin+) met maand- en jaarprijs aanmaken, de `price_…`-id's en de geheime sleutel invullen, een webhook naar `https://<domein>/api/billing/stripe/webhook` zetten met de gebeurtenissen `checkout.session.completed` en `customer.subscription.*`, en `STRIPE_WEBHOOK_SECRET` invullen. Tot dan zet de operator de formule of gebruikt het gezin een ledencode.
7. **Juridisch**: GDPR-documentatie, verwerkersovereenkomsten met partners, gezondheidsgegevens (bijzondere categorie) alleen per gezin en versleuteld in rust op de hosting.
8. **Stemmen** klinken nog te robotachtig (Android-stem in de app, Chrome-stem op het web). Later herzien: een natuurlijke stem via een cloud-dienst (bv. Google Cloud TTS WaveNet of ElevenLabs) met cache per zin, zodat kleuters een warme stem horen; kostenbeheersing door korte zinnen en hergebruik.
9. **Distributie** is het grootste risico: zonder partners (Gezinsbond, mutualiteit, retailer) is de hardware moeilijk te verkopen.

---

## 10. Ontwikkelen en testen

```bash
# server
cd server && npm install
rm -rf /tmp/gezinsbord-test && npm test          # 49 tests
npx tsc --noEmit -p .                            # typecheck
DATA_DIR=/tmp/gb PORT=8100 LIBRARY_AUTOCRAWL=0 npx tsx src/index.ts

# web
cd web && npm install
npx tsc -b && npx vite build                     # typecheck en bundel
npx vite                                         # dev-server met proxy naar de API
```

Tests: `accounts, devices, manager, family, home, billing, connectors, recipes/importer`. End-to-end wordt met Playwright tegen een lokale server gecontroleerd (login, hub- en telefoonrol via `localStorage gb.device`).

Belangrijke bestanden:

| Bestand | Rol |
|---|---|
| `server/src/routes.ts` | alle API-routes (1.200 regels) |
| `server/src/db.ts` | schema, migraties, instellingen, per-gezin context |
| `server/src/store.ts` | gezinsleden, taken, maaltijden, recepten, lijsten |
| `server/src/manager.ts` | briefings, voorstellen, geheugen, scheduler |
| `server/src/connectors.ts` | koppelingen-kader en de koppelingen zelf |
| `server/src/home.ts`, `smarthome.ts` | onderhoud, afval, gezondheid, Home Assistant |
| `server/src/billing.ts` | modellen, verbruik, budget, abonnementen, partners |
| `web/src/App.tsx` | rollen, navigatie, cast, schermen |
| `web/src/screens/*` | Bord, Mijn dag, Kalender, Taken, Maaltijden, Lijsten, Apps, Instellingen, Toegang |
| `web/src/components/*` | Briefing, Connectors, Home, Family, Billing, Devices, Recipes, Diet, Learn, Prayer, Quran, … |
| `web/src/i18n.ts`, `i18n.tr.ts` | vertaling (nu Nederlands als sleutel) |
| `web/src/device.ts` | toestelrol, registratie, cast |

---

## 11. Productplan

Het uitgebreide productplan (positionering, markt en groeipad, partnerprogramma, prijzen, roadmap met motivering) staat als levend document op <https://claude.ai/artifact/TuutbBJkoVUX3dtf5hb112>. Dit dossier is de technische en functionele samenvatting van dat plan en van de code.
