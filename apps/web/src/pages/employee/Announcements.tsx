import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";
import { getEmployee } from "../../lib/auth";
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

export default function Announcements() {
  const [list, setList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const u = getEmployee();
  const canManage =
    !!u &&
    (u.primaryRole === "ADMIN" ||
      u.primaryRole === "SUPERADMIN" ||
      (u.subRoles || []).includes("hr"));

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

  useEffect(() => {
    (async () => {
      try {
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
    })();
  }, []);

  const create = handleSubmit(async (values: AnnouncementFormValues) => {
    if (!canManage) return;
    try {
      await api.post("/announcements", {
        title: values.title.trim(),
        message: values.message.trim(),
        expiresAt: values.expiresAt ? new Date(values.expiresAt) : undefined,
      });
      reset();
      const res = await api.get("/announcements");
      setList(res.data.announcements || []);
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to create announcement";
      setFormError("root", { type: "server", message: msg });
      setError(msg);
      toast.error(msg);
    }
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h2 className="text-2xl font-bold">Announcements</h2>
      {canManage && (
        <form
          onSubmit={create}
          className="space-y-3 p-4 border border-border rounded-md bg-surface"
        >
          <div>
            <label className="block text-sm font-medium mb-1 required-label">
              Title
            </label>
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
            <label className="block text-sm font-medium mb-1 required-label">
              Message
            </label>
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
            <li
              key={a._id}
              className="p-4 border border-border rounded-md bg-surface"
            >
              <div className="font-semibold">{a.title}</div>
              <div className="text-sm text-muted">
                {new Date(a.createdAt).toLocaleString()}
                {a.expiresAt
                  ? ` • Expires ${new Date(a.expiresAt).toLocaleString()}`
                  : ""}
              </div>
              <div className="mt-2 whitespace-pre-wrap">{a.message}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
