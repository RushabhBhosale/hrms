import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Announcement = {
  _id: string;
  title: string;
  message: string;
  createdAt: string;
  expiresAt?: string | null;
};

export default function AnnouncementsAdmin() {
  const [list, setList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  async function load() {
    try {
      setError(null);
      setLoading(true);
      const res = await api.get("/announcements");
      setList(res.data.announcements || []);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load announcements");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
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
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to create announcement");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this announcement?")) return;
    try {
      await api.delete(`/announcements/${id}`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to delete announcement");
    }
  }

  function startEdit(a: Announcement) {
    setEditingId(a._id);
    setEditTitle(a.title);
    setEditMessage(a.message);
    setEditExpiresAt(a.expiresAt ? toInputDateTimeLocal(a.expiresAt) : '');
  }

  function toInputDateTimeLocal(s?: string | null) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  async function saveEdit() {
    if (!editingId) return;
    try {
      setSavingEdit(true);
      await api.put(`/announcements/${editingId}`, {
        title: editTitle.trim(),
        message: editMessage.trim(),
        expiresAt: editExpiresAt ? new Date(editExpiresAt) : null,
      });
      setEditingId(null);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to update announcement');
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
        <h2 className="text-2xl font-bold">Announcements</h2>

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

        <div className="space-y-3">
          <h3 className="text-xl font-semibold">Active Announcements</h3>
          {loading ? (
            <div className="text-muted">Loading…</div>
          ) : list.length === 0 ? (
            <div className="text-muted">No announcements</div>
          ) : (
            <ul className="space-y-3">
              {list.map((a) => (
                <li key={a._id} className="p-4 border border-border rounded-md bg-surface">
                  {editingId === a._id ? (
                    <div className="space-y-3">
                      <div className="grid gap-3">
                        <div>
                          <label className="block text-xs mb-1">Title</label>
                          <input className="w-full h-9 rounded border border-border bg-bg px-2 text-sm" value={editTitle} onChange={(e)=>setEditTitle(e.target.value)} />
                        </div>
                        <div>
                          <label className="block text-xs mb-1">Message</label>
                          <textarea className="w-full rounded border border-border bg-bg px-2 py-2 text-sm min-h-24" value={editMessage} onChange={(e)=>setEditMessage(e.target.value)} />
                        </div>
                        <div>
                          <label className="block text-xs mb-1">Expires At</label>
                          <input type="datetime-local" className="h-9 rounded border border-border bg-bg px-2 text-sm" value={editExpiresAt} onChange={(e)=>setEditExpiresAt(e.target.value)} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={saveEdit} disabled={savingEdit} className="h-9 px-4 rounded-md bg-primary text-white text-sm disabled:opacity-60">{savingEdit?'Saving…':'Save'}</button>
                        <button onClick={()=>setEditingId(null)} className="h-9 px-4 rounded-md border border-border text-sm">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">{a.title}</div>
                          <div className="text-sm text-muted">
                            {new Date(a.createdAt).toLocaleString()}
                            {a.expiresAt ? ` • Expires ${new Date(a.expiresAt).toLocaleString()}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => startEdit(a)} className="text-sm underline">Edit</button>
                          <button
                            onClick={() => remove(a._id)}
                            className="text-error hover:underline text-sm"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap">{a.message}</div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
}
