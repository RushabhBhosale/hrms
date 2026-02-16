import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../../lib/api";
import type {
  RoleDefinition,
  RoleModuleDefinition,
  RolePermissionMap,
} from "../../types/roles";

function buildPermissionMap(
  modules: RoleModuleDefinition[],
  base?: RolePermissionMap,
): RolePermissionMap {
  const result: RolePermissionMap = {};
  modules.forEach((module) => {
    const current = base?.[module.key] || {};
    result[module.key] = {};
    module.actions.forEach((action) => {
      result[module.key][action.key] = !!current[action.key];
    });
  });
  return result;
}

function updatePermission(
  state: RolePermissionMap,
  moduleKey: string,
  actionKey: string,
  next: boolean,
): RolePermissionMap {
  return {
    ...state,
    [moduleKey]: {
      ...(state[moduleKey] || {}),
      [actionKey]: next,
    },
  };
}

export default function AddRole() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<RoleModuleDefinition[]>([]);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<RolePermissionMap>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setFetchErr(null);
        setLoading(true);
        const res = await api.get("/companies/roles");
        const moduleDefs: RoleModuleDefinition[] = res.data.modules || [];
        setModules(moduleDefs);
        setPermissions((prev) => buildPermissionMap(moduleDefs, prev));
      } catch (e: any) {
        setFetchErr(e?.response?.data?.error || "Failed to load modules");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const canSubmit = useMemo(
    () => !!label.trim() && !saving && !loading,
    [label, saving, loading],
  );

  function togglePermission(
    moduleKey: string,
    actionKey: string,
    next: boolean,
  ) {
    setPermissions((prev) =>
      updatePermission(prev, moduleKey, actionKey, next),
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      setErr("Enter a role label");
      return;
    }
    try {
      setSaving(true);
      setErr(null);
      await api.post("/companies/roles", {
        label: label.trim(),
        description: description.trim() || undefined,
        permissions,
      });
      toast.success("Role created");
      navigate("/admin/roles", { replace: true });
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to add role");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Add Role</h2>
          <p className="text-sm text-muted-foreground">
            Create a new base role and choose which modules it can access.
          </p>
        </div>
        <Link
          to="/admin/roles"
          className="rounded-md border border-border px-3 py-2 text-sm"
        >
          Back to Roles
        </Link>
      </div>

      {fetchErr && (
        <div className="rounded-md border border-error/30 bg-error/10 px-4 py-2 text-sm text-error">
          {fetchErr}
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium required-label">
              <span>Role label</span>
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. Designer"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={loading || saving}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              <span>Description (optional)</span>
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="What responsibilities does this role cover?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading || saving}
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">Permissions</div>
            {loading ? (
              <div className="text-sm text-muted-foreground">
                Loading modules…
              </div>
            ) : (
              <div className="space-y-3">
                {modules.map((module) => (
                  <div
                    key={module.key}
                    className="rounded-md border border-border bg-bg px-4 py-3"
                  >
                    <div className="font-medium">{module.label}</div>
                    {module.description && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {module.description}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-4">
                      {module.actions.map((action) => (
                        <label
                          key={action.key}
                          className="inline-flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border"
                            checked={!!permissions?.[module.key]?.[action.key]}
                            onChange={(e) =>
                              togglePermission(
                                module.key,
                                action.key,
                                e.target.checked,
                              )
                            }
                            disabled={saving}
                          />
                          <span>{action.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {err && (
            <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
              {err}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Create role"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
