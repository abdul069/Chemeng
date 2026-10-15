import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, onChanged } from "./api";
import type { Bootstrap, Member, Topic } from "./types";

interface Ctx {
  data: Bootstrap | null;
  error: string | null;
  reload: () => void;
  member: (id: string) => Member | undefined;
  hidden: Set<string>;
  toggleHidden: (id: string) => void;
  toast: (msg: string) => void;
}

const DataCtx = createContext<Ctx | null>(null);
const BOOT_TOPICS: Topic[] = ["members", "chores", "rewards", "lists", "recipes", "calendars", "photos", "settings"];

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const timer = useRef<number>(0);

  const reload = useCallback(() => {
    api.get<Bootstrap>("/bootstrap").then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
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

  const value = useMemo<Ctx>(() => ({
    data, error, reload, hidden, toast,
    member: (id) => data?.members.find((m) => m.id === id),
    toggleHidden: (id) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
  }), [data, error, reload, hidden, toast]);

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
      toast(e instanceof Error ? e.message : "Er ging iets mis.");
      return undefined;
    }
  }, [toast]);
}
