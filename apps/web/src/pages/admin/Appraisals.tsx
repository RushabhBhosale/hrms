import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { Th, Td, SkeletonRows } from "../../components/utils/Table";
import { toast } from "react-hot-toast";
import type { Appraisal, Kra } from "../../types/performance";

type EmployeeOption = {
  id: string;
  name: string;
  email?: string;
  employeeId?: string | null;
};

type KraRatingInput = {
  kraId: string;
  rating: string;
  comments: string;
};

function fmtDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

function employeeLabel(e: EmployeeOption) {
  const parts = [e.name];
  if (e.employeeId) parts.push(`#${e.employeeId}`);
  if (e.email) parts.push(e.email);
  return parts.filter(Boolean).join(" · ");
}

export default function Appraisals() {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string>("");

  const [kras, setKras] = useState<Kra[]>([]);
  const [loadingKras, setLoadingKras] = useState(false);

  const [appForm, setAppForm] = useState({
    periodStart: "",
    periodEnd: "",
    overallRating: "",
    summary: "",
    kraRatings: [] as KraRatingInput[],
  });
  const [creatingAppraisal, setCreatingAppraisal] = useState(false);

  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);

  const selectedEmployeeObj = useMemo(
    () => employees.find((e) => e.id === selectedEmployee) || null,
    [employees, selectedEmployee],
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/employees");
        const list: EmployeeOption[] = (res.data.employees || []).map(
          (e: any) => ({
            id: e.id,
            name: e.name,
            email: e.email,
            employeeId: e.employeeId || null,
          }),
        );
        list.sort((a, b) => a.name.localeCompare(b.name));
        setEmployees(list);
        if (!selectedEmployee && list.length) {
          setSelectedEmployee(list[0].id);
        }
      } catch (e: any) {
        toast.error(
          e?.response?.data?.error || "Failed to load employees for appraisals",
        );
      }
    })();
  }, []);

  async function loadKras(employeeId?: string) {
    if (!employeeId) return;
    try {
      setLoadingKras(true);
      const res = await api.get("/performance/kras", {
        params: { employeeId },
      });
      setKras(res.data.kras || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to load KRAs");
    } finally {
      setLoadingKras(false);
    }
  }

  async function loadAppraisals(employeeId?: string) {
    if (!employeeId) return;
    try {
      setLoadingApps(true);
      const res = await api.get("/performance/appraisals", {
        params: { employeeId },
      });
      setAppraisals(res.data.appraisals || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to load appraisals");
    } finally {
      setLoadingApps(false);
    }
  }

  useEffect(() => {
    if (!selectedEmployee) {
      setKras([]);
      setAppraisals([]);
      setAppForm((prev) => ({ ...prev, kraRatings: [] }));
      return;
    }
    loadKras(selectedEmployee);
    loadAppraisals(selectedEmployee);
    setAppForm((prev) => ({ ...prev, kraRatings: [] }));
  }, [selectedEmployee]);

  function addKraRating() {
    const firstKra = kras[0];
    setAppForm((prev) => ({
      ...prev,
      kraRatings: [
        ...prev.kraRatings,
        {
          kraId: firstKra?._id || "",
          rating: "",
          comments: "",
        },
      ],
    }));
  }

  function updateKraRating(idx: number, next: Partial<KraRatingInput>) {
    setAppForm((prev) => {
      const ratings = [...prev.kraRatings];
      ratings[idx] = { ...ratings[idx], ...next };
      return { ...prev, kraRatings: ratings };
    });
  }

  function removeKraRating(idx: number) {
    setAppForm((prev) => ({
      ...prev,
      kraRatings: prev.kraRatings.filter((_, i) => i !== idx),
    }));
  }

  async function submitAppraisal(e: FormEvent) {
    e.preventDefault();
    if (!selectedEmployee) {
      toast.error("Pick an employee");
      return;
    }
    const kraResults = appForm.kraRatings
      .map((r) => ({
        kra: r.kraId || undefined,
        rating: r.rating ? Number(r.rating) : undefined,
        comments: r.comments.trim() || undefined,
      }))
      .filter((r) => r.kra || r.rating || r.comments);

    const payload = {
      employeeId: selectedEmployee,
      periodStart: appForm.periodStart || undefined,
      periodEnd: appForm.periodEnd || undefined,
      overallRating: appForm.overallRating
        ? Number(appForm.overallRating)
        : undefined,
      summary: appForm.summary.trim(),
      kraResults,
    };
    try {
      setCreatingAppraisal(true);
      await api.post("/performance/appraisals", payload);
      toast.success("Appraisal saved");
      setAppForm({
        periodStart: "",
        periodEnd: "",
        overallRating: "",
        summary: "",
        kraRatings: [],
      });
      loadAppraisals(selectedEmployee);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to save appraisal");
    } finally {
      setCreatingAppraisal(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Appraisals</h2>
          <p className="text-sm text-muted-foreground">
            Record performance reviews and ratings.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="h-10 rounded-md border border-border bg-surface px-3"
            value={selectedEmployee}
            onChange={(e) => setSelectedEmployee(e.target.value)}
          >
            <option value="">Select employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {employeeLabel(e)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedEmployeeObj && (
        <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="text-sm text-muted-foreground">Working on</div>
          <div className="text-lg font-semibold">
            {selectedEmployeeObj.name}
          </div>
          {selectedEmployeeObj.email && (
            <div className="text-sm text-muted-foreground">
              {selectedEmployeeObj.email}
            </div>
          )}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-lg font-semibold">Add Appraisal</h3>
          <p className="text-xs text-muted-foreground">
            Capture a review for the selected employee and tie it to KRAs.
          </p>
        </div>
        <form onSubmit={submitAppraisal} className="space-y-4 px-5 py-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Period start</label>
              <input
                type="date"
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
                value={appForm.periodStart}
                onChange={(e) =>
                  setAppForm((prev) => ({
                    ...prev,
                    periodStart: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Period end</label>
              <input
                type="date"
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
                value={appForm.periodEnd}
                onChange={(e) =>
                  setAppForm((prev) => ({
                    ...prev,
                    periodEnd: e.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Overall rating</label>
            <input
              type="number"
              step="0.1"
              className="w-full rounded-md border border-border bg-surface px-3 py-2"
              value={appForm.overallRating}
              onChange={(e) =>
                setAppForm((prev) => ({
                  ...prev,
                  overallRating: e.target.value,
                }))
              }
              placeholder="e.g. 4.5"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Summary / feedback</label>
            <textarea
              className="w-full rounded-md border border-border bg-surface px-3 py-2"
              rows={3}
              value={appForm.summary}
              onChange={(e) =>
                setAppForm((prev) => ({ ...prev, summary: e.target.value }))
              }
              placeholder="Highlights, outcomes, and recommendations"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                KRA-specific ratings
              </label>
              <button
                type="button"
                className="text-sm text-primary"
                onClick={addKraRating}
                disabled={!kras.length}
              >
                + Add KRA rating
              </button>
            </div>
            {!kras.length && (
              <div className="text-xs text-muted-foreground">
                Add KRAs first to link them to this appraisal.
              </div>
            )}
            <div className="space-y-3">
              {appForm.kraRatings.map((r, idx) => (
                <div
                  key={idx}
                  className="grid gap-2 md:grid-cols-[1fr_140px_1fr]"
                >
                  <select
                    className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    value={r.kraId}
                    onChange={(e) =>
                      updateKraRating(idx, { kraId: e.target.value })
                    }
                  >
                    <option value="">Select KRA</option>
                    {kras.map((k) => (
                      <option key={k._id} value={k._id}>
                        {k.title}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    type="number"
                    step="0.1"
                    placeholder="Rating"
                    value={r.rating}
                    onChange={(e) =>
                      updateKraRating(idx, { rating: e.target.value })
                    }
                  />
                  <div className="flex items-center gap-2">
                    <textarea
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                      rows={2}
                      placeholder="Comments"
                      value={r.comments}
                      onChange={(e) =>
                        updateKraRating(idx, { comments: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="h-10 w-10 rounded-md border border-border text-xs text-muted-foreground hover:text-text"
                      onClick={() => removeKraRating(idx)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={creatingAppraisal}
              className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {creatingAppraisal ? "Saving…" : "Save appraisal"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-5 py-3 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Appraisals</h3>
            <p className="text-xs text-muted-foreground">
              Recent reviews for the selected employee.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            {loadingApps ? "Loading…" : `${appraisals.length} total`}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg text-left">
                <Th>Period</Th>
                <Th>Rating</Th>
                <Th>KRAs</Th>
                <Th>Summary</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {loadingApps ? (
                <SkeletonRows rows={3} cols={5} />
              ) : !appraisals.length ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-8 text-center text-muted-foreground"
                  >
                    No appraisals yet for this employee.
                  </td>
                </tr>
              ) : (
                appraisals.map((a) => (
                  <tr
                    key={a._id}
                    className="border-t border-border/60 hover:bg-bg/60"
                  >
                    <Td className="text-xs text-muted-foreground whitespace-nowrap">
                      {a.periodStart || a.periodEnd
                        ? `${fmtDate(a.periodStart)} – ${fmtDate(a.periodEnd)}`
                        : "Not set"}
                    </Td>
                    <Td className="font-medium">
                      {a.overallRating !== undefined && a.overallRating !== null
                        ? a.overallRating
                        : "—"}
                    </Td>
                    <Td className="text-xs text-muted-foreground">
                      {a.kraResults?.length ? a.kraResults.length : 0}
                    </Td>
                    <Td className="max-w-md text-xs">
                      {a.summary ? (
                        <div className="line-clamp-2">{a.summary}</div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td className="text-xs text-muted-foreground">
                      {a.createdAt ? fmtDate(a.createdAt) : "—"}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
