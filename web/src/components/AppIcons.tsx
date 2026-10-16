import { useState } from "react";

/** Echte app-iconen: eigen vector-iconen voor onze onderdelen, het officiële website-icoon voor externe diensten. */
const G = ({ id, from, to }: { id: string; from: string; to: string }) => (
  <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient></defs>
);
const Tile = ({ fill, children }: { fill: string; children: React.ReactNode }) => (
  <>
    <rect x="2" y="2" width="60" height="60" rx="15" fill={fill} />
    <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#gloss)" />
    {children}
  </>
);
const gloss = <defs><linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>;

export const OWN_ICONS: Record<string, React.ReactNode> = {
  photos: <svg viewBox="0 0 64 64">{gloss}<G id="gph" from="#5ad1c9" to="#1f8f88" /><Tile fill="url(#gph)"><rect x="13" y="17" width="38" height="30" rx="5" fill="#fff" opacity=".95" /><circle cx="24" cy="27" r="4" fill="#f6c343" /><path d="M16 43l10-10 7 7 5-5 10 8H16z" fill="#2f9f87" /></Tile></svg>,
  weather: <svg viewBox="0 0 64 64">{gloss}<G id="gwe" from="#6fb7ff" to="#2a6fd6" /><Tile fill="url(#gwe)"><circle cx="26" cy="26" r="9" fill="#ffd34d" /><path d="M20 46h24a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0-3 13z" fill="#fff" /></Tile></svg>,
  clock: <svg viewBox="0 0 64 64">{gloss}<G id="gcl" from="#ff9d5c" to="#e0582b" /><Tile fill="url(#gcl)"><circle cx="32" cy="32" r="18" fill="#fff" /><circle cx="32" cy="32" r="15" fill="#fff8f1" stroke="#f3d9c8" /><path d="M32 20v12l8 5" stroke="#1e2632" strokeWidth="3" strokeLinecap="round" fill="none" /><circle cx="32" cy="32" r="2" fill="#e0582b" /></Tile></svg>,
  memos: <svg viewBox="0 0 64 64">{gloss}<G id="gme" from="#b58cf0" to="#7a46d4" /><Tile fill="url(#gme)"><rect x="26" y="14" width="12" height="22" rx="6" fill="#fff" /><path d="M20 30a12 12 0 0 0 24 0M32 42v7M25 49h14" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" /></Tile></svg>,
  recipes: <svg viewBox="0 0 64 64">{gloss}<G id="gre" from="#ff8a80" to="#d8382f" /><Tile fill="url(#gre)"><path d="M14 30h36v8a12 12 0 0 1-12 12H26a12 12 0 0 1-12-12z" fill="#fff" /><rect x="10" y="28" width="44" height="5" rx="2.5" fill="#ffe3df" /><path d="M26 23c0-4 3-4 3-8M34 23c0-4 3-4 3-8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity=".9" /></Tile></svg>,
  news: <svg viewBox="0 0 64 64">{gloss}<G id="gne" from="#8a94a6" to="#4b5563" /><Tile fill="url(#gne)"><rect x="14" y="16" width="36" height="32" rx="4" fill="#fff" /><rect x="18" y="21" width="14" height="10" rx="2" fill="#4b5563" /><path d="M36 22h10M36 27h10M18 36h28M18 41h28" stroke="#9aa3b2" strokeWidth="2.5" strokeLinecap="round" /></Tile></svg>,
  library: <svg viewBox="0 0 64 64">{gloss}<G id="gli" from="#f2b84b" to="#d97a1a" /><Tile fill="url(#gli)"><rect x="15" y="16" width="34" height="32" rx="4" fill="#fff" /><path d="M32 16v32" stroke="#f1dcc0" strokeWidth="2" /><path d="M19 24h9M19 30h9M19 36h9M36 24h9M36 30h9M36 36h9" stroke="#d97a1a" strokeWidth="2" strokeLinecap="round" /></Tile></svg>,
};

/** Icoon van een externe dienst: het echte website-icoon, met een nette terugval. */
export function BrandIcon({ domain, fallback }: { domain: string; fallback: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="brand-fallback">{fallback}</span>;
  return <img className="brand" src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}
