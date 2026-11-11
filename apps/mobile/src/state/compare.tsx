import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export const MAX_COMPARE = 4;

interface CompareCtx {
  ids: string[];
  has(id: string): boolean;
  /** Returns false when the tray is full. */
  toggle(id: string): boolean;
  clear(): void;
  set(ids: string[]): void;
}
const Ctx = createContext<CompareCtx | null>(null);

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const toggle = useCallback(
    (id: string) => {
      if (ids.includes(id)) {
        setIds(ids.filter((x) => x !== id));
        return true;
      }
      if (ids.length >= MAX_COMPARE) return false;
      setIds([...ids, id]);
      return true;
    },
    [ids],
  );
  const value = useMemo<CompareCtx>(
    () => ({ ids, has: (id) => ids.includes(id), toggle, clear: () => setIds([]), set: (n) => setIds(n.slice(0, MAX_COMPARE)) }),
    [ids, toggle],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompare() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCompare outside CompareProvider");
  return v;
}
