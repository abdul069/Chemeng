// De gezinsassistent: Claude met tools die de kalender, maaltijden, taken en lijsten lezen en aanpassen.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { createEvent, deleteEvent, eventsBetween, getEvent, skipOccurrence, type CalEvent } from "./events.js";
import {
  addItem, choresOn, createChore, createList, createRecipe, doneBetween, findList, listLists, listMembers, listRecipes, mealsBetween,
  memberByName, pantryList, recipeBySource, RecipeInput, setChoreDone, setMeal, SLOTS,
} from "./store.js";
import { fetchRecipe, searchTurkishRecipes, translateRecipe, RecipeError } from "./recipes.js";
import { libraryList, libraryCategories, addToFamily } from "./library.js";
import { getSettings, hid } from "./db.js";
import { fillMissingPhotos } from "./dishphotos.js";
import { broadcastTo } from "./realtime.js";
import { addDays, today, weekday } from "./dates.js";
import { getWeather } from "./weather.js";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
import { getClient, aiReady } from "./ai.js";
export const assistantAvailable = () => aiReady();

export type Change =
  | { kind: "event_added"; event: CalEvent }
  | { kind: "event_removed"; title: string }
  | { kind: "meal"; date: string; slot: string; title: string }
  | { kind: "chore"; title: string; member: string }
  | { kind: "list"; list: string; items: string[] }
  | { kind: "options"; options: string[] }
  | { kind: "recipe"; id: string; title: string; image: string | null };

const DAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Datum als YYYY-MM-DD");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe("Tijd als HH:MM (24 uur)");

function memberIds(names: string[] | undefined): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const n of names ?? []) {
    if (/^(iedereen|gezin|familie|allemaal)$/i.test(n.trim())) {
      ids.push(...listMembers().map((m) => m.id));
      continue;
    }
    const m = memberByName(n);
    if (m) ids.push(m.id);
    else unknown.push(n);
  }
  return { ids: Array.from(new Set(ids)), unknown };
}
const names = (ids: string[]) => ids.map((id) => listMembers().find((m) => m.id === id)?.name ?? "?");

function buildTools(changes: Change[]) {
  return [
    betaZodTool({
      name: "agenda_bekijken",
      description: "Geeft de afspraken in de gezinskalender tussen twee datums (inclusief), met id, tijden en voor wie.",
      inputSchema: z.object({ van: date, tot: date, gezinsleden: z.array(z.string()).optional().describe("Alleen afspraken van deze namen") }),
      run: async ({ van, tot, gezinsleden }) => {
        if (tot < van) return "De einddatum ligt voor de begindatum.";
        const { ids } = memberIds(gezinsleden);
        const list = eventsBetween(van, addDays(van, Math.min(62, (Date.parse(tot) - Date.parse(van)) / 864e5)), ids);
        if (!list.length) return "Geen afspraken in deze periode.";
        return list.map((o) => `${o.on} (${DAYS[weekday(o.on)]}) ${o.allDay ? "hele dag" : `${o.startTime}-${o.endTime}`} | ${o.title}${o.location ? ` @ ${o.location}` : ""} | ${names(o.members).join(", ") || "gezin"} | id=${o.id}${o.repeat !== "none" ? ` (herhaalt ${o.repeat})` : ""}${o.readOnly ? " (externe agenda, alleen lezen)" : ""}`).join("\n");
      },
    }),
    betaZodTool({
      name: "afspraak_toevoegen",
      description: "Zet een nieuwe afspraak in de gezinskalender. Laat begintijd weg voor een afspraak die de hele dag duurt. Zonder eindtijd duurt een afspraak een uur.",
      inputSchema: z.object({
        titel: z.string().min(1),
        datum: date,
        begintijd: time.optional(),
        eindtijd: time.optional(),
        einddatum: date.optional().describe("Alleen voor afspraken die meerdere dagen duren"),
        gezinsleden: z.array(z.string()).describe("Namen van de betrokken gezinsleden, of ['iedereen']"),
        herhaling: z.enum(["none", "daily", "weekly", "biweekly", "monthly", "yearly"]).optional(),
        locatie: z.string().optional(),
        notities: z.string().optional(),
        aftellen: z.boolean().optional().describe("Toon een aftelling op het startscherm (vakantie, feest, grote dag)"),
      }),
      run: async (i) => {
        const { ids, unknown } = memberIds(i.gezinsleden);
        if (unknown.length) return `Onbekende gezinsleden: ${unknown.join(", ")}. Gezinsleden zijn: ${listMembers().map((m) => m.name).join(", ")}. Vraag na wie bedoeld wordt.`;
        const ev = createEvent({
          title: i.titel, date: i.datum, endDate: i.einddatum ?? null, startTime: i.begintijd ?? null, endTime: i.eindtijd ?? null,
          allDay: !i.begintijd, repeat: i.herhaling ?? "none", members: ids, location: i.locatie ?? "", notes: i.notities ?? "", countdown: !!i.aftellen,
        });
        changes.push({ kind: "event_added", event: ev });
        return `Toegevoegd: ${ev.title} op ${ev.date}${ev.startTime ? ` ${ev.startTime}-${ev.endTime}` : " (hele dag)"} voor ${names(ev.members).join(", ") || "het gezin"}. id=${ev.id}`;
      },
    }),
    betaZodTool({
      name: "afspraak_verwijderen",
      description: "Verwijdert een afspraak. Geef 'datum' mee om bij een herhalende afspraak enkel die ene dag te schrappen.",
      inputSchema: z.object({ id: z.string(), datum: date.optional() }),
      run: async ({ id, datum }) => {
        const ev = getEvent(id);
        if (!ev) return "Die afspraak bestaat niet.";
        if (ev.readOnly) return "Deze afspraak komt uit een gekoppelde agenda en kan hier niet verwijderd worden.";
        if (datum && ev.repeat !== "none") skipOccurrence(id, datum);
        else deleteEvent(id);
        changes.push({ kind: "event_removed", title: ev.title });
        return `Verwijderd: ${ev.title}${datum && ev.repeat !== "none" ? ` op ${datum}` : ""}.`;
      },
    }),
    betaZodTool({
      name: "maaltijden_bekijken",
      description: "Geeft het maaltijdplan tussen twee datums.",
      inputSchema: z.object({ van: date, tot: date }),
      run: async ({ van, tot }) => {
        const m = mealsBetween(van, tot);
        return m.length ? m.map((x) => `${x.date} ${x.slot}: ${x.title}`).join("\n") : "Nog niets gepland.";
      },
    }),
    betaZodTool({
      name: "maaltijd_plannen",
      description: "Zet een gerecht in het maaltijdplan (overschrijft wat er al stond voor die dag en dat moment).",
      inputSchema: z.object({ datum: date, moment: z.enum(SLOTS), gerecht: z.string().min(1), recept_id: z.string().optional().describe("id uit de receptenbibliotheek, als het gerecht daar staat") }),
      run: async ({ datum, moment, gerecht, recept_id }) => {
        setMeal(datum, moment, gerecht, recept_id ?? null);
        const h = hid();
        setTimeout(() => fillMissingPhotos(h, (t) => broadcastTo(h, t)).catch(() => {}), 50);
        changes.push({ kind: "meal", date: datum, slot: moment, title: gerecht });
        return `Gepland: ${moment} op ${datum}: ${gerecht}.`;
      },
    }),
    betaZodTool({
      name: "taken_bekijken",
      description: "Geeft de taken (klusjes) van een dag per gezinslid, met id en of ze al gedaan zijn.",
      inputSchema: z.object({ datum: date }),
      run: async ({ datum }) => {
        const done = new Set(doneBetween(datum, datum));
        const members = listMembers();
        const cs = choresOn(datum);
        if (!cs.length) return "Geen taken voor deze dag.";
        return cs.map((c) => `${members.find((m) => m.id === c.memberId)?.name}: ${c.icon} ${c.title} - ${done.has(`${datum}|${c.id}`) ? "gedaan" : "open"} (id=${c.id})`).join("\n");
      },
    }),
    betaZodTool({
      name: "taak_toevoegen",
      description: "Maakt een nieuwe terugkerende taak voor een gezinslid.",
      inputSchema: z.object({
        gezinslid: z.string(), titel: z.string().min(1), icoon: z.string().optional().describe("Eén emoji"),
        dagen: z.array(z.number().int().min(0).max(6)).optional().describe("Weekdagen, 0 = zondag. Weglaten = elke dag"),
        sterren: z.number().int().min(0).max(20).optional(),
        dagdeel: z.enum(["ochtend", "middag", "avond", "altijd"]).optional().describe("Hoort de taak bij de ochtend- of avondroutine?"),
      }),
      run: async (i) => {
        const m = memberByName(i.gezinslid);
        if (!m) return `Onbekend gezinslid. Kies uit: ${listMembers().map((x) => x.name).join(", ")}.`;
        createChore({ memberId: m.id, title: i.titel, icon: i.icoon ?? "✅", days: i.dagen?.length ? i.dagen : [0, 1, 2, 3, 4, 5, 6], points: i.sterren ?? 1, moment: i.dagdeel ?? "altijd" });
        changes.push({ kind: "chore", title: i.titel, member: m.name });
        return `Taak "${i.titel}" toegevoegd voor ${m.name}.`;
      },
    }),
    betaZodTool({
      name: "taak_afvinken",
      description: "Markeert een taak als gedaan (of terug open) op een datum.",
      inputSchema: z.object({ taak_id: z.string(), datum: date, gedaan: z.boolean().default(true) }),
      run: async ({ taak_id, datum, gedaan }) => {
        setChoreDone(taak_id, datum, gedaan);
        return gedaan ? "Afgevinkt." : "Terug open gezet.";
      },
    }),
    betaZodTool({
      name: "lijst_bekijken",
      description: "Toont de lijsten (zoals de boodschappenlijst) en hun items.",
      inputSchema: z.object({ lijst: z.string().optional().describe("Naam van de lijst; weglaten = alle lijsten") }),
      run: async ({ lijst }) => {
        const ls = lijst ? [findList(lijst)].filter(Boolean) : listLists();
        if (!ls.length) return "Die lijst bestaat niet.";
        return ls.map((l) => `${l!.name}: ${l!.items.filter((i) => !i.done).map((i) => i.text).join(", ") || "(leeg)"}`).join("\n");
      },
    }),
    betaZodTool({
      name: "op_lijst_zetten",
      description: "Zet één of meer items op een lijst, bv. ingrediënten op de boodschappenlijst. Maakt de lijst aan als ze nog niet bestaat.",
      inputSchema: z.object({ lijst: z.string().default("Boodschappen"), items: z.array(z.string().min(1)).min(1) }),
      run: async ({ lijst, items }) => {
        const l = findList(lijst);
        const id = l?.id ?? createList(lijst, "🛒");
        for (const it of items) addItem(id, it);
        changes.push({ kind: "list", list: l?.name ?? lijst, items });
        return `${items.length} item(s) op ${l?.name ?? lijst} gezet.`;
      },
    }),
    betaZodTool({
      name: "keuzes_aanbieden",
      description: "Toont tikbare antwoordknoppen onder je vraag, bv. wie iets doet of welke dag. Gebruik dit telkens je de gebruiker laat kiezen uit een paar mogelijkheden; stel de vraag zelf in je antwoordtekst.",
      inputSchema: z.object({ opties: z.array(z.string().min(1).max(60)).min(2).max(6) }),
      run: async ({ opties }) => {
        changes.push({ kind: "options", options: opties });
        return "De knoppen worden getoond. Stel nu kort je vraag.";
      },
    }),
    betaZodTool({
      name: "recepten_bekijken",
      description: "Toont de receptenbibliotheek van het gezin (id, naam, tijd, keuken), optioneel gefilterd op een zoekwoord.",
      inputSchema: z.object({ zoekwoord: z.string().optional() }),
      run: async ({ zoekwoord }) => {
        const q = zoekwoord?.toLocaleLowerCase("tr");
        const list = listRecipes().filter((r) => !q || `${r.title} ${r.ingredients}`.toLocaleLowerCase("tr").includes(q));
        return list.length ? list.slice(0, 40).map((r) => `${r.title}${r.minutes ? ` (${r.minutes} min)` : ""}${r.cuisine ? ` [${r.cuisine}]` : ""} id=${r.id}`).join("\n") : "Geen recepten gevonden in de bibliotheek.";
      },
    }),
    betaZodTool({
      name: "bibliotheek_bladeren",
      description: "Zoekt in de grote gedeelde bibliotheek met duizenden Turkse recepten (per categorie: soep, kip, vlees, vis, groente, peulvruchten, rijst, borek, kebap, salade, aardappel, dessert, ontbijt, drank, saus). Gebruik dit vóór recept_zoeken_online. Geeft bibliotheek-id's terug voor bibliotheek_toevoegen.",
      inputSchema: z.object({ zoekwoord: z.string().optional().describe("Nederlands of Turks, bv. 'kip', 'mercimek'"), categorie: z.string().optional() }),
      run: async ({ zoekwoord, categorie }) => {
        const r = libraryList({ q: zoekwoord, category: categorie, limit: 25 });
        if (!r.total) return `Niets gevonden. Categorieën: ${libraryCategories().map((c) => `${c.key} (${c.n})`).join(", ") || "de bibliotheek is nog leeg"}.`;
        return `${r.total} recepten gevonden. Eerste ${r.items.length}:\n` + r.items.map((i) => `${i.title}${i.title !== i.titleTr ? ` [${i.titleTr}]` : ""} · ${i.category}${i.minutes ? ` · ${i.minutes} min` : ""} bib=${i.id}`).join("\n");
      },
    }),
    betaZodTool({
      name: "bibliotheek_toevoegen",
      description: "Zet een recept uit de gedeelde bibliotheek (bib-id van bibliotheek_bladeren) in de receptenbibliotheek van het gezin, in het Nederlands. Geeft het recept-id terug waarmee je het kunt inplannen.",
      inputSchema: z.object({ bib_id: z.string() }),
      run: async ({ bib_id }) => {
        const added = await addToFamily(bib_id);
        if (!added) return "Dat recept staat niet in de bibliotheek.";
        if (added.existing) return `Stond al in de bibliotheek van het gezin: ${added.title} id=${added.id}`;
        changes.push({ kind: "recipe", id: added.id, title: added.title, image: added.image });
        broadcastTo(hid(), ["recipes"]);
        return `Toegevoegd: ${added.title} id=${added.id}`;
      },
    }),
    betaZodTool({
      name: "recept_zoeken_online",
      description: "Zoekt recepten op Turkse receptwebsites (nefisyemektarifleri, yemek.com, lezzet, ...). Geeft titels en links terug die je met recept_importeren kunt toevoegen.",
      inputSchema: z.object({ zoekopdracht: z.string().min(2) }),
      run: async ({ zoekopdracht }) => {
        try {
          const hits = await searchTurkishRecipes(zoekopdracht);
          return hits.length ? hits.map((h) => `${h.title} [${h.original}] (${h.site}${h.minutes ? `, ${h.minutes} min` : ""}) ${h.url}`).join("\n") : "Niets gevonden.";
        } catch (e) {
          return e instanceof RecipeError ? e.message : "Zoeken lukte niet.";
        }
      },
    }),
    betaZodTool({
      name: "recept_importeren",
      description: "Zet een recept van een receptwebsite in de receptenbibliotheek van het gezin. Geeft het recept-id terug.",
      inputSchema: z.object({ url: z.string().url(), vertalen: z.boolean().default(true).describe("Vertaal naar het Nederlands (standaard aan)") }),
      run: async ({ url, vertalen }) => {
        const existing = recipeBySource(url);
        if (existing) {
          changes.push({ kind: "recipe", id: existing.id, title: existing.title, image: existing.image });
          return `Staat al in de bibliotheek: ${existing.title} id=${existing.id}`;
        }
        try {
          let r = await fetchRecipe(url);
          if (vertalen) r = await translateRecipe(r);
          const id = createRecipe(r);
          changes.push({ kind: "recipe", id, title: r.title, image: r.image ?? null });
          return `Toegevoegd: ${r.title} id=${id}\nIngrediënten:\n${r.ingredients}`;
        } catch (e) {
          return e instanceof RecipeError ? e.message : "Importeren lukte niet.";
        }
      },
    }),
    betaZodTool({
      name: "voorraad_bekijken",
      description: "Toont wat er in de voorraadkast ligt, met vervaldatums. Handig om te weten wat er al in huis is voor je iets op de boodschappenlijst zet.",
      inputSchema: z.object({}),
      run: async () => {
        const pl = pantryList();
        if (!pl || !pl.items.length) return "De voorraad is leeg of nog niet ingevuld.";
        const t = today();
        return pl.items.filter((i) => !i.done).map((i) => `${i.text}${i.qty ? ` (${i.qty})` : ""}${i.expires ? (i.expires < t ? " VERLOPEN" : ` vervalt ${i.expires}`) : ""}`).join("\n");
      },
    }),
    betaZodTool({
      name: "weer_bekijken",
      description: "Geeft het huidige weer en de verwachting voor de komende 7 dagen.",
      inputSchema: z.object({}),
      run: async () => {
        try {
          const w = await getWeather();
          return `${w.city}: nu ${w.current.temp}°C, ${w.current.label}.\n` + w.days.map((d) => `${d.date}: ${d.min}-${d.max}°C, ${d.label}, ${d.rain}% kans op neerslag`).join("\n");
        } catch (e) {
          return `Weer niet beschikbaar: ${e instanceof Error ? e.message : e}`;
        }
      },
    }),
  ];
}

const SYSTEM = `Je bent de gezinsassistent op het keukenscherm van een gezin. Je praat Nederlands (Vlaams is welkom), warm en kort: je antwoorden worden ook voorgelezen, dus schrijf zoals je praat. Gebruik hoogstens een korte opsomming als dat duidelijker is, en geen tabellen of koppen.

Je kunt de gezinskalender, het maaltijdplan, de receptenbibliotheek, de taken en de lijsten bekijken en aanpassen met je tools. Het gezin kookt graag Turks. Voor een nieuw gerecht kijk je eerst in de grote gedeelde bibliotheek (bibliotheek_bladeren, duizenden Turkse recepten per categorie) en pas daarna online (recept_zoeken_online). Vraagt iemand wat er gekookt kan worden met wat in huis is, bekijk dan eerst de voorraad en zoek daar recepten bij. Zet ingrediënten pas op de boodschappenlijst als de gebruiker dat vraagt, en vraag dan eventueel welke ze al hebben.
Laat de gebruiker kiezen met keuzes_aanbieden wanneer je een vraag stelt met een paar duidelijke mogelijkheden.
Opmaak: korte zinnen; een genummerde lijst of **vet** mag als het helpt, verder geen opmaak. Kijk in de agenda voor je een vraag over planning beantwoordt, in plaats van te gokken.
Bij een nieuwe afspraak: als de dag of het uur ontbreekt, vraag het kort na; ontbreekt alleen voor wie, plan het dan voor het hele gezin. Zeg na het toevoegen in één zin wat er gepland is en voor wie.
Bij vragen over koken, spelletjes, uitstapjes of opvoeding geef je praktische, gezinsvriendelijke ideeën die passen bij de leeftijden en de agenda van het gezin.`;

function context(): string {
  const s = getSettings();
  const t = today();
  const members = listMembers().map((m) => `${m.name} (${m.role}${m.diet ? `, vermijdt: ${m.diet}` : ""})`).join(", ");
  return `Vandaag is ${DAYS[weekday(t)]} ${t}. Gezin: ${s.family_name}, woonplaats ${s.city}. Gezinsleden: ${members || "nog niemand ingesteld"}.`;
}

export interface ChatTurn { role: "user" | "assistant"; content: string }

export async function chat(history: ChatTurn[]): Promise<{ reply: string; changes: Change[] }> {
  const client = getClient();
  if (!client) {
    return { reply: "De assistent is nog niet ingesteld. Zet een ANTHROPIC_API_KEY in de serverinstellingen en herstart de server.", changes: [] };
  }
  const changes: Change[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-20).map((t) => ({ role: t.role, content: t.content }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) return { reply: "Waarmee kan ik helpen?", changes };
  // De gezinscontext verandert dagelijks; ze staat na het vaste systeembericht zodat de prefix gecachet blijft.
  messages[0] = { role: "user", content: `${context()}\n\n${messages[0].content as string}` };

  const final = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: buildTools(changes),
    messages,
    max_iterations: 8,
  });

  if (final.stop_reason === "refusal") {
    return { reply: "Daar kan ik je niet mee helpen. Vraag me gerust iets anders over de planning van het gezin.", changes };
  }
  const reply = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
  return { reply: reply || (changes.length ? "Klaar!" : "Ik heb geen antwoord gevonden. Probeer het anders te vragen."), changes };
}
