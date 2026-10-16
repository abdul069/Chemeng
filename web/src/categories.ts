/** Categorieën van recepten (zelfde sleutels als de gedeelde bibliotheek op de server). */
export const CATS: Record<string, { name: string; icon: string }> = {
  soep: { name: "Soepen", icon: "🍲" }, ontbijt: { name: "Ontbijt", icon: "🍳" }, borek: { name: "Börek & deeg", icon: "🥐" }, kebap: { name: "Kebab & grill", icon: "🍢" },
  vlees: { name: "Vleesgerechten", icon: "🥩" }, kip: { name: "Kip", icon: "🍗" }, vis: { name: "Vis & zeevruchten", icon: "🐟" }, groente: { name: "Groenten & olijfolie", icon: "🥦" },
  peulvruchten: { name: "Peulvruchten", icon: "🫘" }, rijst: { name: "Rijst, bulgur & pasta", icon: "🍚" }, salade: { name: "Salades & meze", icon: "🥗" }, aardappel: { name: "Aardappelgerechten", icon: "🥔" },
  dessert: { name: "Desserts & gebak", icon: "🍰" }, drank: { name: "Dranken", icon: "🥤" }, saus: { name: "Sauzen & basis", icon: "🫙" }, overig: { name: "Overige", icon: "🍽️" },
};
export const catLabel = (key: string) => (CATS[key] ? `${CATS[key].icon} ${CATS[key].name}` : key);
