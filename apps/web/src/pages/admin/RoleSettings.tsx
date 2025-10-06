import { FormEvent, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api } from "../../lib/api";
import type {
  RoleDefinition,
  RoleModuleDefinition,
  RolePermissionMap,
} from "../../types/roles";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildPermissionMap(
  modules: RoleModuleDefinition[],
  base?: RolePermissionMap
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
  next: boolean
): RolePermissionMap {
  return {
    ...state,
    [moduleKey]: {
      ...(state[moduleKey] || {}),
      [actionKey]: next,
    },
  };
}

function PermissionMatrix({
  modules,
  value,
  onToggle,
  disabled,
}: {
  modules: RoleModuleDefinition[];
  value: RolePermissionMap;
  onToggle: (moduleKey: string, actionKey: string, next: boolean) => void;
  disabled?: boolean;
}) {
  if (!modules.length) {
    return (
      <div className="rounded-md border border-border bg-muted/20 px-4 py-3 text-sm text-muted">
        No modules configured yet. Contact support to configure module catalog.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {modules.map((module) => (
        <div
          key={module.key}
          className="rounded-md border border-border bg-bg px-4 py-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">{module.label}</div>
              {module.description && (
                <div className="text-xs text-muted mt-1">{module.description}</div>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {module.actions.map((action) => (
              <label
                key={action.key}
                className="inline-flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={!!value?.[module.key]?.[action.key]}
                  onChange={(e) => onToggle(module.key, action.key, e.target.checked)}
                  disabled={disabled}
                />
                <span>{action.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RoleSettings() {
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [modules, setModules] = useState<RoleModuleDefinition[]>([]);

  const [newRoleForm, setNewRoleForm] = useState({
    label: "",
    description: "",
    permissions: {} as RolePermissionMap,
  });
  const [addErr, setAddErr] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const [selectedRoleName, setSelectedRoleName] = useState<string | null>(null);
  const selectedRole = useMemo(
    () => roles.find((role) => role.name === selectedRoleName) || null,
    [roles, selectedRoleName]
  );

  const [editForm, setEditForm] = useState({
    identifier: "",
    label: "",
    description: "",
    permissions: {} as RolePermissionMap,
    allowRename: true,
  });
  const [editErr, setEditErr] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  async function fetchRoles() {
    try {
      setLoading(true);
      setFetchErr(null);
      const res = await api.get("/companies/roles");
      const roleDefs: RoleDefinition[] = res.data.roles || [];
      const moduleDefs: RoleModuleDefinition[] = res.data.modules || [];
      setRoles(roleDefs);
      setModules(moduleDefs);
      if (!selectedRoleName && roleDefs.length) {
        setSelectedRoleName(roleDefs[0].name);
      }
    } catch (e: any) {
      setFetchErr(e?.response?.data?.error || "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRoles();
  }, []);

  useEffect(() => {
    setNewRoleForm((prev) => ({
      ...prev,
      permissions: buildPermissionMap(modules, prev.permissions),
    }));
  }, [modules]);

  useEffect(() => {
    if (!selectedRole) return;
    setEditForm({
      identifier: selectedRole.name,
      label: selectedRole.label,
      description: selectedRole.description || "",
      permissions: buildPermissionMap(modules, selectedRole.modules),
      allowRename: selectedRole.allowRename,
    });
  }, [modules, selectedRole]);

  async function handleAddRole(e: FormEvent) {
    e.preventDefault();
    const trimmedLabel = newRoleForm.label.trim();
    if (!trimmedLabel) {
      setAddErr("Enter a role label");
      return;
    }
    try {
      setAddSaving(true);
      setAddErr(null);
      const payload = {
        label: trimmedLabel,
        description: newRoleForm.description.trim() || undefined,
        permissions: newRoleForm.permissions,
      };
      const res = await api.post("/companies/roles", payload);
      const updated: RoleDefinition[] = res.data.roles || [];
      setRoles(updated);
      const slug = slugify(trimmedLabel);
      const created =
        updated.find((role) => role.name === slug) || updated[updated.length - 1];
      if (created) {
        setSelectedRoleName(created.name);
      }
      toast.success("Role created");
      setNewRoleForm({
        label: "",
        description: "",
        permissions: buildPermissionMap(modules),
      });
    } catch (e: any) {
      setAddErr(e?.response?.data?.error || "Failed to add role");
    } finally {
      setAddSaving(false);
    }
  }

  async function handleUpdateRole(e: FormEvent) {
    e.preventDefault();
    if (!selectedRole) return;
    const trimmedLabel = editForm.label.trim();
    if (!trimmedLabel) {
      setEditErr("Role label cannot be blank");
      return;
    }
    const payload: Record<string, unknown> = {
      label: trimmedLabel,
      description: editForm.description.trim(),
      permissions: editForm.permissions,
    };
    const trimmedIdentifier = editForm.identifier.trim();
    if (
      selectedRole.allowRename &&
      trimmedIdentifier &&
      trimmedIdentifier !== selectedRole.name
    ) {
      const slug = slugify(trimmedIdentifier);
      if (!slug) {
        setEditErr("Identifier must contain letters or numbers");
        return;
      }
      payload.newRole = slug;
    }

    try {
      setEditSaving(true);
      setEditErr(null);
      const res = await api.put(
        `/companies/roles/${encodeURIComponent(selectedRole.name)}`,
        payload
      );
      const updated: RoleDefinition[] = res.data.roles || [];
      setRoles(updated);
      const nextKey =
        (payload.newRole as string | undefined) || selectedRole.name;
      setSelectedRoleName(nextKey);
      toast.success("Role updated");
    } catch (e: any) {
      setEditErr(e?.response?.data?.error || "Failed to update role");
    } finally {
      setEditSaving(false);
    }
  }

  function toggleNewRolePermission(
    moduleKey: string,
    actionKey: string,
    next: boolean
  ) {
    setNewRoleForm((prev) => ({
      ...prev,
      permissions: updatePermission(prev.permissions, moduleKey, actionKey, next),
    }));
  }

  function toggleEditPermission(
    moduleKey: string,
    actionKey: string,
    next: boolean
  ) {
    setEditForm((prev) => ({
      ...prev,
      permissions: updatePermission(prev.permissions, moduleKey, actionKey, next),
    }));
  }

  const selectedRoleMeta = useMemo(
    () => roles.find((role) => role.name === selectedRoleName) || null,
    [roles, selectedRoleName]
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Roles & Permissions</h2>
        <p className="text-sm text-muted">
          Configure role labels and fine-grained module access for your team.
        </p>
      </div>

      {fetchErr && (
        <div className="rounded-md border border-error/30 bg-error/10 px-4 py-2 text-sm text-error">
          {fetchErr}
        </div>
      )}

      {loading ? (
        <div className="rounded-md border border-border bg-surface px-6 py-8 text-sm text-muted">
          Loading roles…
        </div>
      ) : (
        <>
          <section className="rounded-lg border border-border bg-surface shadow-sm">
            <div className="border-b border-border px-6 py-4">
              <h3 className="text-lg font-semibold">Add Role</h3>
              <p className="text-xs text-muted">
                Create a new base role and choose which modules it can read or update.
              </p>
            </div>
            <form onSubmit={handleAddRole} className="px-6 py-5 space-y-4">
              {addErr && (
                <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
                  {addErr}
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium required-label" htmlFor="new-role-label">
                    Role label
                  </label>
                  <input
                    id="new-role-label"
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g. Designer"
                    value={newRoleForm.label}
                    onChange={(e) =>
                      setNewRoleForm((prev) => ({
                        ...prev,
                        label: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="new-role-description">
                    Description (optional)
                  </label>
                  <input
                    id="new-role-description"
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                    placeholder="What responsibilities does this role cover?"
                    value={newRoleForm.description}
                    onChange={(e) =>
                      setNewRoleForm((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <PermissionMatrix
                modules={modules}
                value={newRoleForm.permissions}
                onToggle={toggleNewRolePermission}
              />

              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  disabled={addSaving}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
                >
                  {addSaving ? "Saving…" : "Create role"}
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-lg border border-border bg-surface shadow-sm">
            <div className="border-b border-border px-6 py-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Manage Roles</h3>
                <p className="text-xs text-muted">
                  Select a role to rename it or adjust module access.
                </p>
              </div>
            </div>
            <div className="grid gap-6 px-6 py-5 lg:grid-cols-[220px_1fr]">
              <div className="space-y-2">
                {roles.length === 0 ? (
                  <div className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-sm text-muted">
                    No roles yet.
                  </div>
                ) : (
                  roles.map((role) => (
                    <button
                      key={role.name}
                      type="button"
                      onClick={() => setSelectedRoleName(role.name)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                        role.name === selectedRoleName
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-bg hover:border-primary/50"
                      }`}
                    >
                      <div className="font-medium flex items-center justify-between">
                        <span>{role.label}</span>
                        {role.system && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted mt-1">{role.name}</div>
                    </button>
                  ))
                )}
              </div>

              {selectedRole && (
                <form
                  onSubmit={handleUpdateRole}
                  className="space-y-4"
                  key={selectedRole.name}
                >
                  {editErr && (
                    <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
                      {editErr}
                    </div>
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-sm font-medium required-label" htmlFor="edit-role-label">
                        Role label
                      </label>
                      <input
                        id="edit-role-label"
                        className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                        value={editForm.label}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            label: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium" htmlFor="edit-role-identifier">
                        Identifier
                      </label>
                      <input
                        id="edit-role-identifier"
                        className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary disabled:bg-muted/40"
                        value={editForm.identifier}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            identifier: e.target.value,
                          }))
                        }
                        disabled={!editForm.allowRename}
                      />
                      <p className="text-xs text-muted">
                        Used internally when assigning roles. {" "}
                        {editForm.allowRename
                          ? "Letters and numbers only."
                          : "Protected role identifiers cannot be changed."}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="edit-role-description">
                      Description
                    </label>
                    <textarea
                      id="edit-role-description"
                      rows={3}
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <PermissionMatrix
                    modules={modules}
                    value={editForm.permissions}
                    onToggle={toggleEditPermission}
                  />

                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="submit"
                      disabled={editSaving}
                      className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
                    >
                      {editSaving ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
