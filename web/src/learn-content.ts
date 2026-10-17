/** Spelend islam leren: alle inhoud in het Nederlands én Turks. */
export type Bi = { nl: string; tr: string };
export interface Quiz { q: Bi; options: Bi[]; answer: number; why?: Bi; topic: string; icon?: string; optionIcons?: string[] }
export interface Pair { ar: string; latin: string; meaning: Bi; icon: string }
export interface Order { title: Bi; icon: string; photo: string; steps: Bi[]; icons: string[] }

export const TOPICS: Record<string, Bi & { icon: string; photo: string }> = {
  zuilen: { photo: "Kaaba", nl: "De vijf zuilen", tr: "İslam'ın beş şartı", icon: "🕌" },
  profeten: { photo: "Al-Masjid an-Nabawi", nl: "Profeten", tr: "Peygamberler", icon: "📜" },
  gebed: { photo: "Sultan Ahmed Mosque", nl: "Het gebed", tr: "Namaz", icon: "🤲" },
  ramadan: { photo: "Iftar", nl: "Ramadan & feest", tr: "Ramazan ve bayram", icon: "🌙" },
  adab: { photo: "Turkish tea", nl: "Goede manieren", tr: "Güzel ahlak", icon: "💛" },
  koran: { photo: "Quran", nl: "De Koran", tr: "Kur'an", icon: "📖" },
};

export const QUIZ: Quiz[] = [
  { topic: "zuilen", icon: "🏛️", optionIcons: ["3️⃣", "5️⃣", "7️⃣"], q: { nl: "Hoeveel zuilen heeft de islam?", tr: "İslam'ın kaç şartı vardır?" }, options: [{ nl: "Drie", tr: "Üç" }, { nl: "Vijf", tr: "Beş" }, { nl: "Zeven", tr: "Yedi" }], answer: 1 },
  { topic: "zuilen", icon: "☝️", optionIcons: ["🍽️", "🗣️", "🕋"], q: { nl: "Wat is de eerste zuil?", tr: "İlk şart nedir?" }, options: [{ nl: "Vasten", tr: "Oruç" }, { nl: "De geloofsgetuigenis (shahada)", tr: "Kelime-i şehadet" }, { nl: "Bedevaart", tr: "Hac" }], answer: 1 },
  { topic: "zuilen", icon: "🤲", optionIcons: ["💰", "🕋", "🧎"], q: { nl: "Hoe noemen we het geven aan de armen?", tr: "Fakirlere vermenin adı nedir?" }, options: [{ nl: "Zakat", tr: "Zekât" }, { nl: "Hadj", tr: "Hac" }, { nl: "Salat", tr: "Namaz" }], answer: 0 },
  { topic: "zuilen", icon: "🕋", optionIcons: ["🌉", "🕋", "🏜️"], q: { nl: "Naar welke stad gaan moslims op bedevaart (hadj)?", tr: "Müslümanlar hacca hangi şehre gider?" }, options: [{ nl: "Istanbul", tr: "İstanbul" }, { nl: "Mekka", tr: "Mekke" }, { nl: "Caïro", tr: "Kahire" }], answer: 1 },
  { topic: "zuilen", icon: "🌙", optionIcons: ["🌙", "📅", "🎉"], q: { nl: "In welke maand vasten moslims?", tr: "Müslümanlar hangi ayda oruç tutar?" }, options: [{ nl: "Ramadan", tr: "Ramazan" }, { nl: "Muharram", tr: "Muharrem" }, { nl: "Shawwal", tr: "Şevval" }], answer: 0 },
  { topic: "gebed", icon: "🧎", optionIcons: ["3️⃣", "5️⃣", "🔟"], q: { nl: "Hoeveel keer per dag bidden moslims?", tr: "Müslümanlar günde kaç kez namaz kılar?" }, options: [{ nl: "Drie", tr: "Üç" }, { nl: "Vijf", tr: "Beş" }, { nl: "Tien", tr: "On" }], answer: 1 },
  { topic: "gebed", icon: "💧", optionIcons: ["💧", "💰", "🍲"], q: { nl: "Hoe heet het wassen vóór het gebed?", tr: "Namazdan önce yıkanmaya ne denir?" }, options: [{ nl: "Wudu (abdest)", tr: "Abdest" }, { nl: "Zakat", tr: "Zekât" }, { nl: "Iftar", tr: "İftar" }], answer: 0 },
  { topic: "gebed", icon: "🌄", optionIcons: ["🌙", "🌄", "🌤️"], q: { nl: "Welk gebed bid je vóór zonsopgang?", tr: "Güneş doğmadan önce hangi namaz kılınır?" }, options: [{ nl: "Isha", tr: "Yatsı" }, { nl: "Fajr (sabah)", tr: "Sabah" }, { nl: "Asr", tr: "İkindi" }], answer: 1 },
  { topic: "gebed", icon: "🧭", optionIcons: ["🕋", "🧭", "☀️"], q: { nl: "Welke richting kijken we tijdens het gebed?", tr: "Namazda hangi yöne döneriz?" }, options: [{ nl: "Naar de Kaaba in Mekka (qibla)", tr: "Mekke'deki Kâbe'ye (kıble)" }, { nl: "Naar het noorden", tr: "Kuzeye" }, { nl: "Naar de zon", tr: "Güneşe" }], answer: 0 },
  { topic: "gebed", icon: "🙌", optionIcons: ["🙌", "👋", "😍"], q: { nl: "Wat zeg je aan het begin van het gebed?", tr: "Namaza başlarken ne denir?" }, options: [{ nl: "Allahu akbar", tr: "Allahu ekber" }, { nl: "Selamun aleykum", tr: "Selamün aleyküm" }, { nl: "Maşallah", tr: "Maşallah" }], answer: 0 },
  { topic: "gebed", icon: "🕌", optionIcons: ["🕌", "🌙", "🌄"], q: { nl: "Welk gebed is op vrijdagmiddag speciaal?", tr: "Cuma günü öğlen hangi namaz özeldir?" }, options: [{ nl: "Het vrijdaggebed (cuma)", tr: "Cuma namazı" }, { nl: "Het nachtgebed", tr: "Yatsı namazı" }, { nl: "Het ochtendgebed", tr: "Sabah namazı" }], answer: 0 },
  { topic: "profeten", icon: "📜", optionIcons: ["🪄", "🕊️", "🌹"], q: { nl: "Wie is de laatste profeet?", tr: "Son peygamber kimdir?" }, options: [{ nl: "Musa (Mozes)", tr: "Hz. Musa" }, { nl: "Isa (Jezus)", tr: "Hz. İsa" }, { nl: "Muhammed ﷺ", tr: "Hz. Muhammed ﷺ" }], answer: 2 },
  { topic: "profeten", icon: "🏙️", optionIcons: ["🕌", "🕋", "🏰"], q: { nl: "In welke stad werd de profeet Muhammed ﷺ geboren?", tr: "Hz. Muhammed ﷺ hangi şehirde doğdu?" }, options: [{ nl: "Medina", tr: "Medine" }, { nl: "Mekka", tr: "Mekke" }, { nl: "Jeruzalem", tr: "Kudüs" }], answer: 1 },
  { topic: "profeten", icon: "🚢", optionIcons: ["🚢", "👕", "🎵"], q: { nl: "Welke profeet bouwde een grote boot (ark)?", tr: "Hangi peygamber büyük bir gemi yaptı?" }, options: [{ nl: "Nuh (Noach)", tr: "Hz. Nuh" }, { nl: "Yusuf", tr: "Hz. Yusuf" }, { nl: "Davud", tr: "Hz. Davud" }], answer: 0 },
  { topic: "profeten", icon: "🧱", optionIcons: ["🧱", "🌳", "🐜"], q: { nl: "Welke profeet bouwde samen met zijn zoon de Kaaba?", tr: "Hangi peygamber oğluyla Kâbe'yi inşa etti?" }, options: [{ nl: "Ibrahim (Abraham)", tr: "Hz. İbrahim" }, { nl: "Adem", tr: "Hz. Âdem" }, { nl: "Sulayman", tr: "Hz. Süleyman" }], answer: 0 },
  { topic: "profeten", icon: "🐋", optionIcons: ["🐋", "🪄", "🗣️"], q: { nl: "Welke profeet werd door een grote vis opgeslokt?", tr: "Hangi peygamberi büyük bir balık yuttu?" }, options: [{ nl: "Yunus (Jona)", tr: "Hz. Yunus" }, { nl: "Musa", tr: "Hz. Musa" }, { nl: "Harun", tr: "Hz. Harun" }], answer: 0 },
  { topic: "profeten", icon: "🌳", optionIcons: ["🌳", "🚢", "🧱"], q: { nl: "Wie was de eerste mens en profeet?", tr: "İlk insan ve peygamber kimdir?" }, options: [{ nl: "Adem", tr: "Hz. Âdem" }, { nl: "Nuh", tr: "Hz. Nuh" }, { nl: "Ibrahim", tr: "Hz. İbrahim" }], answer: 0 },
  { topic: "profeten", icon: "🐦", optionIcons: ["🐦", "👕", "📿"], q: { nl: "Welke profeet kon met dieren praten?", tr: "Hangi peygamber hayvanlarla konuşabiliyordu?" }, options: [{ nl: "Sulayman (Salomo)", tr: "Hz. Süleyman" }, { nl: "Yusuf", tr: "Hz. Yusuf" }, { nl: "Zekeriyya", tr: "Hz. Zekeriya" }], answer: 0 },
  { topic: "ramadan", icon: "🍽️", optionIcons: ["🌙", "🍽️", "🎉"], q: { nl: "Hoe heet de maaltijd waarmee we het vasten breken?", tr: "Orucu açtığımız yemeğe ne denir?" }, options: [{ nl: "Sahur", tr: "Sahur" }, { nl: "Iftar", tr: "İftar" }, { nl: "Bayram", tr: "Bayram" }], answer: 1 },
  { topic: "ramadan", icon: "🌄", optionIcons: ["🌄", "🍽️", "🕌"], q: { nl: "Hoe heet de maaltijd vóór zonsopgang in de ramadan?", tr: "Ramazanda güneş doğmadan önceki yemeğe ne denir?" }, options: [{ nl: "Sahur", tr: "Sahur" }, { nl: "Iftar", tr: "İftar" }, { nl: "Teravih", tr: "Teravih" }], answer: 0 },
  { topic: "ramadan", icon: "🎉", optionIcons: ["🐑", "🍬", "🎆"], q: { nl: "Welk feest komt na de ramadan?", tr: "Ramazandan sonra hangi bayram gelir?" }, options: [{ nl: "Offerfeest", tr: "Kurban Bayramı" }, { nl: "Suikerfeest (Ramazan Bayramı)", tr: "Ramazan Bayramı" }, { nl: "Nieuwjaar", tr: "Yılbaşı" }], answer: 1 },
  { topic: "ramadan", icon: "🐑", optionIcons: ["🥩", "🎄", "🎆"], q: { nl: "Wat doen we tijdens het Offerfeest?", tr: "Kurban Bayramı'nda ne yaparız?" }, options: [{ nl: "Vlees delen met armen en familie", tr: "Eti fakirlerle ve aileyle paylaşırız" }, { nl: "Een boom versieren", tr: "Ağaç süsleriz" }, { nl: "Vuurwerk afsteken", tr: "Havai fişek atarız" }], answer: 0 },
  { topic: "ramadan", icon: "🌌", optionIcons: ["🌌", "🎆", "🕌"], q: { nl: "Welke speciale nacht is beter dan duizend maanden?", tr: "Hangi özel gece bin aydan hayırlıdır?" }, options: [{ nl: "Laylat al-Qadr (Kadir Gecesi)", tr: "Kadir Gecesi" }, { nl: "Oudejaarsnacht", tr: "Yılbaşı gecesi" }, { nl: "Vrijdagnacht", tr: "Cuma gecesi" }], answer: 0 },
  { topic: "adab", icon: "🍽️", optionIcons: ["🍽️", "🙏", "🌅"], q: { nl: "Wat zeg je vóór je begint te eten?", tr: "Yemeğe başlamadan önce ne denir?" }, options: [{ nl: "Bismillah", tr: "Bismillah" }, { nl: "Elhamdülillah", tr: "Elhamdülillah" }, { nl: "İnşallah", tr: "İnşallah" }], answer: 0 },
  { topic: "adab", icon: "😋", optionIcons: ["🍽️", "🙏", "🙌"], q: { nl: "Wat zeg je als je klaar bent met eten?", tr: "Yemek bitince ne denir?" }, options: [{ nl: "Bismillah", tr: "Bismillah" }, { nl: "Elhamdülillah", tr: "Elhamdülillah" }, { nl: "Allahu akbar", tr: "Allahu ekber" }], answer: 1 },
  { topic: "adab", icon: "👋", optionIcons: ["👋", "😍", "🌈"], q: { nl: "Hoe begroet je een andere moslim?", tr: "Başka bir Müslümanı nasıl selamlarsın?" }, options: [{ nl: "Selamun aleykum", tr: "Selamün aleyküm" }, { nl: "Maşallah", tr: "Maşallah" }, { nl: "Sübhanallah", tr: "Sübhanallah" }], answer: 0 },
  { topic: "adab", icon: "🤝", optionIcons: ["🤝", "🍽️", "🙈"], q: { nl: "Wat antwoord je op 'Selamun aleykum'?", tr: "'Selamün aleyküm'e ne cevap verilir?" }, options: [{ nl: "Aleykum selam", tr: "Aleyküm selam" }, { nl: "Bismillah", tr: "Bismillah" }, { nl: "Estağfirullah", tr: "Estağfirullah" }], answer: 0 },
  { topic: "adab", icon: "✋", optionIcons: ["👉", "👈", "🤷"], q: { nl: "Met welke hand eten we het liefst?", tr: "En çok hangi elle yemek yeriz?" }, options: [{ nl: "Rechts", tr: "Sağ" }, { nl: "Links", tr: "Sol" }, { nl: "Maakt niet uit", tr: "Fark etmez" }], answer: 0 },
  { topic: "adab", icon: "😍", optionIcons: ["😍", "🙈", "🤝"], q: { nl: "Wat zeg je als iets moois gebeurt of je iets moois ziet?", tr: "Güzel bir şey olunca ya da görünce ne denir?" }, options: [{ nl: "Maşallah", tr: "Maşallah" }, { nl: "Estağfirullah", tr: "Estağfirullah" }, { nl: "Aleykum selam", tr: "Aleyküm selam" }], answer: 0 },
  { topic: "adab", icon: "📅", optionIcons: ["🌅", "🙏", "🌈"], q: { nl: "Wat zeg je als je een plan hebt voor morgen?", tr: "Yarın için bir planın olunca ne dersin?" }, options: [{ nl: "İnşallah", tr: "İnşallah" }, { nl: "Elhamdülillah", tr: "Elhamdülillah" }, { nl: "Sübhanallah", tr: "Sübhanallah" }], answer: 0 },
  { topic: "koran", icon: "📖", optionIcons: ["🇹🇷", "🇸🇦", "🇳🇱"], q: { nl: "In welke taal is de Koran geopenbaard?", tr: "Kur'an hangi dilde indirildi?" }, options: [{ nl: "Turks", tr: "Türkçe" }, { nl: "Arabisch", tr: "Arapça" }, { nl: "Nederlands", tr: "Hollandaca" }], answer: 1 },
  { topic: "koran", icon: "🔢", optionIcons: ["9️⃣", "💯", "2️⃣"], q: { nl: "Hoeveel soera's heeft de Koran?", tr: "Kur'an'da kaç sure vardır?" }, options: [{ nl: "99", tr: "99" }, { nl: "114", tr: "114" }, { nl: "200", tr: "200" }], answer: 1 },
  { topic: "koran", icon: "1️⃣", optionIcons: ["📖", "☝️", "👥"], q: { nl: "Hoe heet de eerste soera van de Koran?", tr: "Kur'an'ın ilk suresi hangisidir?" }, options: [{ nl: "Al-Fatiha", tr: "Fâtiha" }, { nl: "Al-Ikhlas", tr: "İhlâs" }, { nl: "An-Nas", tr: "Nâs" }], answer: 0 },
  { topic: "koran", icon: "👼", optionIcons: ["🌧️", "👼", "🎺"], q: { nl: "Welke engel bracht de Koran naar de profeet?", tr: "Kur'an'ı peygambere hangi melek getirdi?" }, options: [{ nl: "Mikail", tr: "Mikâil" }, { nl: "Cebrail (Gabriël)", tr: "Cebrail" }, { nl: "İsrafil", tr: "İsrafil" }], answer: 1 },
  { topic: "koran", icon: "📑", optionIcons: ["📖", "🗣️", "🤲"], q: { nl: "Hoe heet een kort hoofdstuk van de Koran?", tr: "Kur'an'ın bir bölümüne ne denir?" }, options: [{ nl: "Soera", tr: "Sure" }, { nl: "Hadith", tr: "Hadis" }, { nl: "Dua", tr: "Dua" }], answer: 0 },
  { topic: "koran", icon: "🧎", optionIcons: ["📖", "🌊", "🌅"], q: { nl: "Welke soera lees je in elk gebed?", tr: "Her namazda hangi sure okunur?" }, options: [{ nl: "Al-Fatiha", tr: "Fâtiha" }, { nl: "Al-Kevser", tr: "Kevser" }, { nl: "Al-Falaq", tr: "Felak" }], answer: 0 },
];

export const PAIRS: Pair[] = [
  { ar: "بِسْمِ اللّٰهِ", latin: "Bismillah", icon: "🍽️", meaning: { nl: "In de naam van Allah", tr: "Allah'ın adıyla" } },
  { ar: "اَلْحَمْدُ لِلّٰهِ", latin: "Elhamdülillah", icon: "🙏", meaning: { nl: "Alle lof is voor Allah", tr: "Hamd Allah'a mahsustur" } },
  { ar: "سُبْحَانَ اللّٰهِ", latin: "Sübhanallah", icon: "🌈", meaning: { nl: "Allah is volmaakt", tr: "Allah noksanlıklardan uzaktır" } },
  { ar: "اَللّٰهُ أَكْبَرُ", latin: "Allahu ekber", icon: "🕌", meaning: { nl: "Allah is de Grootste", tr: "Allah en büyüktür" } },
  { ar: "إِنْ شَاءَ اللّٰهُ", latin: "İnşallah", icon: "🌅", meaning: { nl: "Als Allah het wil", tr: "Allah dilerse" } },
  { ar: "مَا شَاءَ اللّٰهُ", latin: "Maşallah", icon: "😍", meaning: { nl: "Wat Allah wil (hoe mooi!)", tr: "Allah dilemiş (ne güzel!)" } },
  { ar: "أَسْتَغْفِرُ اللّٰهَ", latin: "Estağfirullah", icon: "🙈", meaning: { nl: "Ik vraag Allah om vergeving", tr: "Allah'tan bağışlanma dilerim" } },
  { ar: "اَلسَّلَامُ عَلَيْكُمْ", latin: "Selamün aleyküm", icon: "👋", meaning: { nl: "Vrede zij met jullie", tr: "Selam üzerinize olsun" } },
  { ar: "جَزَاكَ اللّٰهُ خَيْرًا", latin: "Cezakallahu hayran", icon: "🎁", meaning: { nl: "Moge Allah je belonen", tr: "Allah seni hayırla ödüllendirsin" } },
  { ar: "لَا إِلٰهَ إِلَّا اللّٰهُ", latin: "La ilahe illallah", icon: "☝️", meaning: { nl: "Er is geen god dan Allah", tr: "Allah'tan başka ilah yoktur" } },
  { ar: "بَارَكَ اللّٰهُ فِيكَ", latin: "Barekallahu fik", icon: "🌟", meaning: { nl: "Moge Allah je zegenen", tr: "Allah seni mübarek kılsın" } },
  { ar: "تَبَارَكَ اللّٰهُ", latin: "Tebarekallah", icon: "✨", meaning: { nl: "Gezegend is Allah", tr: "Allah ne yücedir" } },
];

export const ORDERS: Order[] = [
  { icon: "🧼", icons: ["🤲", "👄", "👃", "😊", "💪", "🧠", "🦶"], photo: "Ablution in Islam", title: { nl: "De stappen van de wudu (abdest)", tr: "Abdestin adımları" }, steps: [
    { nl: "Bismillah zeggen en handen wassen", tr: "Bismillah deyip elleri yıkamak" }, { nl: "Mond spoelen", tr: "Ağzı çalkalamak" }, { nl: "Neus spoelen", tr: "Burna su vermek" },
    { nl: "Gezicht wassen", tr: "Yüzü yıkamak" }, { nl: "Armen tot de ellebogen wassen", tr: "Kolları dirseklere kadar yıkamak" }, { nl: "Hoofd (en oren) met natte handen strijken", tr: "Başı ve kulakları mesh etmek" }, { nl: "Voeten tot de enkels wassen", tr: "Ayakları topuklara kadar yıkamak" } ] },
  { icon: "🕌", icons: ["🌄", "☀️", "🌤️", "🌇", "🌙"], photo: "Adhan", title: { nl: "De vijf gebeden van de dag, in volgorde", tr: "Günün beş namazı, sırayla" }, steps: [
    { nl: "Fajr (sabah) – ochtend", tr: "Sabah namazı" }, { nl: "Dhuhr (öğle) – middag", tr: "Öğle namazı" }, { nl: "Asr (ikindi) – namiddag", tr: "İkindi namazı" }, { nl: "Maghrib (akşam) – avond", tr: "Akşam namazı" }, { nl: "Isha (yatsı) – nacht", tr: "Yatsı namazı" } ] },
  { icon: "🏛️", icons: ["☝️", "🧎", "🤲", "🌙", "🕋"], photo: "Kaaba", title: { nl: "De vijf zuilen van de islam", tr: "İslam'ın beş şartı" }, steps: [
    { nl: "Shahada – geloofsgetuigenis", tr: "Kelime-i şehadet" }, { nl: "Salat – het gebed", tr: "Namaz" }, { nl: "Zakat – geven aan de armen", tr: "Zekât" }, { nl: "Sawm – vasten in de ramadan", tr: "Oruç" }, { nl: "Hadj – bedevaart naar Mekka", tr: "Hac" } ] },
  { icon: "🧎", icons: ["🧍", "🙇", "🧍", "🧎", "🪑", "🧎"], photo: "Salah", title: { nl: "Een rak'ah van het gebed", tr: "Namazın bir rekâtı" }, steps: [
    { nl: "Staan (kıyam) en Al-Fatiha lezen", tr: "Kıyam ve Fâtiha okumak" }, { nl: "Buigen (rükû)", tr: "Rükû" }, { nl: "Weer rechtop staan", tr: "Doğrulmak" }, { nl: "Eerste neerknieling (secde)", tr: "Birinci secde" }, { nl: "Even zitten", tr: "Oturmak" }, { nl: "Tweede neerknieling (secde)", tr: "İkinci secde" } ] },
  { icon: "🌙", icons: ["🌄", "🕌", "☀️", "🍽️", "🌃"], photo: "Ramadan", title: { nl: "Een dag in de ramadan", tr: "Ramazanda bir gün" }, steps: [
    { nl: "Sahur – eten vóór zonsopgang", tr: "Sahur" }, { nl: "Fajr-gebed en het vasten begint", tr: "Sabah namazı, oruç başlar" }, { nl: "Overdag: geen eten of drinken, goed gedrag", tr: "Gündüz: yemek yok, güzel davranış" }, { nl: "Iftar bij zonsondergang (akşam)", tr: "Akşam ezanıyla iftar" }, { nl: "Teravih-gebed in de avond", tr: "Teravih namazı" } ] },
];

/** Korte soera's om te leren: nummer in de Koran en een kindvriendelijke uitleg. */
export const SURAHS: { n: number; name: Bi; about: Bi; photo: string }[] = [
  { n: 1, photo: "Al-Fatiha", name: { nl: "Al-Fatiha", tr: "Fâtiha" }, about: { nl: "De opening: we vragen Allah om ons de goede weg te tonen. Je leest ze in elk gebed.", tr: "Açılış: Allah'tan bize doğru yolu göstermesini isteriz. Her namazda okunur." } },
  { n: 112, photo: "Al-Ikhlas", name: { nl: "Al-Ikhlas", tr: "İhlâs" }, about: { nl: "Allah is Eén, Hij heeft niemand nodig en er is niemand zoals Hij.", tr: "Allah birdir, hiçbir şeye muhtaç değildir, O'nun dengi yoktur." } },
  { n: 113, photo: "Al-Falaq", name: { nl: "Al-Falaq", tr: "Felak" }, about: { nl: "We zoeken bescherming bij Allah tegen alles wat kwaad is.", tr: "Her kötülükten Allah'a sığınırız." } },
  { n: 114, photo: "An-Nas", name: { nl: "An-Nas", tr: "Nâs" }, about: { nl: "We zoeken bescherming bij Allah, de Heer van de mensen, tegen influisteringen.", tr: "İnsanların Rabbi olan Allah'a vesveselerden sığınırız." } },
  { n: 108, photo: "Al-Kawthar", name: { nl: "Al-Kevser", tr: "Kevser" }, about: { nl: "De kortste soera: Allah gaf de profeet veel goeds, dus bid en wees dankbaar.", tr: "En kısa sure: Allah peygambere çok hayır verdi; namaz kıl ve şükret." } },
  { n: 103, photo: "Al-Asr", name: { nl: "Al-Asr", tr: "Asr" }, about: { nl: "Over tijd: wie gelooft, goed doet en geduldig is, is op de goede weg.", tr: "Zaman üzerine: iman eden, iyilik yapan ve sabreden kazanır." } },
  { n: 110, photo: "An-Nasr", name: { nl: "An-Nasr", tr: "Nasr" }, about: { nl: "Als de hulp van Allah komt, prijs Hem en vraag vergeving.", tr: "Allah'ın yardımı gelince O'nu tesbih et ve bağışlanma dile." } },
];
