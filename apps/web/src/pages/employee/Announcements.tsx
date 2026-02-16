import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "../../lib/api";
import { Input } from "../../components/ui/input";
import { resolveMediaUrl } from "../../lib/utils";
import { toast } from "react-hot-toast";
import { getEmployee, hasPermission } from "../../lib/auth";
import { CalendarDays, Clock3, Eye, Pencil, Trash2, X } from "lucide-react";
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
  createdBy?: string | { _id?: string; id?: string } | null;
  images?: string[];
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function toInputDateTimeLocal(value?: string | Date | null) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function defaultExpiresAtValue() {
  return toInputDateTimeLocal(new Date(Date.now() + ONE_DAY_MS));
}

function formatDateTime(value?: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeImageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}

function resolveCreatorId(value: Announcement["createdBy"]): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") return value.id || value._id || null;
  return null;
}

function AnnouncementPreviewModal({
  announcement,
  onClose,
}: {
  announcement: Announcement | null;
  onClose: () => void;
}) {
  if (!announcement) return null;
  const images = normalizeImageList(announcement.images);
  const postedAt = formatDateTime(announcement.createdAt);
  const expiresAt = formatDateTime(announcement.expiresAt);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Announcement preview"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border bg-gradient-to-r from-primary/15 via-primary/5 to-transparent px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Announcement Preview
            </p>
            <h3 className="mt-1 text-lg font-semibold leading-snug">
              {announcement.title || "Announcement"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-bg hover:text-foreground"
            aria-label="Close preview"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Posted: {postedAt || "-"}</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />
              <span>Expires: {expiresAt || "No expiry"}</span>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-bg p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {announcement.message}
            </p>
          </div>

          {images.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-sm font-medium">Images</div>
              <div className="grid grid-cols-2 gap-3">
                {images.map((img, idx) => {
                  const src = resolveMediaUrl(img);
                  if (!src) return null;
                  return (
                    <a
                      key={`${img}-${idx}`}
                      href={src}
                      target="_blank"
                      rel="noreferrer"
                      className={`block overflow-hidden rounded-lg border border-border bg-bg ${
                        idx === 0 && images.length > 2 ? "sm:col-span-2" : ""
                      }`}
                    >
                      <img
                        src={src}
                        alt={`announcement-${idx + 1}`}
                        className={`w-full object-cover transition hover:scale-[1.02] ${
                          idx === 0 && images.length > 2 ? "h-44" : "h-32"
                        }`}
                      />
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-border bg-bg/60 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm hover:bg-bg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Announcements() {
  const [list, setList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [retainImages, setRetainImages] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [previewAnnouncement, setPreviewAnnouncement] =
    useState<Announcement | null>(null);
  const u = getEmployee();
  const canManage = hasPermission(u, "announcements", "write");
  const isAdmin =
    u?.primaryRole === "ADMIN" || u?.primaryRole === "SUPERADMIN";

  const selectedImagePreviews = useMemo(
    () =>
      imageFiles.map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
      })),
    [imageFiles]
  );

  useEffect(() => {
    return () => {
      selectedImagePreviews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [selectedImagePreviews]);

  const {
    register,
    handleSubmit,
    reset,
    setError: setFormError,
    formState: { errors, isSubmitting },
  } = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementFormSchema),
    defaultValues: {
      title: "",
      message: "",
      expiresAt: defaultExpiresAtValue(),
    },
  });

  function canEditAnnouncement(a: Announcement) {
    if (!u?.id) return false;
    if (isAdmin) return true;
    const creatorId = resolveCreatorId(a.createdBy);
    return !!creatorId && String(creatorId) === String(u.id);
  }

  function canDeleteAnnouncement(a: Announcement) {
    return canEditAnnouncement(a);
  }

  function resetFormToCreate() {
    setEditingId(null);
    setImageFiles([]);
    setRetainImages([]);
    reset({
      title: "",
      message: "",
      expiresAt: defaultExpiresAtValue(),
    });
  }

  async function loadAnnouncements() {
    try {
      setLoading(true);
      const res = await api.get("/announcements");
      setList(res.data.announcements || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadAnnouncements();
      } catch (e: any) {
        const msg = e?.response?.data?.error || "Failed to load announcements";
        setError(msg);
        toast.error(msg);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEdit(a: Announcement) {
    setEditingId(a._id);
    setRetainImages(normalizeImageList(a.images));
    setImageFiles([]);
    reset({
      title: a.title || "",
      message: a.message || "",
      expiresAt: a.expiresAt ? toInputDateTimeLocal(a.expiresAt) : "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function removeSelectedImage(index: number) {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function removeRetainedImage(image: string) {
    setRetainImages((prev) => prev.filter((img) => img !== image));
  }

  const submit = handleSubmit(async (values: AnnouncementFormValues) => {
    if (!canManage) return;
    try {
      const formData = new FormData();
      formData.append("title", values.title.trim());
      formData.append("message", values.message.trim());
      formData.append(
        "expiresAt",
        values.expiresAt ? new Date(values.expiresAt).toISOString() : ""
      );
      imageFiles.forEach((file) => formData.append("images", file));

      if (editingId) {
        formData.append("retainImages", JSON.stringify(retainImages));
        await api.put(`/announcements/${editingId}`, formData);
        toast.success("Announcement updated");
      } else {
        await api.post("/announcements", formData);
        toast.success("Announcement posted");
      }

      resetFormToCreate();
      await loadAnnouncements();
    } catch (e: any) {
      const msg = editingId
        ? e?.response?.data?.error || "Failed to update announcement"
        : e?.response?.data?.error || "Failed to create announcement";
      if (!editingId) {
        setFormError("root", { type: "server", message: msg });
      }
      setError(msg);
      toast.error(msg);
    }
  });

  async function remove(id: string) {
    if (!confirm("Delete this announcement?")) return;
    try {
      await api.delete(`/announcements/${id}`);
      if (editingId === id) resetFormToCreate();
      await loadAnnouncements();
      toast.success("Deleted");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to delete announcement";
      setError(msg);
      toast.error(msg);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h2 className="text-2xl font-bold">Announcements</h2>
      {canManage && (
        <form
          onSubmit={submit}
          className="space-y-3 rounded-md border border-border bg-surface p-4"
        >
          <div>
            <label className="mb-1 block text-sm font-medium required-label">
              Announcement Title
            </label>
            <input
              className="h-10 w-full rounded-md border border-border bg-bg px-3"
              placeholder="Company update…"
              {...register("title")}
              aria-invalid={errors.title ? "true" : undefined}
            />
            {errors.title?.message && (
              <p className="mt-1 text-sm text-error" role="alert">
                {errors.title.message}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium required-label">
              Message
            </label>
            <textarea
              className="min-h-[120px] w-full rounded-md border border-border bg-bg p-3"
              placeholder="Details for all employees"
              {...register("message")}
              aria-invalid={errors.message ? "true" : undefined}
            />
            {errors.message?.message && (
              <p className="mt-1 text-sm text-error" role="alert">
                {errors.message.message}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Expires At (optional)
            </label>
            <Input
              type="datetime-local"
              {...register("expiresAt")}
              aria-invalid={errors.expiresAt ? "true" : undefined}
            />
            {errors.expiresAt?.message && (
              <p className="mt-1 text-sm text-error" role="alert">
                {errors.expiresAt.message}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Images (optional)</label>
            <Input
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => setImageFiles(Array.from(e.target.files || []))}
            />
          </div>

          {retainImages.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium">Existing Images</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {retainImages.map((img) => {
                  const src = resolveMediaUrl(img);
                  return (
                    <div key={img} className="relative overflow-hidden rounded-md border">
                      {src ? (
                        <img src={src} alt="announcement" className="h-24 w-full object-cover" />
                      ) : (
                        <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                          Image
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRetainedImage(img)}
                        className="absolute right-1 top-1 rounded bg-black/70 px-2 py-0.5 text-xs text-white"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {selectedImagePreviews.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium">New Images</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {selectedImagePreviews.map((item, idx) => (
                  <div key={`${item.name}-${idx}`} className="relative overflow-hidden rounded-md border">
                    <img
                      src={item.url}
                      alt={item.name}
                      className="h-24 w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeSelectedImage(idx)}
                      className="absolute right-1 top-1 rounded bg-black/70 px-2 py-0.5 text-xs text-white"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              disabled={isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-white disabled:opacity-60"
            >
              {isSubmitting
                ? editingId
                  ? "Updating…"
                  : "Posting…"
                : editingId
                ? "Update Announcement"
                : "Post Announcement"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetFormToCreate}
                className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4"
              >
                Cancel Edit
              </button>
            )}
            {errors.root?.message && (
              <div className="text-sm text-error" role="alert">
                {errors.root.message}
              </div>
            )}
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="text-error">{error}</div>
      ) : list.length === 0 ? (
        <div className="text-muted-foreground">No announcements</div>
      ) : (
        <ul className="space-y-3">
          {list.map((a) => (
            <li
              key={a._id}
              className="rounded-md border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{a.title}</div>
                  <div className="mt-2 whitespace-pre-wrap">{a.message}</div>
                  {!!normalizeImageList(a.images).length && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {normalizeImageList(a.images).length} image(s)
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewAnnouncement(a)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-bg"
                    aria-label="View announcement"
                    title="View"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  {canEditAnnouncement(a) && (
                    <button
                      type="button"
                      onClick={() => startEdit(a)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-primary hover:bg-bg"
                      aria-label="Edit announcement"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {canDeleteAnnouncement(a) && (
                    <button
                      type="button"
                      onClick={() => remove(a._id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-error hover:bg-bg"
                      aria-label="Delete announcement"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AnnouncementPreviewModal
        announcement={previewAnnouncement}
        onClose={() => setPreviewAnnouncement(null)}
      />
    </div>
  );
}
