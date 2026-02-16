import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";
import type { Kra } from "../../types/performance";
import { SkeletonRows } from "../../components/utils/Table";
import { useCurrentEmployee } from "../../hooks/useCurrentEmployee";

type EmployeeOption = {
  id: string;
  name: string;
  email?: string;
  employeeId?: string | null;
  reportingPerson?: string | null;
  reportingPersons?: string[];
};

type Draft = {
  rating: string;
  comments: string;
};

function employeeLabel(e: EmployeeOption) {
  const parts = [e.name];
  if (e.employeeId) parts.push(`#${e.employeeId}`);
  if (e.email) parts.push(e.email);
  return parts.filter(Boolean).join(" · ");
}

export default function KRATeam() {
  const { employee: me } = useCurrentEmployee();
  const myId = me?.id || "";

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string>("");
  const [kras, setKras] = useState<Kra[]>([]);
  const [loadingKras, setLoadingKras] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const myReports = useMemo(
    () =>
      employees.filter(
        (e) =>
          e.reportingPerson === myId ||
          (e.reportingPersons || []).some((id) => id === myId),
      ),
    [employees, myId],
  );

  useEffect(() => {
    (async () => {
      try {
        setLoadingEmployees(true);
        const res = await api.get("/companies/employees");
        const list: EmployeeOption[] = (res.data?.employees || []).map(
          (e: any) => ({
            id: e.id,
            name: e.name,
            email: e.email,
            employeeId: e.employeeId || null,
            reportingPerson: e.reportingPerson || null,
            reportingPersons: e.reportingPersons || [],
          }),
        );
        setEmployees(list);
      } catch (e: any) {
        toast.error(e?.response?.data?.error || "Failed to load employees");
      } finally {
        setLoadingEmployees(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedEmployee && myReports.length) {
      setSelectedEmployee(myReports[0].id);
    }
  }, [selectedEmployee, myReports]);

  useEffect(() => {
    if (!selectedEmployee) {
      setKras([]);
      return;
    }
    loadKras(selectedEmployee);
  }, [selectedEmployee]);

  async function loadKras(employeeId?: string) {
    if (!employeeId) return;
    try {
      setLoadingKras(true);
      const res = await api.get("/performance/kras", {
        params: { employeeId },
      });
      const list: Kra[] = res.data?.kras || [];
      setKras(list);
      const nextDrafts: Record<string, Draft> = {};
      list.forEach((k) => {
        nextDrafts[k._id] = {
          rating:
            k.managerReview?.rating === undefined ||
            k.managerReview?.rating === null
              ? ""
              : String(k.managerReview.rating),
          comments: k.managerReview?.comments || "",
        };
      });
      setDrafts(nextDrafts);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to load KRAs");
    } finally {
      setLoadingKras(false);
    }
  }

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  async function saveReview(kra: Kra) {
    const draft = drafts[kra._id] || { rating: "", comments: "" };
    setSavingId(kra._id);
    try {
      const res = await api.patch(
        `/performance/kras/${kra._id}/manager-review`,
        {
          rating: draft.rating ? Number(draft.rating) : undefined,
          comments: draft.comments.trim() || undefined,
        },
      );
      const updated: Kra = res.data?.kra || kra;
      setKras((prev) =>
        prev.map((item) => (item._id === updated._id ? updated : item)),
      );
      updateDraft(updated._id, {
        rating:
          updated.managerReview?.rating === undefined ||
          updated.managerReview?.rating === null
            ? ""
            : String(updated.managerReview.rating),
        comments: updated.managerReview?.comments || "",
      });
      toast.success("Saved rating");
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to save rating");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-bold">Team KRAs</h2>
        <p className="text-sm text-muted-foreground">
          Review KRAs for your direct reports. Self ratings are shown for
          context.
        </p>
      </div>

      {loadingEmployees ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <SkeletonRows rows={2} cols={3} />
        </div>
      ) : !myReports.length ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-muted-foreground">
          No direct reports found. Team KRAs are shown only for employees who
          list you as their reporting manager.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface shadow-sm">
          <div className="border-b border-border px-5 py-3 flex flex-wrap items-center gap-3 justify-between">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Select employee
              </div>
              <select
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
              >
                {myReports.map((e) => (
                  <option key={e.id} value={e.id}>
                    {employeeLabel(e)}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-xs text-muted-foreground">
              {loadingKras ? "Loading…" : `${kras.length} KRAs`}
            </div>
          </div>

          <div className="divide-y divide-border">
            {loadingKras ? (
              <SkeletonRows rows={2} cols={3} />
            ) : !kras.length ? (
              <div className="px-5 py-6 text-center text-muted-foreground">
                No KRAs found for this employee.
              </div>
            ) : (
              kras.map((k) => {
                const draft = drafts[k._id] || { rating: "", comments: "" };
                return (
                  <div key={k._id} className="px-5 py-4 space-y-3">
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted-foreground">
                        Question
                      </div>
                      <div className="text-base font-semibold">{k.title}</div>
                      {k.description && (
                        <div className="text-sm text-muted-foreground">
                          {k.description}
                        </div>
                      )}
                    </div>

                    <div className="rounded-md bg-muted/20 px-3 py-2 text-sm">
                      <div className="font-semibold">Employee response</div>
                      {k.selfReview?.answer ? (
                        <p className="mt-1 whitespace-pre-wrap">
                          {k.selfReview.answer}
                        </p>
                      ) : (
                        <p className="text-muted-foreground">No answer yet</p>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">
                        Self rating:{" "}
                        {k.selfReview?.rating !== undefined &&
                        k.selfReview?.rating !== null
                          ? k.selfReview.rating
                          : "Pending"}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-[140px_1fr]">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Your rating (0–5)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="5"
                          step="0.1"
                          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                          value={draft.rating}
                          onChange={(e) =>
                            updateDraft(k._id, { rating: e.target.value })
                          }
                          placeholder="e.g. 4"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Comments (optional)
                        </label>
                        <textarea
                          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                          rows={2}
                          value={draft.comments}
                          onChange={(e) =>
                            updateDraft(k._id, { comments: e.target.value })
                          }
                          placeholder="Specific observations or examples"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
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
                        disabled={savingId === k._id}
                        onClick={() => saveReview(k)}
                      >
                        {savingId === k._id ? "Saving…" : "Save rating"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
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
