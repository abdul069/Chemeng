# Gezinsbord

Een gezinskalender voor een (staand) touchscreen in de keuken, naar het idee van een Cozyla-scherm.
Eén HTML-bestand, geen installatie of build nodig.

## Functies

- **Kalender** met dag-, week- en maandweergave
  - Dag: een kolom per gezinslid, met een lijn voor het huidige uur
  - Week: afspraken per dag; gedeelde afspraken tonen bolletjes per gezinslid
  - Maand: tik op een dag voor een overzicht
- **Gezinsleden** met eigen kleur en emoji; tik op een avatar om die persoon te verbergen of te tonen
- **Afspraken** toevoegen, wijzigen, verwijderen, met "hele dag" en "elke week herhalen"
- **Maaltijden**: weekmenu (ontbijt, lunch, diner); het menu van vandaag staat onder de dagweergave
- **Taken**: klusjes per gezinslid met icoontjes om af te vinken, met voortgang per dag
- **Assistent** (het blauwgroene figuurtje linksonder):
  - Begrijpt zonder internet Nederlandse opdrachten zoals
    "Zet volleybal op dinsdag om 17u voor Lina en Mama", "Wat staat er morgen?",
    "Wat is er dit weekend?", "Wat eten we vanavond?", "Welke taken heeft Noah nog?"
  - Spraak via de microfoonknop (Chrome/Edge/Android) en antwoorden worden voorgelezen
  - Met een Claude API-sleutel (Instellingen) beantwoordt hij ook open vragen en kan hij afspraken plannen

## Gebruiken

Open `index.html` in een browser. Op een tablet of scherm: zet de browser in volledig scherm of
"Toevoegen aan startscherm". Gegevens worden lokaal in de browser bewaard (localStorage).

Voor de microfoon moet de pagina via `https://` of `http://localhost` geladen worden, bijvoorbeeld:

```sh
npx serve familiehub
```

Bij de eerste start staat er een voorbeeldgezin in. Pas de gezinsleden aan via het tandwiel,
of zet de voorbeelddata terug via Instellingen.
