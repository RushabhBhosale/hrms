import { useCallback, useEffect, useSyncExternalStore, useState } from "react";
import {
  Employee,
  getEmployee,
  refreshEmployeeFromApi,
  subscribeToAuthChanges,
} from "../lib/auth";

type Options = {
  refreshOnMount?: boolean;
  refreshOnFocus?: boolean;
  refreshIntervalMs?: number;
};

const defaultOptions: Required<Options> = {
  refreshOnMount: false,
  refreshOnFocus: false,
  refreshIntervalMs: 0,
};

export function useCurrentEmployee(opts?: Options) {
  const options = { ...defaultOptions, ...(opts || {}) };
  const employee = useSyncExternalStore<Employee | null>(
    subscribeToAuthChanges,
    getEmployee,
    () => null
  );
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      return await refreshEmployeeFromApi();
    } catch (err) {
      console.error("Failed to refresh session", err);
      return null;
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!options.refreshOnMount) return;
    refresh();
  }, [options.refreshOnMount, refresh]);

  useEffect(() => {
    if (!options.refreshOnFocus || typeof window === "undefined") return;
    const handler = () => refresh();
    window.addEventListener("focus", handler);
    document.addEventListener("visibilitychange", handler);
    return () => {
      window.removeEventListener("focus", handler);
      document.removeEventListener("visibilitychange", handler);
    };
  }, [options.refreshOnFocus, refresh]);

  useEffect(() => {
    if (!options.refreshIntervalMs || typeof window === "undefined") return;
    const id = window.setInterval(refresh, options.refreshIntervalMs);
    return () => window.clearInterval(id);
  }, [options.refreshIntervalMs, refresh]);

  return { employee, refresh, refreshing };
}
