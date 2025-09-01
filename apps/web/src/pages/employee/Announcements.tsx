import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { getEmployee } from "../../lib/auth";

type Announcement = {
  _id: string;
  title: string;
  message: string;
  createdAt: string;
  expiresAt?: string | null;
};

export default function Announcements() {
  const [list, setList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const u = getEmployee();
  const canManage =
    !!u && (u.primaryRole === "ADMIN" || u.primaryRole === "SUPERADMIN" || (u.subRoles || []).includes("hr"));

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await api.get("/announcements");
        setList(res.data.announcements || []);
      } catch (e: any) {
        setError(e?.response?.data?.error || "Failed to load announcements");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    if (!title.trim() || !message.trim()) return;
    try {
      setSaving(true);
      await api.post("/announcements", {
        title: title.trim(),
        message: message.trim(),
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      });
      setTitle("");
      setMessage("");
      setExpiresAt("");
      const res = await api.get("/announcements");
      setList(res.data.announcements || []);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to create announcement");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h2 className="text-2xl font-bold">Announcements</h2>
      {canManage && (
        <form onSubmit={create} className="space-y-3 p-4 border border-border rounded-md bg-surface">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              className="w-full h-10 px-3 rounded-md border border-border bg-bg"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Company update…"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Message</label>
            <textarea
              className="w-full min-h-[120px] p-3 rounded-md border border-border bg-bg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              placeholder="Details for all employees"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Expires At (optional)</label>
            <input
              type="datetime-local"
              className="h-10 px-3 rounded-md border border-border bg-bg"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              disabled={saving}
              className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-white disabled:opacity-60"
            >
              {saving ? "Posting…" : "Post Announcement"}
            </button>
            {error && <div className="text-error text-sm">{error}</div>}
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-muted">Loading…</div>
      ) : error ? (
        <div className="text-error">{error}</div>
      ) : list.length === 0 ? (
        <div className="text-muted">No announcements</div>
      ) : (
        <ul className="space-y-3">
          {list.map((a) => (
            <li key={a._id} className="p-4 border border-border rounded-md bg-surface">
              <div className="font-semibold">{a.title}</div>
              <div className="text-sm text-muted">
                {new Date(a.createdAt).toLocaleString()}
                {a.expiresAt ? ` • Expires ${new Date(a.expiresAt).toLocaleString()}` : ""}
              </div>
              <div className="mt-2 whitespace-pre-wrap">{a.message}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
