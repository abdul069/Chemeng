import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, onChanged, ApiError } from "./api";
import type { Bootstrap, Member, Topic } from "./types";
import { t, setLang } from "./i18n";

interface Ctx {
  data: Bootstrap | null;
  error: string | null;
  /** "login" als er niemand is aangemeld, "no_household" als de gebruiker nog bij geen gezin hoort */
  errorCode: string | null;
  reload: () => void;
  member: (id: string) => Member | undefined;
  /** Gezinsleden plus mensen die hun agenda met jou delen */
  people: Member[];
  hidden: Set<string>;
  toggleHidden: (id: string) => void;
  toast: (msg: string) => void;
}

const DataCtx = createContext<Ctx | null>(null);
const BOOT_TOPICS: Topic[] = ["members", "chores", "rewards", "lists", "recipes", "calendars", "photos", "settings", "access", "sharing"];

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const timer = useRef<number>(0);

  const reload = useCallback(() => {
    api.get<Bootstrap>("/bootstrap")
      .then((d) => {
        // nieuwe versie online? één keer verversen zodat niemand op een oud scherm blijft werken
        const mine = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.src.match(/index-([A-Za-z0-9_-]+)\.js/)?.[1];
        if (d.build && mine && d.build !== mine && sessionStorage.getItem("gb.reloaded") !== d.build) { sessionStorage.setItem("gb.reloaded", d.build); location.reload(); return; }
        // eerst het woordenboek, dan tekenen: anders flitst Nederlands voor Turks
        void setLang(d.settings.language === "tr" ? "tr" : "nl").then(() => { setData(d); setError(null); setErrorCode(null); });
      })
      .catch((e) => {
        setError(e.message);
        const code = e instanceof ApiError ? e.code ?? null : null;
        setErrorCode(code);
        if (code) setData(null);
      });
  }, []);
  useEffect(() => {
    reload();
    return onChanged((topics) => { if (topics.some((t) => BOOT_TOPICS.includes(t))) reload(); });
  }, [reload]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastMsg(null), 2800);
  }, []);

  const value = useMemo<Ctx>(() => {
    const people = data ? [...data.members, ...data.shared] : [];
    return {
    data, error, errorCode, reload, hidden, toast, people,
    member: (id) => people.find((m) => m.id === id),
    toggleHidden: (id) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
  }; }, [data, error, errorCode, reload, hidden, toast]);

  return (
    <DataCtx.Provider value={value}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </DataCtx.Provider>
  );
}

export function useData() {
  const c = useContext(DataCtx);
  if (!c) throw new Error("useData buiten DataProvider");
  return c;
}

/** Haalt gegevens op voor een periode en ververst ze zodra een ander scherm iets wijzigt. */
export function useRemote<T>(url: string | null, topics: Topic[], initial: T): [T, () => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const key = topics.join(",");
  const load = useCallback(() => {
    if (!url) return;
    api.get<T>(url).then((v) => { setValue(v); setLoading(false); }).catch(() => setLoading(false));
  }, [url]);
  useEffect(() => {
    load();
    const t = key.split(",") as Topic[];
    return onChanged((changed) => { if (changed.some((c) => t.includes(c))) load(); });
  }, [load, key]);
  return [value, load, loading];
}

/** Voert een actie uit en toont een melding bij fouten. */
export function useAction() {
  const { toast } = useData();
  return useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    try {
      const r = await fn();
      if (ok) toast(ok);
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Er ging iets mis."));
      return undefined;
    }
  }, [toast]);
}
