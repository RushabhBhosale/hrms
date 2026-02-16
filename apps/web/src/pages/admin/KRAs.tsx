import { FormEvent, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";

type RoleOption = { key: string; label: string };

function toInputDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function KRAs() {
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [allRoles, setAllRoles] = useState(false);

  const [kraForm, setKraForm] = useState({
    title: "",
    description: "",
  });
  const [creatingKra, setCreatingKra] = useState(false);

  const [kraWindow, setKraWindow] = useState({ openFrom: "", openTo: "" });
  const [loadingWindow, setLoadingWindow] = useState(false);
  const [savingWindow, setSavingWindow] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/roles");
        const list: RoleOption[] = (res.data.roles || []).map((r: any) => ({
          key: r.role,
          label: r.label || r.role,
        }));
        setRoles(list);
        if (!selectedRole && list.length) {
          setSelectedRole(list[0].key);
        }
      } catch (e: any) {
        toast.error(e?.response?.data?.error || "Failed to load roles");
      }
    })();

    loadKraWindow();
  }, []);

  async function loadKraWindow() {
    try {
      setLoadingWindow(true);
      const res = await api.get("/performance/kras/window");
      const w = res.data?.window || {};
      setKraWindow({
        openFrom: toInputDate(w.openFrom),
        openTo: toInputDate(w.openTo),
      });
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to load KRA window");
    } finally {
      setLoadingWindow(false);
    }
  }

  async function saveKraWindow(e: FormEvent) {
    e.preventDefault();
    try {
      setSavingWindow(true);
      await api.patch("/performance/kras/window", {
        openFrom: kraWindow.openFrom || undefined,
        openTo: kraWindow.openTo || undefined,
      });
      toast.success("KRA window saved");
      await loadKraWindow();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to save KRA window");
    } finally {
      setSavingWindow(false);
    }
  }

  async function clearKraWindow() {
    try {
      setSavingWindow(true);
      await api.patch("/performance/kras/window", {
        openFrom: null,
        openTo: null,
      });
      setKraWindow({ openFrom: "", openTo: "" });
      toast.success("KRA window cleared");
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to clear KRA window");
    } finally {
      setSavingWindow(false);
    }
  }

  async function submitKra(e: FormEvent) {
    e.preventDefault();
    if (!allRoles && !selectedRole) {
      toast.error("Pick a role");
      return;
    }
    const payload = {
      roleKey: allRoles ? undefined : selectedRole,
      applyToAllRoles: allRoles,
      title: kraForm.title.trim(),
      description: kraForm.description.trim(),
    };
    if (!payload.title) {
      toast.error("Title is required");
      return;
    }
    try {
      setCreatingKra(true);
      await api.post("/performance/kras", payload);
      toast.success("Question saved for the role");
      setKraForm({
        title: "",
        description: "",
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to save KRA");
    } finally {
      setCreatingKra(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Add KRAs</h2>
          <p className="text-sm text-muted-foreground">
            Add KRA questions by role. Employees in that role will answer them.
          </p>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Self-review window</h3>
            <p className="text-xs text-muted-foreground">
              Block employee edits outside this date range for all KRAs.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            {loadingWindow
              ? "Loading…"
              : kraWindow.openFrom || kraWindow.openTo
                ? `${kraWindow.openFrom || "—"} → ${kraWindow.openTo || "—"}`
                : "No window set"}
          </div>
        </div>
        <form
          onSubmit={saveKraWindow}
          className="grid gap-4 px-5 py-4 md:grid-cols-2"
        >
          <div className="space-y-1">
            <label className="text-sm font-medium">Opens on</label>
            <input
              type="date"
              className="w-full rounded-md border border-border bg-surface px-3 py-2"
              value={kraWindow.openFrom}
              onChange={(e) =>
                setKraWindow((prev) => ({ ...prev, openFrom: e.target.value }))
              }
              disabled={savingWindow}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Closes on</label>
            <input
              type="date"
              className="w-full rounded-md border border-border bg-surface px-3 py-2"
              value={kraWindow.openTo}
              onChange={(e) =>
                setKraWindow((prev) => ({ ...prev, openTo: e.target.value }))
              }
              disabled={savingWindow}
            />
          </div>
          <div className="flex justify-end gap-3 md:col-span-2">
            <button
              type="button"
              className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-60"
              onClick={clearKraWindow}
              disabled={savingWindow}
            >
              Clear window
            </button>
            <button
              type="submit"
              disabled={savingWindow}
              className="rounded-md bg-primary px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {savingWindow ? "Saving…" : "Save window"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-lg font-semibold">Add question for a role</h3>
          <p className="text-xs text-muted-foreground">
            All active employees in the role will get this question to answer.
          </p>
        </div>
        <form onSubmit={submitKra} className="space-y-4 px-5 py-4">
          <div className="space-y-1">
            <label className="text-sm font-medium required-label">Role</label>
            <select
              className="w-full rounded-md border border-border bg-surface px-3 py-2"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              disabled={allRoles}
            >
              {roles.map((r, idx) => (
                <option key={`${r.key}-${idx}`} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={allRoles}
                onChange={(e) => setAllRoles(e.target.checked)}
              />
              Apply to all roles
            </label>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium required-label">Title</label>
            <input
              className="w-full rounded-md border border-border bg-surface px-3 py-2"
              value={kraForm.title}
              onChange={(e) =>
                setKraForm((prev) => ({ ...prev, title: e.target.value }))
              }
              placeholder="e.g. Improve customer onboarding"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="w-full rounded-md border border-border bg-surface px-3 py-2"
              rows={3}
              value={kraForm.description}
              onChange={(e) =>
                setKraForm((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              placeholder="Add more context or success criteria"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={creatingKra}
              className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {creatingKra ? "Saving…" : "Save question"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
