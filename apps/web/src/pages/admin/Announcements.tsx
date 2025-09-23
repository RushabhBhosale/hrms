import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";
import {
  AnnouncementFormValues,
  announcementFormSchema,
} from "../../schemas/announcement";

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
  const [listError, setListError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const form = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementFormSchema),
    defaultValues: {
      title: "",
      message: "",
      expiresAt: "",
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    setError: setFormError,
    formState: { errors, isSubmitting },
  } = form;

  async function load() {
    try {
      setListError(null);
      setLoading(true);
      const res = await api.get("/announcements");
      setList(res.data.announcements || []);
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to load announcements";
      setListError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const create = handleSubmit(async (values: AnnouncementFormValues) => {
    try {
      await api.post("/announcements", {
        title: values.title.trim(),
        message: values.message.trim(),
        expiresAt: values.expiresAt ? new Date(values.expiresAt) : undefined,
      });
      reset();
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to create announcement";
      setFormError("root", { type: "server", message: msg });
      toast.error(msg);
    }
  });

  async function remove(id: string) {
    if (!confirm("Delete this announcement?")) return;
    try {
      await api.delete(`/announcements/${id}`);
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to delete announcement";
      setListError(msg);
      toast.error(msg);
    }
  }

  function startEdit(a: Announcement) {
    setEditingId(a._id);
    setEditTitle(a.title);
    setEditMessage(a.message);
    setEditExpiresAt(a.expiresAt ? toInputDateTimeLocal(a.expiresAt) : "");
  }

  function toInputDateTimeLocal(s?: string | null) {
    if (!s) return "";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
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
      const msg = e?.response?.data?.error || "Failed to update announcement";
      setListError(msg);
      toast.error(msg);
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Announcements</h2>

      <form
        onSubmit={create}
        className="space-y-3 p-4 border border-border rounded-md bg-surface"
      >
        <div>
          <label className="block text-sm font-medium mb-1">Title</label>
          <input
            className="w-full h-10 px-3 rounded-md border border-border bg-bg"
            placeholder="Company update…"
            {...register("title")}
            aria-invalid={errors.title ? "true" : undefined}
          />
          {errors.title?.message && (
            <p className="text-sm text-error mt-1" role="alert">
              {errors.title.message}
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Message</label>
          <textarea
            className="w-full min-h-[120px] p-3 rounded-md border border-border bg-bg"
            placeholder="Details for all employees"
            {...register("message")}
            aria-invalid={errors.message ? "true" : undefined}
          />
          {errors.message?.message && (
            <p className="text-sm text-error mt-1" role="alert">
              {errors.message.message}
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Expires At (optional)
          </label>
          <input
            type="datetime-local"
            className="h-10 px-3 rounded-md border border-border bg-bg"
            {...register("expiresAt")}
            aria-invalid={errors.expiresAt ? "true" : undefined}
          />
          {errors.expiresAt?.message && (
            <p className="text-sm text-error mt-1" role="alert">
              {errors.expiresAt.message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            disabled={isSubmitting}
            className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-white disabled:opacity-60"
          >
            {isSubmitting ? "Posting…" : "Post Announcement"}
          </button>
          {errors.root?.message && (
            <div className="text-error text-sm" role="alert">
              {errors.root.message}
            </div>
          )}
        </div>
      </form>

      <div className="space-y-3">
        <h3 className="text-xl font-semibold">Active Announcements</h3>
        {loading ? (
          <div className="text-muted">Loading…</div>
        ) : listError ? (
          <div className="text-error">{listError}</div>
        ) : list.length === 0 ? (
          <div className="text-muted">No announcements</div>
        ) : (
          <ul className="space-y-3">
            {list.map((a) => (
              <li
                key={a._id}
                className="p-4 border border-border rounded-md bg-surface"
              >
                {editingId === a._id ? (
                  <div className="space-y-3">
                    <div className="grid gap-3">
                      <div>
                        <label className="block text-xs mb-1">Title</label>
                        <input
                          className="w-full h-9 rounded border border-border bg-bg px-2 text-sm"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs mb-1">Message</label>
                        <textarea
                          className="w-full rounded border border-border bg-bg px-2 py-2 text-sm min-h-24"
                          value={editMessage}
                          onChange={(e) => setEditMessage(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs mb-1">Expires At</label>
                        <input
                          type="datetime-local"
                          className="h-9 rounded border border-border bg-bg px-2 text-sm"
                          value={editExpiresAt}
                          onChange={(e) => setEditExpiresAt(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={saveEdit}
                        disabled={savingEdit}
                        className="h-9 px-4 rounded-md bg-primary text-white text-sm disabled:opacity-60"
                      >
                        {savingEdit ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="h-9 px-4 rounded-md border border-border text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{a.title}</div>
                        <div className="text-sm text-muted">
                          {new Date(a.createdAt).toLocaleString()}
                          {a.expiresAt
                            ? ` • Expires ${new Date(
                                a.expiresAt
                              ).toLocaleString()}`
                            : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
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
