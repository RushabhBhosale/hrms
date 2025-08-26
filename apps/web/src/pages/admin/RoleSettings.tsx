import { useState, useEffect, FormEvent } from "react";
import { api } from "../../lib/api";

export default function RoleSettings() {
  const [roles, setRoles] = useState<string[]>([]);
  const [newRole, setNewRole] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/roles");
        setRoles(res.data.roles || []);
      } catch {
        // ignore
      }
    })();
  }, []);

  async function addRole(e: FormEvent) {
    e.preventDefault();
    if (!newRole.trim()) return;
    try {
      setSubmitting(true);
      setErr(null);
      const res = await api.post("/companies/roles", { role: newRole.trim() });
      setRoles(res.data.roles || []);
      setNewRole("");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to add role");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveRole(e: FormEvent) {
    e.preventDefault();
    if (!editing || !editValue.trim()) return;
    try {
      setEditSubmitting(true);
      setErr(null);
      const res = await api.put(
        `/companies/roles/${encodeURIComponent(editing)}`,
        { newRole: editValue.trim() }
      );
      setRoles(res.data.roles || []);
      setEditing(null);
      setEditValue("");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to update role");
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Roles</h2>
        <p className="text-sm text-muted">Manage employee roles.</p>
      </div>
      {err && (
        <div className="rounded-md border border-error/20 bg-red-50 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Add Role</h3>
        </div>
        <form onSubmit={addRole} className="px-6 py-5 flex gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            placeholder="e.g. designer"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-50"
          >
            {submitting ? "Adding…" : "Add"}
          </button>
        </form>
        <div className="px-6 pb-5">
          <ul className="list-disc pl-6 space-y-1">
            {roles.length === 0 && (
              <li className="list-none text-sm text-muted">No roles added.</li>
            )}
            {roles.map((r) => (
              <li key={r} className="flex items-center gap-2">
                {editing === r ? (
                  <form onSubmit={saveRole} className="flex items-center gap-2">
                    <input
                      className="rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={editSubmitting}
                      className="text-sm text-primary disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        setEditValue("");
                      }}
                      className="text-sm text-muted"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <span>{r}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(r);
                        setEditValue(r);
                      }}
                      className="text-sm text-primary underline"
                    >
                      Edit
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
