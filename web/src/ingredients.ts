/** Prentjes en allergenen bij ingrediëntregels (Nederlands en Turks), en het splitsen in hoeveelheid en naam. */
import { t } from "./i18n";

const ICONS: [string, string][] = [
  ["🥚", "ei|eieren|yumurta"], ["🥛", "melk|süt|room|krema|kaymak"], ["🧀", "kaas|peynir|kaşar|kasar|mozzarella|feta|parmezaan|lor"], ["🧈", "boter|tereyağ|margarine"], ["🥣", "yoghurt|yoğurt|yogurt|ayran|labneh"],
  ["🍞", "brood|ekmek|pide|lavaş|bazlama|broodje|simit|poğaça"], ["🌾", "bloem|un\\b|tarwe|paneermeel|galeta|irmik|griesmeel|zemelen|kepek"], ["🍝", "pasta|spaghetti|macaroni|penne|makarna|erişte|noedels|noodles|lasagne"], ["🍚", "rijst|pirinç|pirinc|pilav|bulgur|couscous|kuskus"], ["🫘", "linzen|mercimek|bonen|fasulye|kikkererwt|nohut|barbunya"],
  ["🧅", "ui\\b|uien|soğan|sogan"], ["🧄", "look|knoflook|sarımsak|sarimsak"], ["🍅", "tomaat|tomaten|domates|passata"], ["🫙", "tomatenpuree|salça|salca"], ["🫑", "paprika|biber"], ["🥕", "wortel|havuç|havuc"], ["🥔", "aardappel|patates"], ["🥒", "komkommer|salatalık|courgette|kabak|augurk|turşu"],
  ["🍆", "aubergine|patlıcan|patlican"], ["🥬", "sla|marul|spinazie|ıspanak|ispanak|kool|lahana|prei|pırasa|andijvie|snijbiet|pazı"], ["🥦", "broccoli|brokoli|bloemkool|karnabahar"], ["🍄", "champignon|paddenstoel|mantar"], ["🌽", "maïs|mais|mısır|misir"], ["🫛", "erwt|bezelye|sperzieboon|taze fasulye"],
  ["🌿", "peterselie|maydanoz|dille|dereotu|munt|nane|basilicum|fesleğen|koriander|kişniş|tijm|kekik|rozemarijn|laurier|defne|bieslook"], ["🍋", "citroen|limon"], ["🍎", "appel|elma"], ["🍌", "banaan|muz"], ["🍊", "sinaasappel|appelsien|portakal|mandarijn|mandalina"], ["🍇", "druif|üzüm|uzum|rozijn"], ["🍓", "aardbei|çilek|cilek|framboos|bessen|yaban mersini"], ["🍐", "peer|armut|perzik|şeftali|abrikoos|kayısı|pruim|erik"], ["🍉", "watermeloen|karpuz|meloen|kavun"], ["🥑", "avocado|avokado"], ["🫒", "olijf|zeytin"], ["🌰", "dadel|hurma|kastanje|kestane"],
  ["🥩", "gehakt|kıyma|kiyma|rund|dana|biefstuk|kuşbaşı|et\\b|lam|kuzu|köfte|kofte"], ["🍗", "kip|tavuk|piliç|kalkoen|hindi"], ["🥓", "worst|sucuk|sosis|salami|pastırma|pastirma|ham|hesp|jambon"], ["🐟", "vis|balık|balik|zalm|somon|tonijn|kabeljauw|levrek|çipura|hamsi|sardine"], ["🦐", "garnaal|scampi|karides|mossel|midye|calamares|kalamar"],
  ["🫒", "olie|olijfolie|zeytinyağı|zeytinyagi|ayçiçek|sıvı yağ|sivi yag|yağ\\b"], ["🧂", "zout|tuz|peper|biber\\b|karabiber|pul biber|kruiden|baharat|komijn|kimyon|kaneel|tarçın|paprikapoeder|kurkuma|zerdeçal|sumak|nootmuskaat|vanille|vanilya|bakpoeder|kabartma|gist|maya|soda"], ["🍯", "honing|bal\\b|siroop|pekmez|stroop"], ["🍬", "suiker|şeker|seker|poedersuiker"], ["🍫", "chocolade|çikolata|cikolata|cacao|kakao"],
  ["🥫", "blik|konserve|kutu"], ["🧃", "sap|meyve suyu|bouillon|et suyu|tavuk suyu|water|su\\b"], ["🥜", "noten|pinda|fıstık|fistik|hazelnoot|fındık|findik|walnoot|ceviz|amandel|badem|cashew|kaju|pistache|antep"], ["🫓", "yufka|deeg|hamur|bladerdeeg|milföy|filodeeg|pizzadeeg|tortilla|wrap"], ["🌶️", "chili|pul biber|acı|peper"], ["🥗", "salade|salata"], ["🍯", "tahin|tahini|sesam|susam"], ["🧊", "ijs|buz|dondurma"], ["☕", "koffie|kahve|thee|çay|cay"],
];
const ICON_RE = ICONS.map(([ic, re]) => [ic, new RegExp(`(^|[^\\p{L}])(${re})`, "iu")] as const);

/** Een passend prentje bij een ingrediëntregel; 🥄 als er niets herkend wordt. */
export function ingredientIcon(line: string): string {
  const l = line.toLocaleLowerCase("tr");
  for (const [ic, re] of ICON_RE) if (re.test(l)) return ic;
  return "🥄";
}

const AMOUNT = /^((?:\d+\s+\d+\/\d+|\d+\/\d+|\d+[.,]\d+|\d+|[½¼¾⅓⅔⅛])(?:\s*[-–à]\s*(?:\d+[.,]\d+|\d+))?\s*(?:g|gr|gram|kg|ml|cl|dl|l|liter|el|tl|eetlepels?|theelepels?|kop(?:je)?s?|cups?|su bardağı|çay bardağı|yemek kaşığı|tatlı kaşığı|çay kaşığı|yk|ck|blik(?:je)?|pak(?:je)?|paket|zak(?:je)?|snee(?:tje)?s?|dilim|teen(?:tje)?s?|diş|dis|stuks?|st|adet|tane|bos(?:je)?|demet|takje|dal|snuf(?:je)?|tutam|plak(?:je)?s?|handvol|avuç|glas|bardak|scheut(?:je)?|portie)?\.?)\s+(.+)$/iu;

/** "500 g gehakt" → { amount: "500 g", name: "gehakt" }; regels zonder getal houden alleen een naam. */
export function splitIngredient(line: string): { amount: string; name: string } {
  const clean = line.replace(/^[-•*]\s*/, "").trim();
  const m = clean.match(AMOUNT);
  if (m && m[2].trim()) return { amount: m[1].trim(), name: m[2].trim() };
  return { amount: "", name: clean };
}

const ALLERGENS: { key: string; nl: string; tr: string; icon: string; re: RegExp }[] = [
  { key: "dairy", nl: "Zuivel", tr: "Süt ürünleri", icon: "🥛", re: /\b(melk|kaas|boter|yoghurt|room|slagroom|kwark|mozzarella|feta|parmezaan|süt|peynir|kaşar|kasar|tereyağ|yoğurt|yogurt|krema|kaymak|labneh|ayran)/iu },
  { key: "gluten", nl: "Gluten", tr: "Gluten", icon: "🌾", re: /\b(bloem|tarwe|brood|pasta|spaghetti|macaroni|couscous|bulgur|paneermeel|griesmeel|gerst|rogge|un\b|ekmek|makarna|erişte|yufka|irmik|galeta|kuskus|pide|lavaş|bazlama|hamur|milföy|bladerdeeg|koek|biscuit|bisküvi)/iu },
  { key: "egg", nl: "Ei", tr: "Yumurta", icon: "🥚", re: /\b(ei|eieren|yumurta|mayonaise|mayonez)\b/iu },
  { key: "nuts", nl: "Noten", tr: "Kuruyemiş", icon: "🌰", re: /\b(noten|amandel|hazelnoot|walnoot|cashew|pistache|fındık|findik|ceviz|badem|kaju|antep fıstığı|pecannoot|paranoot|macadamia)/iu },
  { key: "peanut", nl: "Pinda", tr: "Yer fıstığı", icon: "🥜", re: /\b(pinda|yer fıstığı|yerfıstığı|pindakaas|fıstık ezmesi)/iu },
  { key: "fish", nl: "Vis", tr: "Balık", icon: "🐟", re: /\b(vis|zalm|tonijn|kabeljauw|ansjovis|sardine|forel|balık|balik|somon|hamsi|levrek|çipura|ton balığı|alabalık)/iu },
  { key: "shellfish", nl: "Schaaldieren", tr: "Kabuklu deniz ürünleri", icon: "🦐", re: /\b(garnaal|garnalen|scampi|kreeft|krab|mossel|mosselen|karides|midye|kalamar|calamares|yengeç|ıstakoz)/iu },
  { key: "soy", nl: "Soja", tr: "Soya", icon: "🫘", re: /\b(soja|sojasaus|tofu|tempeh|edamame|soya)/iu },
  { key: "sesame", nl: "Sesam", tr: "Susam", icon: "🫓", re: /\b(sesam|sesamzaad|tahin|tahini|susam|simit)/iu },
  { key: "celery", nl: "Selderij", tr: "Kereviz", icon: "🥬", re: /\b(selder|selderij|bleekselderij|kereviz)/iu },
  { key: "mustard", nl: "Mosterd", tr: "Hardal", icon: "🟡", re: /\b(mosterd|hardal)/iu },
];
/** Allergenen die in de ingrediënten voorkomen, in de actieve taal. */
export function allergensOf(ingredients: string): { key: string; label: string; icon: string }[] {
  const text = ingredients.toLocaleLowerCase("tr");
  const tr = t("Zuivel") !== "Zuivel";
  return ALLERGENS.filter((a) => a.re.test(text)).map((a) => ({ key: a.key, label: tr ? a.tr : a.nl, icon: a.icon }));
}
