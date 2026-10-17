import { getLang } from "./i18n";
/** Categorieën van recepten (zelfde sleutels als de gedeelde bibliotheek op de server). */
export const CATS: Record<string, { name: string; icon: string }> = {
  soep: { name: "Soepen", icon: "🍲" }, ontbijt: { name: "Ontbijt", icon: "🍳" }, borek: { name: "Börek & deeg", icon: "🥐" }, kebap: { name: "Kebab & grill", icon: "🍢" },
  vlees: { name: "Vleesgerechten", icon: "🥩" }, kip: { name: "Kip", icon: "🍗" }, vis: { name: "Vis & zeevruchten", icon: "🐟" }, groente: { name: "Groenten & olijfolie", icon: "🥦" },
  peulvruchten: { name: "Peulvruchten", icon: "🫘" }, rijst: { name: "Rijst, bulgur & pasta", icon: "🍚" }, salade: { name: "Salades & meze", icon: "🥗" }, aardappel: { name: "Aardappelgerechten", icon: "🥔" },
  dessert: { name: "Desserts & gebak", icon: "🍰" }, drank: { name: "Dranken", icon: "🥤" }, saus: { name: "Sauzen & basis", icon: "🫙" }, overig: { name: "Overige", icon: "🍽️" },
};
const TR_CATS: Record<string, string> = { soep: "Çorbalar", ontbijt: "Kahvaltılık", borek: "Börek ve hamur işi", kebap: "Kebap ve ızgara", vlees: "Et yemekleri", kip: "Tavuk", vis: "Balık ve deniz ürünleri", groente: "Sebze ve zeytinyağlılar", peulvruchten: "Baklagiller", rijst: "Pilav, bulgur ve makarna", salade: "Salata ve meze", aardappel: "Patates yemekleri", dessert: "Tatlı ve pasta", drank: "İçecekler", saus: "Sos ve temel tarifler", overig: "Diğer" };
export const catName = (key: string) => (getLang() === "tr" ? TR_CATS[key] ?? CATS[key]?.name ?? key : CATS[key]?.name ?? key);
export const catLabel = (key: string) => (CATS[key] ? `${CATS[key].icon} ${catName(key)}` : key);
