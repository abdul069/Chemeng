/** Voedingswaarden en calorieschatting voor recepten en het dieetdagboek.
 *  Alles per 100 g: kcal, eiwit, koolhydraten, vet. Namen in het Nederlands en Turks; `unit` is het gewicht van 1 stuk. */

export interface Food { id: string; names: string[]; kcal: number; protein: number; carbs: number; fat: number; unit?: number; cat: string }
export interface Macros { kcal: number; protein: number; carbs: number; fat: number }

const F = (id: string, names: string, kcal: number, protein: number, carbs: number, fat: number, cat: string, unit?: number): Food =>
  ({ id, names: names.split("|").map((s) => s.trim().toLowerCase()), kcal, protein, carbs, fat, cat, unit });

export const FOODS: Food[] = [
  // groenten
  F("ui", "ui|uien|soğan|kuru soğan", 40, 1.1, 9.3, 0.1, "groente", 100),
  F("look", "look|knoflook|teentje look|teentjes look|sarımsak|sarimsak", 149, 6.4, 33, 0.5, "groente", 5),
  F("tomaat", "tomaat|tomaten|tomatenblokjes|gepelde tomaten|domates|domates doğranmış", 18, 0.9, 3.9, 0.2, "groente", 120),
  F("tomatenpuree", "tomatenpuree|salça|domates salçası|biber salçası", 82, 4.3, 18.9, 0.5, "groente", 15),
  F("paprika", "paprika|paprika's|biber|kapya biber|dolmalık biber|sivri biber", 31, 1, 6, 0.3, "groente", 150),
  F("wortel", "wortel|wortelen|worteltjes|havuç|havuc", 41, 0.9, 9.6, 0.2, "groente", 80),
  F("aardappel", "aardappel|aardappelen|aardappels|patates", 77, 2, 17, 0.1, "groente", 150),
  F("courgette", "courgette|courgettes|kabak", 17, 1.2, 3.1, 0.3, "groente", 250),
  F("aubergine", "aubergine|aubergines|patlıcan|patlican", 25, 1, 5.9, 0.2, "groente", 300),
  F("komkommer", "komkommer|salatalık|salatalik", 15, 0.7, 3.6, 0.1, "groente", 300),
  F("sla", "sla|kropsla|ijsbergsla|marul|kıvırcık", 15, 1.4, 2.9, 0.2, "groente", 300),
  F("spinazie", "spinazie|ıspanak|ispanak", 23, 2.9, 3.6, 0.4, "groente", 100),
  F("prei", "prei|pırasa|pirasa", 61, 1.5, 14, 0.3, "groente", 150),
  F("broccoli", "broccoli|brokoli", 34, 2.8, 7, 0.4, "groente", 300),
  F("bloemkool", "bloemkool|karnabahar", 25, 1.9, 5, 0.3, "groente", 600),
  F("kool", "kool|witte kool|rode kool|savooikool|lahana|beyaz lahana|kırmızı lahana", 25, 1.3, 5.8, 0.1, "groente", 900),
  F("champignon", "champignon|champignons|paddenstoelen|mantar", 22, 3.1, 3.3, 0.3, "groente", 20),
  F("boon", "sperziebonen|prinsessenbonen|boontjes|taze fasulye|yeşil fasulye", 31, 1.8, 7, 0.2, "groente", 100),
  F("erwt", "erwten|doperwten|bezelye", 81, 5.4, 14, 0.4, "groente", 100),
  F("mais", "maïs|mais|mısır|misir", 86, 3.3, 19, 1.4, "groente", 100),
  F("peterselie", "peterselie|maydanoz", 36, 3, 6.3, 0.8, "kruiden", 10),
  F("dille", "dille|dereotu|munt|nane|koriander|kişniş|basilicum|fesleğen", 40, 3, 7, 1, "kruiden", 10),
  F("selder", "selder|selderij|bleekselderij|kereviz", 16, 0.7, 3, 0.2, "groente", 60),
  F("pompoen", "pompoen|bal kabağı|kabak tatlısı", 26, 1, 6.5, 0.1, "groente", 1000),
  F("avocado", "avocado|avokado", 160, 2, 8.5, 14.7, "groente", 150),
  F("olijf", "olijven|olijf|zeytin|siyah zeytin|yeşil zeytin", 115, 0.8, 6, 10.7, "groente", 4),
  F("citroen", "citroen|citroensap|limon|limon suyu", 29, 1.1, 9.3, 0.3, "fruit", 60),
  // fruit
  F("appel", "appel|appels|elma", 52, 0.3, 14, 0.2, "fruit", 150),
  F("banaan", "banaan|bananen|muz", 89, 1.1, 23, 0.3, "fruit", 120),
  F("sinaasappel", "sinaasappel|appelsien|portakal|mandarijn|mandalina", 47, 0.9, 12, 0.1, "fruit", 150),
  F("druif", "druiven|üzüm|uzum", 69, 0.7, 18, 0.2, "fruit", 5),
  F("aardbei", "aardbeien|aardbei|çilek|cilek|frambozen|bessen|blauwe bessen|yaban mersini", 32, 0.7, 7.7, 0.3, "fruit", 15),
  F("peer", "peer|peren|armut", 57, 0.4, 15, 0.1, "fruit", 170),
  F("perzik", "perzik|şeftali|abrikoos|kayısı|pruim|erik|kers|kiraz|vijg|incir", 42, 0.9, 10, 0.3, "fruit", 100),
  F("watermeloen", "watermeloen|karpuz|meloen|kavun", 30, 0.6, 7.6, 0.2, "fruit", 300),
  F("granaatappel", "granaatappel|nar", 83, 1.7, 19, 1.2, "fruit", 250),
  F("dadel", "dadels|dadel|hurma", 282, 2.5, 75, 0.4, "fruit", 8),
  F("rozijn", "rozijnen|kuru üzüm|krenten", 299, 3.1, 79, 0.5, "fruit"),
  // granen, brood, pasta, rijst
  F("brood", "brood|snee brood|sneetje brood|boterham|boterhammen|ekmek|dilim ekmek|pide|lavaş|bazlama", 265, 9, 49, 3.2, "graan", 35),
  F("volkorenbrood", "volkorenbrood|bruin brood|tam buğday ekmeği|kepekli ekmek", 247, 13, 41, 3.4, "graan", 35),
  F("pistolet", "pistolet|broodje|sandwich|hamburgerbroodje|simit|poğaça|açma", 300, 9, 52, 6, "graan", 60),
  F("croissant", "croissant|croissants|kruvasan", 406, 8, 46, 21, "graan", 60),
  F("pasta", "pasta|spaghetti|penne|macaroni|tagliatelle|fusilli|lasagnebladen|makarna|erişte|noedels|noodles", 158, 5.8, 31, 0.9, "graan"),
  F("pasta_droog", "spaghetti droog|pasta droog|kuru makarna", 371, 13, 75, 1.5, "graan"),
  F("rijst", "rijst|rijst gekookt|pilav|pirinç pilavı|basmati|bulgur gekookt", 130, 2.7, 28, 0.3, "graan"),
  F("rijst_droog", "rijst droog|pirinç|pirinc|bulgur|kuru bulgur|couscous|kuskus|freekeh", 350, 7.5, 77, 0.8, "graan"),
  F("bloem", "bloem|tarwebloem|un|buğday unu|zelfrijzende bloem|maizena|nişasta|paneermeel|galeta unu", 364, 10, 76, 1, "graan"),
  F("havermout", "havermout|haver|yulaf|yulaf ezmesi|muesli|granola", 379, 13, 67, 7, "graan"),
  F("cornflakes", "cornflakes|ontbijtgranen|mısır gevreği|kahvaltılık gevrek", 378, 7, 84, 1, "graan"),
  F("pizzadeeg", "pizzadeeg|pizzabodem|deeg|yufka|hamur|milföy|bladerdeeg|filodeeg|börek yufkası", 275, 8, 46, 6, "graan", 250),
  F("beschuit", "beschuit|crackers|rijstwafel|kraker|grissini|galeta", 400, 10, 72, 7, "graan", 10),
  F("linzen", "linzen|rode linzen|groene linzen|mercimek|kırmızı mercimek|yeşil mercimek", 116, 9, 20, 0.4, "peulvrucht"),
  F("linzen_droog", "linzen droog|kuru mercimek", 352, 25, 63, 1.1, "peulvrucht"),
  F("kikkererwt", "kikkererwten|nohut|bonen|witte bonen|kidneybonen|bruine bonen|fasulye|kuru fasulye|barbunya", 164, 8.9, 27, 2.6, "peulvrucht"),
  // zuivel, eieren
  F("melk", "melk|volle melk|halfvolle melk|süt|yarım yağlı süt", 61, 3.3, 4.8, 3.3, "zuivel"),
  F("yoghurt", "yoghurt|yoğurt|yogurt|griekse yoghurt|süzme yoğurt|ayran|kefir", 61, 3.5, 4.7, 3.3, "zuivel"),
  F("yoghurt_vol", "volle yoghurt|tam yağlı yoğurt|labneh", 97, 4, 4, 7, "zuivel"),
  F("kaas", "kaas|geraspte kaas|gouda|emmentaler|cheddar|kaşar|kasar|kaşar peyniri|rendelenmiş kaşar", 356, 25, 2, 27, "zuivel"),
  F("feta", "feta|witte kaas|beyaz peynir|peynir|tulum peyniri|lor|ezine", 264, 14, 4, 21, "zuivel"),
  F("mozzarella", "mozzarella|burrata", 280, 18, 3, 22, "zuivel", 125),
  F("roomkaas", "roomkaas|philadelphia|krem peynir|mascarpone", 250, 6, 4, 24, "zuivel"),
  F("room", "room|slagroom|kookroom|krema|sıvı krema|crème fraîche", 290, 2, 3, 30, "zuivel"),
  F("boter", "boter|tereyağı|tereyagi|margarine", 735, 0.6, 0.6, 81, "vet", 10),
  F("ei", "ei|eieren|yumurta", 143, 13, 1.1, 9.5, "ei", 55),
  // vlees, vis
  F("gehakt", "gehakt|rundergehakt|gemengd gehakt|kıyma|kiyma|dana kıyma|köfte", 254, 17, 0, 20, "vlees"),
  F("kip", "kip|kipfilet|kippenborst|tavuk|tavuk göğsü|tavuk göğüs|piliç", 165, 31, 0, 3.6, "vlees", 150),
  F("kipdij", "kipdij|kippendij|kippenbout|tavuk but|tavuk pirzola|kanat|kippenvleugel", 209, 26, 0, 11, "vlees", 120),
  F("rund", "rundvlees|rundsvlees|biefstuk|stoofvlees|dana eti|dana|sığır eti|kuşbaşı|et", 250, 26, 0, 15, "vlees"),
  F("lam", "lamsvlees|lam|kuzu|kuzu eti|kuzu pirzola", 294, 25, 0, 21, "vlees"),
  F("kalkoen", "kalkoen|hindi|hindi eti", 135, 29, 0, 1.5, "vlees"),
  F("worst", "worst|sucuk|sosis|salami|pastırma|pastirma|merguez", 330, 16, 2, 29, "vlees", 40),
  F("ham", "ham|hesp|kalkoenham|jambon|kipfilet beleg", 110, 20, 1, 3, "vlees", 20),
  F("zalm", "zalm|somon|zalmfilet", 208, 20, 0, 13, "vis", 150),
  F("vis", "vis|kabeljauw|witvis|levrek|zeebaars|çipura|dorade|hamsi|ansjovis|sardines|tilapia|pangasius|koolvis|palamut|balık|balik", 105, 22, 0, 2, "vis", 150),
  F("tonijn", "tonijn|ton balığı|tonijn in blik", 130, 29, 0, 1, "vis", 150),
  F("garnaal", "garnalen|garnaal|scampi|karides|calamares|kalamar|mosselen|midye", 99, 24, 0.3, 0.3, "vis"),
  // vetten, sauzen
  F("olie", "olie|olijfolie|zonnebloemolie|zeytinyağı|zeytinyagi|ayçiçek yağı|sıvı yağ|sivi yag|yağ", 884, 0, 0, 100, "vet", 14),
  F("mayonaise", "mayonaise|mayonez", 680, 1, 2, 75, "saus", 15),
  F("ketchup", "ketchup|ketçap|barbecuesaus", 112, 1, 26, 0.2, "saus", 15),
  F("tomatensaus", "tomatensaus|pastasaus|passata|domates sosu", 50, 1.5, 8, 1.5, "saus"),
  F("hummus", "hummus|humus|tahin|tahini|sesampasta", 300, 9, 15, 23, "saus", 20),
  F("pindakaas", "pindakaas|notenpasta|fıstık ezmesi", 590, 25, 15, 50, "noten", 15),
  F("suiker", "suiker|şeker|seker|toz şeker|poedersuiker|pudra şekeri|bruine suiker|esmer şeker", 400, 0, 100, 0, "zoet", 4),
  F("honing", "honing|bal|siroop|pekmez|ahornsiroop|stroop", 304, 0.3, 82, 0, "zoet", 20),
  F("chocolade", "chocolade|chocolate|çikolata|cikolata|cacao|kakao|nutella|chocoladepasta", 546, 5, 60, 31, "zoet", 10),
  F("koek", "koekje|koekjes|kurabiye|bisküvi|biscuit|speculoos|cake|kek|wafel|pannenkoek|krep", 480, 6, 65, 22, "zoet", 25),
  F("baklava", "baklava|künefe|lokum|tulumba|revani|helva|halva|şekerpare|dessert", 430, 6, 55, 21, "zoet", 50),
  F("ijs", "ijs|roomijs|dondurma", 207, 3.5, 24, 11, "zoet", 75),
  F("chips", "chips|cips|zoutjes|popcorn|patlamış mısır", 536, 7, 53, 35, "snack", 30),
  F("frieten", "frieten|friet|patat|frietjes|patates kızartması|kızartma", 312, 3.4, 41, 15, "snack"),
  F("pizza", "pizza|lahmacun", 266, 11, 33, 10, "gerecht", 300),
  F("hamburger", "hamburger|cheeseburger|döner|dürüm|kebab|kebap|shoarma|tavuk döner|iskender", 250, 15, 22, 12, "gerecht", 250),
  F("soep", "soep|çorba|corba|bouillon|groentebouillon|kippenbouillon|et suyu|tavuk suyu", 35, 2, 4, 1.2, "gerecht", 250),
  // noten, zaden
  F("noot", "noten|walnoten|ceviz|hazelnoten|fındık|findik|amandelen|badem|cashewnoten|kaju|pistache|antep fıstığı|pinda's|fıstık|yerfıstığı|pijnboompitten|çam fıstığı", 620, 18, 15, 55, "noten", 5),
  F("zaad", "sesamzaad|susam|zonnebloempitten|ay çekirdeği|lijnzaad|chiazaad|chia tohumu|pompoenpitten", 560, 20, 20, 48, "noten", 10),
  // dranken
  F("water", "water|su|bruiswater|maden suyu|thee|çay|cay|koffie|kahve|türk kahvesi|kruidenthee", 1, 0, 0, 0, "drank", 200),
  F("frisdrank", "cola|frisdrank|limonade|gazoz|fanta|sprite|ice tea|energiedrank", 42, 0, 10.5, 0, "drank", 330),
  F("sap", "fruitsap|sinaasappelsap|appelsap|meyve suyu|portakal suyu|smoothie", 46, 0.5, 10.5, 0.1, "drank", 200),
  F("melkdrank", "chocolademelk|kakaolu süt|salep|sahlep|boza", 85, 3, 12, 2.5, "drank", 250),
  // vlees-/zuivelvervangers
  F("tofu", "tofu|tempeh|vegetarische burger|vegaburger|seitan|falafel", 150, 15, 6, 8, "vervanger", 100),
  F("plantmelk", "havermelk|sojamelk|amandelmelk|yulaf sütü|soya sütü|badem sütü", 42, 1.2, 6, 1.5, "zuivel"),
];

/** Gewichten van maateenheden in gram (ml ≈ g). */
const UNITS: Record<string, number> = {
  g: 1, gr: 1, gram: 1, kg: 1000, kilo: 1000, ml: 1, cl: 10, dl: 100, l: 1000, liter: 1000, litre: 1000,
  el: 15, eetlepel: 15, eetlepels: 15, "yemek kaşığı": 15, "yk": 15, tl: 5, theelepel: 5, theelepels: 5, "çay kaşığı": 5, "tatlı kaşığı": 8, "ck": 5,
  kop: 200, kopje: 200, kopjes: 200, cup: 240, cups: 240, "su bardağı": 200, "çay bardağı": 100, glas: 200, glazen: 200, bardak: 200,
  blik: 400, blikje: 150, blikken: 400, kutu: 400, konserve: 400, pak: 500, pakje: 250, paket: 500, zak: 500, zakje: 100, pot: 400, potje: 150, kavanoz: 400,
  snee: 35, sneetje: 35, sneetjes: 35, snede: 35, dilim: 35, boterham: 35, bol: 60, bolletje: 60, teen: 5, teentje: 5, teentjes: 5, diş: 5, dis: 5,
  handvol: 30, hand: 30, avuç: 30, "avuç içi": 30, snuf: 0.5, snufje: 0.5, tutam: 0.5, mespunt: 0.5, scheut: 10, scheutje: 10, druppel: 0.1, takje: 3, takjes: 3, dal: 3, bosje: 30, demet: 30, bos: 30,
  stuk: 0, stuks: 0, st: 0, adet: 0, tane: 0, grote: 0, kleine: 0, middelgrote: 0, büyük: 0, küçük: 0, orta: 0, "orta boy": 0,
  plak: 20, plakje: 20, plakjes: 20, plakken: 20, schijf: 20, schijfje: 20, blokje: 10, blokjes: 10, kubus: 10, portie: 150, porsiyon: 150, fles: 500, şişe: 500,
};
const UNIT_KEYS = Object.keys(UNITS).sort((a, b) => b.length - a.length);
const FRAC: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
const NUMRE = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+[.,]\d+|\d+|[½¼¾⅓⅔⅛])(?:\s*[-–à]\s*(\d+[.,]\d+|\d+))?/u;

function parseNum(s: string): number {
  s = s.trim();
  if (FRAC[s] !== undefined) return FRAC[s];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/); if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/); if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s.replace(",", "."));
}
const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/[()[\]*:,;.!]/g, " ").replace(/\s+/g, " ").trim();

/** Zoek het best passende voedingsmiddel bij een ingrediëntnaam. Langste naammatch wint. */
export function matchFood(name: string): Food | null {
  const n = ` ${norm(name)} `;
  let best: Food | null = null; let bestLen = 0;
  for (const f of FOODS) for (const alias of f.names) {
    if (alias.length > bestLen && n.includes(` ${alias} `)) { best = f; bestLen = alias.length; }
  }
  if (best) return best;
  // enkelvoud/meervoud en samenstellingen: woordbegin
  const words = n.trim().split(" ").filter((w) => w.length > 3);
  for (const f of FOODS) for (const alias of f.names) for (const w of words) {
    if ((w.startsWith(alias) || alias.startsWith(w)) && Math.min(w.length, alias.length) >= 4 && alias.length > bestLen) { best = f; bestLen = alias.length; }
  }
  return best;
}

export function searchFoods(q: string, limit = 15): (Food & { label: string })[] {
  const n = norm(q);
  if (!n) return [];
  const score = (f: Food) => { let s = 0; for (const a of f.names) { if (a === n) s = Math.max(s, 3); else if (a.startsWith(n)) s = Math.max(s, 2); else if (a.includes(n)) s = Math.max(s, 1); } return s; };
  return FOODS.map((f) => ({ f, s: score(f) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit)
    .map(({ f }) => ({ ...f, label: f.names.find((a) => a.includes(n)) ?? f.names[0] }));
}

export const macrosFor = (f: Food, grams: number): Macros => ({ kcal: f.kcal * grams / 100, protein: f.protein * grams / 100, carbs: f.carbs * grams / 100, fat: f.fat * grams / 100 });
const add = (a: Macros, b: Macros): Macros => ({ kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat });
const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
export const round = (m: Macros): Macros => ({ kcal: Math.round(m.kcal), protein: Math.round(m.protein * 10) / 10, carbs: Math.round(m.carbs * 10) / 10, fat: Math.round(m.fat * 10) / 10 });

export interface LineEstimate { line: string; food: string | null; grams: number | null; kcal: number | null; guessed: boolean }

/** Eén ingrediëntregel → gram en calorieën. `guessed` als er geen hoeveelheid stond. */
export function estimateLine(line: string): LineEstimate {
  const raw = line.replace(/^[-•*]\s*/, "").trim();
  if (!raw) return { line, food: null, grams: null, kcal: null, guessed: false };
  let rest = raw; let qty: number | null = null;
  const m = rest.match(NUMRE);
  if (m) { qty = m[2] ? (parseNum(m[1]) + parseNum(m[2])) / 2 : parseNum(m[1]); rest = rest.slice(m[0].length).trim(); }
  let unitG: number | null = null; let unitWord = "";
  const lower = norm(rest);
  for (const u of UNIT_KEYS) {
    if (lower === u || lower.startsWith(u + " ")) { unitG = UNITS[u]; unitWord = u; rest = rest.slice(u.length).trim(); break; }
  }
  const food = matchFood(rest || raw);
  if (!food) return { line, food: null, grams: null, kcal: null, guessed: false };
  let grams: number; let guessed = false;
  if (qty === null) { grams = food.unit && food.cat !== "vet" && food.cat !== "kruiden" ? food.unit : 50; guessed = true; }
  else if (unitG === null || unitG === 0) grams = qty * (food.unit ?? 100);
  else grams = qty * unitG;
  // "500 g gehakt": per-stuk-eenheid niet gebruiken als er een maat stond (al verwerkt); kruiden zonder maat zijn een snufje
  if (food.cat === "kruiden" && qty === null) grams = 5;
  void unitWord;
  return { line, food: food.id, grams: Math.round(grams), kcal: Math.round(food.kcal * grams / 100), guessed };
}

export interface RecipeEstimate { perServing: Macros; total: Macros; servings: number; matched: number; lines: LineEstimate[]; guessed: number }

/** Schat de voedingswaarde van een heel recept en per portie. */
export function estimateRecipe(ingredients: string, servings: number | string | null | undefined): RecipeEstimate {
  const n = typeof servings === "number" ? servings : Number((servings ?? "").match(/\d+/)?.[0]);
  const s = n >= 1 && n <= 50 ? n : 4;
  const lines = ingredients.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(estimateLine);
  let total = ZERO;
  for (const l of lines) {
    if (!l.food || l.grams === null) continue;
    const f = FOODS.find((x) => x.id === l.food)!;
    total = add(total, macrosFor(f, l.grams));
  }
  const perServing: Macros = { kcal: total.kcal / s, protein: total.protein / s, carbs: total.carbs / s, fat: total.fat / s };
  return { perServing: round(perServing), total: round(total), servings: s, matched: lines.filter((l) => l.food).length, lines, guessed: lines.filter((l) => l.guessed).length };
}

export type Sex = "m" | "v";
export type Goal = "afvallen" | "behouden" | "aankomen";
export interface Profile { sex: Sex; age: number; heightCm: number; weightKg: number; activity: number; goal: Goal }

/** Energiebehoefte (Mifflin-St Jeor × activiteit), met het doel verrekend. Nooit onder 1200 kcal. */
export function energyNeed(p: Profile): { bmr: number; tdee: number; goalKcal: number } {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "m" ? 5 : -161);
  const tdee = bmr * p.activity;
  const delta = p.goal === "afvallen" ? -500 : p.goal === "aankomen" ? 300 : 0;
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), goalKcal: Math.max(1200, Math.round((tdee + delta) / 10) * 10) };
}

/** Macrodoelen in gram bij een caloriedoel: 25% eiwit, 45% koolhydraten, 30% vet. */
export const macroTargets = (kcal: number): Omit<Macros, "kcal"> => ({ protein: Math.round(kcal * 0.25 / 4), carbs: Math.round(kcal * 0.45 / 4), fat: Math.round(kcal * 0.30 / 9) });
