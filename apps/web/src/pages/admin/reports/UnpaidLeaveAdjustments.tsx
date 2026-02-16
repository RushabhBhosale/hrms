import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { api } from "../../../lib/api";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../components/ui/button";

type AdjustmentRow = {
  employeeId: string;
  name: string;
  email?: string;
  taken: number;
  takenBefore: number;
  carryBefore: number;
  available: number;
  deducted: number;
  carryAfter: number;
  maxDeductable: number;
  note?: string | null;
};

type Summary = {
  totalTaken: number;
  totalDeducted: number;
  totalAvailable: number;
  totalCarryBefore: number;
  totalCarryAfter: number;
  totalMaxDeductable: number;
};

const EMPTY_SUMMARY: Summary = {
  totalTaken: 0,
  totalDeducted: 0,
  totalAvailable: 0,
  totalCarryBefore: 0,
  totalCarryAfter: 0,
  totalMaxDeductable: 0,
};

export default function UnpaidLeaveAdjustmentsPage() {
  const today = new Date();
  const navigate = useNavigate();
  const initialMonth = `${today.getFullYear()}-${String(
    today.getMonth() + 1,
  ).padStart(2, "0")}`;

  const [month, setMonth] = useState<string>(initialMonth);
  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [resolveEmployee, setResolveEmployee] = useState("");
  const [resolveDate, setResolveDate] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveErr, setResolveErr] = useState<string | null>(null);
  const [resolveOk, setResolveOk] = useState<string | null>(null);

  const fetchAdjustments = useCallback(async (targetMonth: string) => {
    const res = await api.get("/unpaid-leaves/adjustments", {
      params: { month: targetMonth },
    });
    const dataRows = (res.data.rows || []) as AdjustmentRow[];
    const nextValues: Record<string, string> = {};
    for (const row of dataRows) {
      nextValues[row.employeeId] = String(row.deducted ?? 0);
    }
    return {
      dataRows,
      summary: res.data.summary || { ...EMPTY_SUMMARY },
      valueMap: nextValues,
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const { dataRows, summary, valueMap } = await fetchAdjustments(month);
        if (!alive) return;
        setRows(dataRows);
        setSummary(summary);
        setValues(valueMap);
      } catch (e: any) {
        if (!alive) return;
        setError(
          e?.response?.data?.error || "Failed to load unpaid leave adjustments",
        );
        setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, fetchAdjustments]);

  useEffect(() => {
    if (!resolveEmployee && rows.length) {
      setResolveEmployee(rows[0].employeeId);
    }
  }, [rows, resolveEmployee]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const haystack = `${row.name} ${row.email ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [rows, search]);

  async function handleSave(employeeId: string) {
    const inputValue = values[employeeId] ?? "0";
    const numeric = Number(inputValue);
    if (!Number.isFinite(numeric) || numeric < 0) {
      toast.error("Enter a valid deduction amount");
      return;
    }
    setSaving((prev) => ({ ...prev, [employeeId]: true }));
    try {
      await api.post("/unpaid-leaves/adjustments", {
        employeeId,
        month,
        deducted: numeric,
      });
      toast.success("Deduction updated");
      const { dataRows, summary, valueMap } = await fetchAdjustments(month);
      setRows(dataRows);
      setSummary(summary);
      setValues(valueMap);
    } catch (e: any) {
      toast.error(
        e?.response?.data?.error || "Failed to update unpaid leave deduction",
      );
    } finally {
      setSaving((prev) => ({ ...prev, [employeeId]: false }));
    }
  }

  async function handleResolveAutoLeave() {
    if (!resolveEmployee || !resolveDate) {
      setResolveErr("Select employee and date to resolve");
      setResolveOk(null);
      return;
    }
    try {
      setResolving(true);
      setResolveErr(null);
      setResolveOk(null);
      await api.post("/attendance/admin/auto-leave/resolve", {
        employeeId: resolveEmployee,
        date: resolveDate,
      });
      setResolveOk("Auto-applied unpaid leave removed");
      toast.success("Auto-applied unpaid leave removed");
      const targetMonth = resolveDate.slice(0, 7);
      if (targetMonth === month) {
        const { dataRows, summary, valueMap } = await fetchAdjustments(month);
        setRows(dataRows);
        setSummary(summary);
        setValues(valueMap);
      }
    } catch (e: any) {
      const msg =
        e?.response?.data?.error || "Failed to resolve auto-applied leave";
      setResolveErr(msg);
      toast.error(msg);
    } finally {
      setResolving(false);
    }
  }

  const headerSummary = useMemo(
    () => [
      { label: "Taken", value: summary.totalTaken },
      { label: "Deducted", value: summary.totalDeducted },
      { label: "Available", value: summary.totalAvailable },
      { label: "Carry Before", value: summary.totalCarryBefore },
      { label: "Carry After", value: summary.totalCarryAfter },
    ],
    [summary],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <h2 className="text-xl font-semibold">Unpaid Leave Adjustments</h2>
          <p className="text-sm text-muted-foreground">
            Specify how many unpaid days should be deducted this month and carry
            the remainder forward.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2 w-full sm:w-auto sm:flex-nowrap">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-10 min-w-[140px] flex-1 sm:flex-none rounded-md border border-border bg-surface px-3 text-sm"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter employees…"
            className="h-10 min-w-[180px] flex-1 sm:flex-none rounded-md border border-border bg-surface px-3 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0"
            onClick={() => navigate("/admin/reports/salary-slips")}
          >
            Back To Salary Slips
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {headerSummary.map((item) => (
          <span key={item.label}>
            {item.label}: {fmtNumber(item.value)}
          </span>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-medium">
                Resolve mistaken auto unpaid leave
              </div>
              <p className="text-xs text-muted-foreground">
                Remove an auto-applied unpaid leave when attendance existed (for
                example, punched in but missed punch-out).
              </p>
            </div>
            {resolveErr && (
              <div className="text-xs text-error">{resolveErr}</div>
            )}
            {resolveOk && (
              <div className="text-xs text-success">{resolveOk}</div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={resolveEmployee}
              onChange={(e) => {
                setResolveEmployee(e.target.value);
                setResolveErr(null);
                setResolveOk(null);
              }}
              className="h-10 rounded-md border border-border bg-white px-3 text-sm"
            >
              {rows.map((row) => (
                <option key={row.employeeId} value={row.employeeId}>
                  {row.name} {row.email ? `(${row.email})` : ""}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={resolveDate}
              onChange={(e) => {
                setResolveDate(e.target.value);
                setResolveErr(null);
                setResolveOk(null);
              }}
              className="h-10 rounded-md border border-border bg-white px-3 text-sm"
            />
            <button
              type="button"
              onClick={handleResolveAutoLeave}
              disabled={resolving}
              className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {resolving ? "Resolving…" : "Remove Auto Leave"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-surface px-4 py-6 text-sm text-muted-foreground">
          No adjustments found for this month.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
          <table className="min-w-[960px] w-full text-sm">
            <thead className="bg-muted/20 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Employee</th>
                {/* <th className="px-4 py-3 font-medium">Taken</th> */}
                {/* <th className="px-4 py-3 font-medium">Carry Before</th> */}
                <th className="px-4 py-3 font-medium">Available</th>
                <th className="px-4 py-3 font-medium">Deducted</th>
                <th className="px-4 py-3 font-medium">Carry After</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const value = values[row.employeeId] ?? String(row.deducted);
                const highlightAvailable = row.available < row.deducted;
                const dirty = Number(value || 0) !== Number(row.deducted || 0);
                return (
                  <tr
                    key={row.employeeId}
                    className="border-t border-border/60"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.name}</div>
                      {row.email && (
                        <div className="text-xs text-muted-foreground">
                          {row.email}
                        </div>
                      )}
                    </td>
                    {/* <td className="px-4 py-3">{fmtNumber(row.taken)}</td>
                    <td className="px-4 py-3">
                      {fmtNumber(row.carryBefore)}
                    </td> */}
                    <td
                      className={`px-4 py-3 ${
                        highlightAvailable ? "text-error" : ""
                      }`}
                    >
                      {fmtNumber(row.available)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <input
                          className="w-full rounded-md border border-border/80 bg-white px-2 py-1 text-xs"
                          type="number"
                          min="0"
                          step="0.25"
                          value={value}
                          onChange={(e) =>
                            setValues((prev) => ({
                              ...prev,
                              [row.employeeId]: e.target.value,
                            }))
                          }
                        />
                        <span className="text-[10px] text-muted-foreground">
                          Max {fmtNumber(row.maxDeductable)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">{fmtNumber(row.carryAfter)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleSave(row.employeeId)}
                        disabled={saving[row.employeeId] || !dirty}
                        className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {saving[row.employeeId] ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtNumber(value: number) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  if (Math.abs(num % 1) < 1e-4) return String(Math.round(num));
  return num.toFixed(2);
}
