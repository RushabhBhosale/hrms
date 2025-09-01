import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { getEmployee } from "../lib/auth";
import { applyTheme, Theme } from "../lib/theme";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const u = getEmployee();
    if (!u) {
      setLoaded(true);
      return;
    }
    (async () => {
      try {
        const res = await api.get("/companies/theme");
        if (res?.data?.theme) applyTheme(res.data.theme as Theme);
      } catch {
        // ignore if endpoint not available or unauthorized
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Render once ready (prevent flash if you prefer); here we just pass children
  return <>{children}</>;
}
