import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { applyTheme, resetTheme } from "../../lib/theme";
import { toast } from "react-hot-toast";
import { Field } from "../../components/ui/Field";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

const NameSchema = z.object({
  name: z.string().min(2, "Min 2 characters").max(120, "Max 120 characters"),
});
type NameInput = z.infer<typeof NameSchema>;

const ThemeSchema = z.object({
  primary: z.string().regex(HEX, "Use hex like #2563eb"),
  secondary: z.string().regex(HEX, "Use hex like #10b981"),
  accent: z.string().regex(HEX, "Use hex like #f59e0b"),
  success: z.string().regex(HEX, "Use hex like #16a34a"),
  warning: z.string().regex(HEX, "Use hex like #f59e0b"),
  error: z.string().regex(HEX, "Use hex like #dc2626"),
});
type ThemeInput = z.infer<typeof ThemeSchema>;

const DEFAULT_THEME: ThemeInput = {
  primary: "#2563eb",
  secondary: "#10b981",
  accent: "#f59e0b",
  success: "#16a34a",
  warning: "#f59e0b",
  error: "#dc2626",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

export default function CompanyProfile() {
  // logos & upload state
  const [logoSquare, setLogoSquare] = useState<string | null>(null);
  const [logoHorizontal, setLogoHorizontal] = useState<string | null>(null);
  const [squareFile, setSquareFile] = useState<File | null>(null);
  const [wideFile, setWideFile] = useState<File | null>(null);
  const [uploadingSquare, setUploadingSquare] = useState(false);
  const [uploadingWide, setUploadingWide] = useState(false);

  // global banners
  const [loading, setLoading] = useState(true);
  const [savingTheme, setSavingTheme] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // forms
  const {
    register: registerName,
    handleSubmit: handleSubmitName,
    reset: resetName,
    formState: { errors: nameErrors, isSubmitting: savingName },
  } = useForm<NameInput>({
    resolver: zodResolver(NameSchema),
    defaultValues: { name: "" },
    mode: "onSubmit",
  });

  const {
    register: registerTheme,
    handleSubmit: handleSubmitTheme,
    reset: resetThemeForm,
    watch: watchTheme,
    formState: { errors: themeErrors },
  } = useForm<ThemeInput>({
    resolver: zodResolver(ThemeSchema),
    defaultValues: DEFAULT_THEME,
    mode: "onChange",
  });

  // live-preview theme on change (local only)
  const themeWatchValues = watchTheme();
  useEffect(() => {
    applyTheme(themeWatchValues);
  }, [themeWatchValues]);

  // load initial data
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/profile");
        const name = res.data?.company?.name || "";
        const square = res.data?.company?.logoSquare || null;
        const horiz = res.data?.company?.logoHorizontal || null;
        resetName({ name });
        setLogoSquare(square);
        setLogoHorizontal(horiz);

        const t = await api.get("/companies/theme");
        if (t?.data?.theme) {
          const merged = { ...DEFAULT_THEME, ...t.data.theme };
          resetThemeForm(merged);
          applyTheme(merged);
        } else {
          resetThemeForm(DEFAULT_THEME);
          applyTheme(DEFAULT_THEME);
        }
      } catch (e: any) {
        const msg = e?.response?.data?.error || "Failed to load company";
        setErr(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // helpers
  const apiBase = import.meta.env.VITE_API_URL || "http://localhost:4000";
  const validateImageFile = (file: File | null) => {
    if (!file) return "No file selected";
    if (!file.type.startsWith("image/")) return "Only image files allowed";
    if (file.size > MAX_FILE_BYTES) return "File must be ≤ 10MB";
    return null;
  };

  // submit handlers
  const onSaveName = async (data: NameInput) => {
    setOk(null);
    setErr(null);
    try {
      await api.put("/companies/profile", { name: data.name.trim() });
      setOk("Company name updated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update company name";
      setErr(msg);
      toast.error(msg);
    }
  };

  const onSaveTheme = async (data: ThemeInput) => {
    setOk(null);
    setErr(null);
    try {
      setSavingTheme(true);
      await api.put("/companies/theme", data);
      setOk("Theme updated");
      applyTheme(data);
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update theme";
      setErr(msg);
      toast.error(msg);
    } finally {
      setSavingTheme(false);
    }
  };

  const onResetTheme = async () => {
    if (!window.confirm("Reset theme to default colors?")) return;
    setOk(null);
    setErr(null);
    try {
      setSavingTheme(true);
      await api.delete("/companies/theme");
      resetTheme(); // reset CSS vars
      resetThemeForm(DEFAULT_THEME);
      applyTheme(DEFAULT_THEME);
      setOk("Theme reset to defaults");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to reset theme";
      setErr(msg);
      toast.error(msg);
    } finally {
      setSavingTheme(false);
    }
  };

  // uploads
  const uploadSquare = async () => {
    setOk(null);
    setErr(null);
    const v = validateImageFile(squareFile);
    if (v) {
      setErr(v);
      toast.error(v);
      return;
    }
    try {
      setUploadingSquare(true);
      const fd = new FormData();
      fd.append("logo", squareFile as File);
      const res = await api.post("/companies/logo-square", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setLogoSquare(res.data?.logoSquare || null);
      setSquareFile(null);
      setOk("Square logo updated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to upload square logo";
      setErr(msg);
      toast.error(msg);
    } finally {
      setUploadingSquare(false);
    }
  };

  const uploadHorizontal = async () => {
    setOk(null);
    setErr(null);
    const v = validateImageFile(wideFile);
    if (v) {
      setErr(v);
      toast.error(v);
      return;
    }
    try {
      setUploadingWide(true);
      const fd = new FormData();
      fd.append("logo", wideFile as File);
      const res = await api.post("/companies/logo-horizontal", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setLogoHorizontal(res.data?.logoHorizontal || null);
      setWideFile(null);
      setOk("Horizontal logo updated");
    } catch (e: any) {
      const msg =
        e?.response?.data?.error || "Failed to upload horizontal logo";
      setErr(msg);
      toast.error(msg);
    } finally {
      setUploadingWide(false);
    }
  };

  if (loading) return <div>Loading…</div>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Company Profile</h2>
        <p className="text-sm text-muted">
          Update your company name, logos, and theme.
        </p>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}
      {ok && (
        <div className="rounded-md border border-success/20 bg-success/10 px-4 py-2 text-sm text-success">
          {ok}
        </div>
      )}

      {/* Name */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">General</h3>
        </div>
        <form
          onSubmit={handleSubmitName(onSaveName)}
          className="px-6 py-5 space-y-5"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Company Name">
              <input
                type="text"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="Acme Corp"
                {...registerName("name")}
              />
              {nameErrors.name && (
                <p className="text-xs text-error mt-1">
                  {nameErrors.name.message}
                </p>
              )}
            </Field>
          </div>
          <div className="pt-2">
            <button
              type="submit"
              disabled={savingName}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {savingName ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </section>

      {/* Logos upload */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold">Company Logos</h3>
            <p className="text-xs text-muted">
              Upload square and horizontal variants
            </p>
          </div>
        </div>

        <div className="px-6 py-6 space-y-10">
          {/* Square logo */}
          <div className="grid gap-6 md:grid-cols-[auto_1fr] items-start">
            <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-md border border-border bg-bg shadow-sm">
              {logoSquare ? (
                <img
                  src={`${apiBase}/uploads/${logoSquare}`}
                  alt="Square logo"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted">No square logo</span>
              )}
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium">Square Logo (1:1)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setSquareFile(e.target.files?.[0] || null)}
                className="block text-sm"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={uploadSquare}
                  disabled={uploadingSquare || !squareFile}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
                >
                  {uploadingSquare ? "Uploading…" : "Upload"}
                </button>
                <p className="text-xs text-muted">
                  PNG/JPG • ≤10MB • 256×256+ recommended
                </p>
              </div>
            </div>
          </div>

          {/* Horizontal logo */}
          <div className="grid gap-6 md:grid-cols-[auto_1fr] items-start">
            <div className="flex h-20 w-52 items-center justify-center overflow-hidden rounded-md border border-border bg-bg shadow-sm">
              {logoHorizontal ? (
                <img
                  src={`${apiBase}/uploads/${logoHorizontal}`}
                  alt="Horizontal logo"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted">No horizontal logo</span>
              )}
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium">
                Horizontal Logo (wide)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setWideFile(e.target.files?.[0] || null)}
                className="block text-sm"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={uploadHorizontal}
                  disabled={uploadingWide || !wideFile}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
                >
                  {uploadingWide ? "Uploading…" : "Upload"}
                </button>
                <p className="text-xs text-muted">
                  PNG/JPG • ≤10MB • 512×128+ recommended
                </p>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted text-center">
            If a variant is missing, the app will use the available logo or
            default.
          </p>
        </div>
      </section>

      {/* Theme customization */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Theme Colors</h3>
          <span className="text-xs text-muted">Company-specific</span>
        </div>

        <form
          onSubmit={handleSubmitTheme(onSaveTheme)}
          className="px-6 py-5 space-y-5"
        >
          <div className="grid gap-6 md:grid-cols-3">
            {(
              [
                "primary",
                "secondary",
                "accent",
                "success",
                "warning",
                "error",
              ] as const
            ).map((key) => (
              <div key={key} className="space-y-2">
                <label className="text-sm font-medium capitalize">{key}</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    className="h-10 w-16 rounded-md border border-border bg-surface cursor-pointer"
                    aria-label={`${key} color`}
                    {...registerTheme(key)}
                  />
                  <input
                    type="text"
                    className="flex-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm"
                    placeholder="#000000"
                    {...registerTheme(key)}
                  />
                </div>
                {themeErrors[key] && (
                  <p className="text-xs text-error mt-1">
                    {themeErrors[key]?.message as string}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={savingTheme}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {savingTheme ? "Saving…" : "Save Theme"}
            </button>
            <button
              type="button"
              onClick={onResetTheme}
              disabled={savingTheme}
              className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-[color:rgb(var(--color-text))] disabled:opacity-60"
            >
              Reset to Default
            </button>
            <span className="text-xs text-muted">
              Changes apply immediately in this session.
            </span>
          </div>
        </form>
      </section>
    </div>
  );
}
