/**
 * Online ezan-opnames zoeken in het openbare Internet Archive (archive.org), zodat het gezin
 * geluiden kan beluisteren en bewaren zonder zelf bestanden te moeten zoeken.
 */
export interface EzanHit { id: string; title: string; url: string; size: number; source: string }

const cache = new Map<string, { at: number; hits: EzanHit[] }>();
const UA = { "user-agent": "Gezinsbord/1.0 (gezinsscherm)" };

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Het archief antwoordde met ${r.status}.`);
  return (await r.json()) as T;
}

/** Kies uit de bestanden van een archiefitem de beste geluidsbestanden (mp3/ogg, niet te groot). */
export function pickAudioFiles(id: string, title: string, files: { name: string; format?: string; size?: string | number; length?: string }[]): EzanHit[] {
  return files
    .filter((f) => /\.(mp3|ogg|m4a)$/i.test(f.name) && !/_(64kb|spectrogram)/i.test(f.name))
    .map((f) => ({ id: `${id}/${f.name}`, title: files.length > 1 ? `${title} · ${f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ")}` : title, url: `https://archive.org/download/${id}/${encodeURIComponent(f.name)}`, size: Number(f.size) || 0, source: "archive.org" }))
    .filter((f) => f.size === 0 || f.size <= 40 * 1024 * 1024)
    .slice(0, 6);
}

export async function searchEzan(q: string): Promise<EzanHit[]> {
  const key = q.trim().toLocaleLowerCase("tr");
  const c = cache.get(key);
  if (c && Date.now() - c.at < 60 * 60_000) return c.hits;
  const query = `(${q.trim()}) AND mediatype:(audio)`;
  const s = await getJson<{ response: { docs: { identifier: string; title?: string; downloads?: number }[] } }>(
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=downloads&sort[]=downloads+desc&rows=10&page=1&output=json`,
  );
  const docs = s.response?.docs ?? [];
  const hits: EzanHit[] = [];
  await Promise.all(docs.slice(0, 8).map(async (d) => {
    try {
      const m = await getJson<{ files?: { name: string; format?: string; size?: string; length?: string }[] }>(`https://archive.org/metadata/${encodeURIComponent(d.identifier)}`);
      hits.push(...pickAudioFiles(d.identifier, d.title || d.identifier, m.files ?? []));
    } catch { /* dit item overslaan */ }
  }));
  const out = hits.slice(0, 30);
  cache.set(key, { at: Date.now(), hits: out });
  return out;
}
