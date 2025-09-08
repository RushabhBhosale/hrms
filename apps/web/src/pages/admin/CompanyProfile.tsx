import { useEffect, useState, FormEvent } from "react";
import { api } from "../../lib/api";
import { applyTheme, resetTheme } from "../../lib/theme";
import { toast } from "react-hot-toast";
import { Field } from "../../components/ui/Field";

export default function CompanyProfile() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null); // generic fallback
  const [logoSquare, setLogoSquare] = useState<string | null>(null);
  const [logoHorizontal, setLogoHorizontal] = useState<string | null>(null);
  const [squareFile, setSquareFile] = useState<File | null>(null);
  const [wideFile, setWideFile] = useState<File | null>(null);
  const [uploadingSquare, setUploadingSquare] = useState(false);
  const [uploadingWide, setUploadingWide] = useState(false);
  const [theme, setTheme] = useState<{ [k: string]: string }>({
    primary: "#2563eb",
    secondary: "#10b981",
    accent: "#f59e0b",
    success: "#16a34a",
    warning: "#f59e0b",
    error: "#dc2626",
  });
  const [savingTheme, setSavingTheme] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/profile");
        setName(res.data?.company?.name || "");
        setLogo(res.data?.company?.logo || null);
        setLogoSquare(res.data?.company?.logoSquare || null);
        setLogoHorizontal(res.data?.company?.logoHorizontal || null);
        // Try to load theme
        const t = await api.get("/companies/theme");
        if (t?.data?.theme) setTheme((prev) => ({ ...prev, ...t.data.theme }));
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn(e?.response?.data?.error || e?.message || e);
        const msg = e?.response?.data?.error || "Failed to load company";
        setErr(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setOk(null);
    setErr(null);
    try {
      setSubmitting(true);
      const payload = { name: name.trim() };
      await api.put("/companies/profile", payload);
      setOk("Company name updated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update company name";
      setErr(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div>Loading…</div>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Company Profile</h2>
        <p className="text-sm text-muted">Update your company name and logo.</p>
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

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">General</h3>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Company Name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="Acme Corp"
                required
                minLength={2}
                maxLength={120}
              />
            </Field>
          </div>
          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Save"}
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
                  src={`${
                    import.meta.env.VITE_API_URL || "http://localhost:4000"
                  }/uploads/${logoSquare}`}
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
                  onClick={async () => {
                    if (!squareFile) return;
                    setErr(null);
                    setOk(null);
                    setUploadingSquare(true);
                    try {
                      const fd = new FormData();
                      fd.append("logo", squareFile);
                      const res = await api.post("/companies/logo-square", fd, {
                        headers: { "Content-Type": "multipart/form-data" },
                      });
                      setLogoSquare(res.data?.logoSquare || null);
                      setSquareFile(null);
                      setOk("Square logo updated");
                    } catch (e: any) {
                      setErr(
                        e?.response?.data?.error ||
                          "Failed to upload square logo"
                      );
                    } finally {
                      setUploadingSquare(false);
                    }
                  }}
                  disabled={uploadingSquare || !squareFile}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
                >
                  {uploadingSquare ? "Uploading…" : "Upload"}
                </button>
                <p className="text-xs text-muted">
                  PNG/JPG • 256×256+ recommended
                </p>
              </div>
            </div>
          </div>

          {/* Horizontal logo */}
          <div className="grid gap-6 md:grid-cols-[auto_1fr] items-start">
            <div className="flex h-20 w-52 items-center justify-center overflow-hidden rounded-md border border-border bg-bg shadow-sm">
              {logoHorizontal ? (
                <img
                  src={`${
                    import.meta.env.VITE_API_URL || "http://localhost:4000"
                  }/uploads/${logoHorizontal}`}
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
                  onClick={async () => {
                    if (!wideFile) return;
                    setErr(null);
                    setOk(null);
                    setUploadingWide(true);
                    try {
                      const fd = new FormData();
                      fd.append("logo", wideFile);
                      const res = await api.post(
                        "/companies/logo-horizontal",
                        fd,
                        { headers: { "Content-Type": "multipart/form-data" } }
                      );
                      setLogoHorizontal(res.data?.logoHorizontal || null);
                      setWideFile(null);
                      setOk("Horizontal logo updated");
                    } catch (e: any) {
                      setErr(
                        e?.response?.data?.error ||
                          "Failed to upload horizontal logo"
                      );
                    } finally {
                      setUploadingWide(false);
                    }
                  }}
                  disabled={uploadingWide || !wideFile}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
                >
                  {uploadingWide ? "Uploading…" : "Upload"}
                </button>
                <p className="text-xs text-muted">
                  PNG/JPG • 512×128+ recommended
                </p>
              </div>
            </div>
          </div>

          {/* Fallback info */}
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
        <div className="px-6 py-5 space-y-5">
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
                    value={theme[key]}
                    onChange={(e) =>
                      setTheme((t) => ({ ...t, [key]: e.target.value }))
                    }
                    className="h-10 w-16 rounded-md border border-border bg-surface cursor-pointer"
                    aria-label={`${key} color`}
                  />
                  <input
                    type="text"
                    value={theme[key]}
                    onChange={(e) =>
                      setTheme((t) => ({ ...t, [key]: e.target.value }))
                    }
                    className="flex-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm"
                    placeholder="#000000"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              onClick={async () => {
                setSavingTheme(true);
                setOk(null);
                setErr(null);
                try {
                  const payload = Object.fromEntries(
                    Object.entries(theme).filter(
                      ([_, v]) => typeof v === "string" && v
                    )
                  );
                  await api.put("/companies/theme", payload);
                  setOk("Theme updated");
                  applyTheme(theme);
                } catch (e: any) {
                  setErr(e?.response?.data?.error || "Failed to update theme");
                } finally {
                  setSavingTheme(false);
                }
              }}
              disabled={savingTheme}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {savingTheme ? "Saving…" : "Save Theme"}
            </button>
            <button
              onClick={async () => {
                if (!window.confirm("Reset theme to default colors?")) return;
                setSavingTheme(true);
                setOk(null);
                setErr(null);
                try {
                  await api.delete("/companies/theme");
                  // Reset runtime CSS vars and local state to defaults
                  resetTheme();
                  setTheme({
                    primary: "#2563eb",
                    secondary: "#10b981",
                    accent: "#f59e0b",
                    success: "#16a34a",
                    warning: "#f59e0b",
                    error: "#dc2626",
                  });
                  setOk("Theme reset to defaults");
                } catch (e: any) {
                  setErr(e?.response?.data?.error || "Failed to reset theme");
                } finally {
                  setSavingTheme(false);
                }
              }}
              disabled={savingTheme}
              className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-[color:rgb(var(--color-text))] disabled:opacity-60"
            >
              Reset to Default
            </button>
            <span className="text-xs text-muted">
              Changes apply immediately in this session.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
