import { useCallback, useEffect, useState } from "react";

export function useSidebarOpenSections(
  storageKey: string,
  autoOpenKey: string
) {
  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(parsed);
        }
      }
    } catch {}
    return new Set([autoOpenKey]);
  });

  useEffect(() => {
    setOpenSections((prev) => {
      if (prev.has(autoOpenKey)) return prev;
      const next = new Set(prev);
      next.add(autoOpenKey);
      return next;
    });
  }, [autoOpenKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(openSections)));
    } catch {}
  }, [openSections, storageKey]);

  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return { openSections, toggleSection };
}
