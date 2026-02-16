import axios from "axios";
import { toast } from "react-hot-toast";

export const api = axios.create({
  // baseURL: "/api",
  baseURL: "http://localhost:4000",
  withCredentials: false,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function pickHeader(headers: Record<string, any> | undefined, key: string) {
  if (!headers) return undefined;
  const target = key.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === target) return (headers as any)[k];
  }
  return undefined;
}

api.interceptors.response.use(
  (response) => {
    const method = (response.config.method || "").toUpperCase();
    const headers = response.config.headers || {};
    const cfg = response.config as Record<string, any>;
    const skip =
      cfg.skipToast === true ||
      String(pickHeader(headers, "X-Skip-Toast") || "").toLowerCase() ===
        "true";
    const enableSuccessToast =
      cfg.enableSuccessToast === true ||
      String(pickHeader(headers, "X-Toast-Success") || "").toLowerCase() ===
        "true";
    if (method && method !== "GET" && !skip && enableSuccessToast) {
      const resHeaders = response.headers || {};
      const data = response.data || {};
      const msg =
        pickHeader(resHeaders, "x-success-message") ||
        data.message ||
        data.successMessage ||
        cfg.successMessage ||
        pickHeader(headers, "X-Success-Message");
      if (msg) toast.success(String(msg));
    }
    return response;
  },
  (error) => {
    const method = (error?.config?.method || "").toUpperCase();
    const headers = (error?.config?.headers as Record<string, any>) || {};
    const cfg = (error?.config as Record<string, any>) || {};
    const skip =
      cfg.skipToast === true ||
      String(pickHeader(headers, "X-Skip-Toast") || "").toLowerCase() ===
        "true";
    if (method && method !== "GET" && !skip) {
      const apiMsg =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        "Failed to save changes";
      toast.error(String(apiMsg));
    }
    return Promise.reject(error);
  },
);
