import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

type Announcement = {
  _id: string;
  title: string;
  message: string;
  createdAt: string;
  expiresAt?: string | null;
};

const dtIsValid = (v?: string) => !v || !Number.isNaN(new Date(v).getTime());
const dtIsFuture = (v?: string) => !v || new Date(v).getTime() > Date.now();

const CreateSchema = z.object({
  title: z.string().min(3, "Min 3 chars").max(120, "Max 120 chars"),
  message: z.string().min(5, "Min 5 chars").max(5000, "Max 5000 chars"),
  expiresAt: z
    .string()
    .optional()
    .refine(dtIsValid, "Invalid date")
    .refine(dtIsFuture, "Must be in the future"),
});
type CreateInput = z.infer<typeof CreateSchema>;

const EditSchema = z.object({
  title: z.string().min(3, "Min 3 chars").max(120, "Max 120 chars"),
  message: z.string().min(5, "Min 5 chars").max(5000, "Max 5000 chars"),
  expiresAt: z
    .string()
    .optional()
    .refine(dtIsValid, "Invalid date")
    .refine(dtIsFuture, "Must be in the future"),
});
type EditInput = z.infer<typeof EditSchema>;

export default function AnnouncementsAdmin() {
  const [list, setList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateInput>({
    resolver: zodResolver(CreateSchema),
    defaultValues: { title: "", message: "", expiresAt: "" },
  });

  const {
    register: registerEdit,
    handleSubmit: handleSubmitEdit,
    reset: resetEdit,
    formState: { errors: editErrors },
  } = useForm<EditInput>({
    resolver: zodResolver(EditSchema),
    defaultValues: { title: "", message: "", expiresAt: "" },
  });

  async function load() {
    try {
      setError(null);
      setLoading(true);
      const res = await api.get("/announcements");
      setList(res.data.announcements || []);
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to load announcements";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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

  async function onCreate(data: CreateInput) {
    try {
      await api.post("/announcements", {
        title: data.title.trim(),
        message: data.message.trim(),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      });
      reset();
      await load();
      toast.success("Announcement posted");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to create announcement";
      setError(msg);
      toast.error(msg);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this announcement?")) return;
    try {
      await api.delete(`/announcements/${id}`);
      await load();
      toast.success("Deleted");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to delete announcement";
      setError(msg);
      toast.error(msg);
    }
  }

  function startEdit(a: Announcement) {
    setEditingId(a._id);
    resetEdit({
      title: a.title,
      message: a.message,
      expiresAt: a.expiresAt ? toInputDateTimeLocal(a.expiresAt) : "",
    });
  }

  async function onSaveEdit(data: EditInput) {
    if (!editingId) return;
    try {
      setSavingEdit(true);
      await api.put(`/announcements/${editingId}`, {
        title: data.title.trim(),
        message: data.message.trim(),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      });
      setEditingId(null);
      await load();
      toast.success("Saved");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update announcement";
      setError(msg);
      toast.error(msg);
    } finally {
      setSavingEdit(false);
    }
  }

  const active = useMemo(() => list, [list]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Announcements</h2>

      <form
        onSubmit={handleSubmit(onCreate)}
        className="space-y-3 p-4 border border-border rounded-md bg-surface"
      >
        <div>
          <label className="block text-sm font-medium mb-1">Title</label>
          <input
            className="w-full h-10 px-3 rounded-md border border-border bg-bg"
            placeholder="Company update…"
            {...register("title")}
          />
          {errors.title && (
            <div className="text-error text-xs mt-1">
              {errors.title.message}
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Message</label>
          <textarea
            className="w-full min-h-[120px] p-3 rounded-md border border-border bg-bg"
            placeholder="Details for all employees"
            {...register("message")}
          />
          {errors.message && (
            <div className="text-error text-xs mt-1">
              {errors.message.message}
            </div>
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
          />
          {errors.expiresAt && (
            <div className="text-error text-xs mt-1">
              {errors.expiresAt.message as string}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            disabled={isSubmitting}
            className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-white disabled:opacity-60"
          >
            {isSubmitting ? "Posting…" : "Post Announcement"}
          </button>
          {error && <div className="text-error text-sm">{error}</div>}
        </div>
      </form>

      <div className="space-y-3">
        <h3 className="text-xl font-semibold">Active Announcements</h3>
        {loading ? (
          <div className="text-muted">Loading…</div>
        ) : active.length === 0 ? (
          <div className="text-muted">No announcements</div>
        ) : (
          <ul className="space-y-3">
            {active.map((a) => (
              <li
                key={a._id}
                className="p-4 border border-border rounded-md bg-surface"
              >
                {editingId === a._id ? (
                  <form
                    onSubmit={handleSubmitEdit(onSaveEdit)}
                    className="space-y-3"
                  >
                    <div className="grid gap-3">
                      <div>
                        <label className="block text-xs mb-1">Title</label>
                        <input
                          className="w-full h-9 rounded border border-border bg-bg px-2 text-sm"
                          {...registerEdit("title")}
                        />
                        {editErrors.title && (
                          <div className="text-error text-xs mt-1">
                            {editErrors.title.message}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs mb-1">Message</label>
                        <textarea
                          className="w-full rounded border border-border bg-bg px-2 py-2 text-sm min-h-24"
                          {...registerEdit("message")}
                        />
                        {editErrors.message && (
                          <div className="text-error text-xs mt-1">
                            {editErrors.message.message}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs mb-1">Expires At</label>
                        <input
                          type="datetime-local"
                          className="h-9 rounded border border-border bg-bg px-2 text-sm"
                          {...registerEdit("expiresAt")}
                        />
                        {editErrors.expiresAt && (
                          <div className="text-error text-xs mt-1">
                            {editErrors.expiresAt.message as string}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={savingEdit}
                        className="h-9 px-4 rounded-md bg-primary text-white text-sm disabled:opacity-60"
                      >
                        {savingEdit ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="h-9 px-4 rounded-md border border-border text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
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
