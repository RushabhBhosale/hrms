import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";
import type { Kra } from "../../types/performance";
import { SkeletonRows } from "../../components/utils/Table";

type Draft = {
  answer: string;
  rating: string;
};

type KraWindow = {
  openFrom?: string;
  openTo?: string;
};

function formatDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

export default function EmployeeKRAs() {
  const [kras, setKras] = useState<Kra[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [kraWindow, setKraWindow] = useState<KraWindow | null>(null);
  const [loadingWindow, setLoadingWindow] = useState(false);

  const sortedKras = useMemo(
    () =>
      [...kras].sort((a, b) =>
        (a.createdAt || "").localeCompare(b.createdAt || ""),
      ),
    [kras],
  );

  const windowStatus = useMemo(() => {
    if (!kraWindow || (!kraWindow.openFrom && !kraWindow.openTo)) return "OPEN";
    const now = new Date();
    const start = kraWindow.openFrom ? new Date(kraWindow.openFrom) : null;
    const end = kraWindow.openTo ? new Date(kraWindow.openTo) : null;
    if (start && now < start) return "NOT_STARTED";
    if (end && now > end) return "CLOSED";
    return "OPEN";
  }, [kraWindow]);

  const canEdit = (k: Kra) => {
    if (k.status === "CLOSED") return false;
    return windowStatus === "OPEN";
  };

  useEffect(() => {
    loadKraWindow();
    loadKras();
  }, []);

  async function loadKras() {
    try {
      setLoading(true);
      const res = await api.get("/performance/kras");
      const list: Kra[] = res.data?.kras || [];
      setKras(list);
      const nextDrafts: Record<string, Draft> = {};
      list.forEach((k) => {
        nextDrafts[k._id] = {
          answer: k.selfReview?.answer || "",
          rating:
            k.selfReview?.rating === undefined || k.selfReview?.rating === null
              ? ""
              : String(k.selfReview.rating),
        };
      });
      setDrafts(nextDrafts);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to load KRAs");
    } finally {
      setLoading(false);
    }
  }

  async function loadKraWindow() {
    try {
      setLoadingWindow(true);
      const res = await api.get("/performance/kras/window");
      setKraWindow(res.data?.window || {});
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to load KRA window");
    } finally {
      setLoadingWindow(false);
    }
  }

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  async function saveSelfReview(kra: Kra) {
    const draft = drafts[kra._id] || { answer: "", rating: "" };
    if (!canEdit(kra)) {
      const msg =
        kra.status === "CLOSED"
          ? "This KRA is closed"
          : windowStatus === "NOT_STARTED"
            ? "Self-review window has not opened yet"
            : "Self-review window is closed";
      toast.error(msg);
      return;
    }
    setSavingId(kra._id);
    try {
      const res = await api.patch(`/performance/kras/${kra._id}/self-review`, {
        answer: draft.answer.trim() || undefined,
        rating: draft.rating ? Number(draft.rating) : undefined,
      });
      const updated: Kra = res.data?.kra || kra;
      setKras((prev) =>
        prev.map((item) => (item._id === updated._id ? updated : item)),
      );
      updateDraft(updated._id, {
        answer: updated.selfReview?.answer || "",
        rating:
          updated.selfReview?.rating === undefined ||
          updated.selfReview?.rating === null
            ? ""
            : String(updated.selfReview.rating),
      });
      toast.success("Saved your response");
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to save response");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-bold">My KRAs</h2>
        <p className="text-sm text-muted-foreground">
          Answer and rate the questions assigned to you. Your manager and admin
          will add their ratings after you submit.
        </p>
      </div>

      <div
        className={`rounded-md border px-4 py-3 text-sm ${
          windowStatus === "OPEN"
            ? "border-success/40 bg-success/5 text-success"
            : "border-warning/40 bg-warning/5 text-warning"
        }`}
      >
        {loadingWindow
          ? "Checking self-review window…"
          : windowStatus === "OPEN"
            ? `Self reviews are open${kraWindow?.openTo ? ` until ${formatDate(kraWindow.openTo)}` : ""}.`
            : windowStatus === "NOT_STARTED"
              ? `Self reviews open on ${formatDate(kraWindow?.openFrom) || "the configured date"}.`
              : `Self reviews closed on ${formatDate(kraWindow?.openTo) || "the configured date"}.`}
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <SkeletonRows rows={3} cols={3} />
        </div>
      ) : !sortedKras.length ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-muted-foreground">
          No KRAs assigned yet.
        </div>
      ) : (
        <div className="space-y-4">
          {sortedKras.map((k) => {
            const draft = drafts[k._id] || { answer: "", rating: "" };
            return (
              <div
                key={k._id}
                className="rounded-lg border border-border bg-surface shadow-sm"
              >
                <div className="border-b border-border px-5 py-3 flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Question
                    </div>
                    <div className="text-lg font-semibold">{k.title}</div>
                    {k.description && (
                      <div className="text-sm text-muted-foreground mt-1">
                        {k.description}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {k.status === "CLOSED" ? (
                      <span className="rounded-full bg-success/10 text-success px-2 py-1">
                        Closed
                      </span>
                    ) : (
                      <span className="rounded-full bg-warning/10 text-warning px-2 py-1">
                        Open
                      </span>
                    )}
                  </div>
                </div>

                <div className="px-5 py-4 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Your answer</label>
                    <textarea
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                      rows={3}
                      value={draft.answer}
                      disabled={!canEdit(k)}
                      onChange={(e) =>
                        updateDraft(k._id, { answer: e.target.value })
                      }
                      placeholder="Describe what you achieved or learned for this KRA."
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Self rating (0–5)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      step="0.1"
                      className="w-32 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                      value={draft.rating}
                      disabled={!canEdit(k)}
                      onChange={(e) =>
                        updateDraft(k._id, { rating: e.target.value })
                      }
                      placeholder="e.g. 4.5"
                    />
                  </div>

                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <InfoPill
                      label="Manager rating"
                      value={
                        k.managerReview?.rating !== undefined &&
                        k.managerReview?.rating !== null
                          ? k.managerReview.rating
                          : "Pending"
                      }
                      note={k.managerReview?.comments}
                    />
                    <InfoPill
                      label="Admin rating"
                      value={
                        k.adminReview?.rating !== undefined &&
                        k.adminReview?.rating !== null
                          ? k.adminReview.rating
                          : "Pending"
                      }
                      note={k.adminReview?.comments}
                    />
                  </div>

                  <div className="flex justify-end gap-3">
                    <button
                      className="rounded-md bg-primary px-4 py-2 text-sm text-white disabled:opacity-60"
                      disabled={savingId === k._id || !canEdit(k)}
                      onClick={() => saveSelfReview(k)}
                    >
                      {savingId === k._id ? "Saving…" : "Save response"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InfoPill({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="rounded-full bg-muted/40 px-3 py-1.5">
      <span className="font-semibold">{label}:</span>{" "}
      <span className="text-text">{value}</span>
      {note ? <span className="text-muted-foreground"> · {note}</span> : null}
    </div>
  );
}
