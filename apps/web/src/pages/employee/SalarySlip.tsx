import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";

type FieldType = "text" | "number" | "date";
type FieldCategory = "earning" | "deduction" | "info";
type Field = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  category?: FieldCategory;
};

type HistoryEntry = {
  hasSlip: boolean;
  loading: boolean;
};

export default function MySalarySlip() {
  const today = new Date();
  const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const [month, setMonth] = useState<string>(ym);
  const [monthOptions, setMonthOptions] = useState<string[]>([ym]);
  const [loadingMonths, setLoadingMonths] = useState(true);

  const [template, setTemplate] = useState<Field[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const [history, setHistory] = useState<Record<string, HistoryEntry>>({});
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // Load months from company inception to now
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingMonths(true);
        const res = await api.get("/auth/me");
        if (!alive) return;
        const rawCreated =
          res?.data?.employee?.joiningDate ||
          res?.data?.employee?.createdAt;
        const created =
          parseIsoDate(rawCreated) || new Date(today.getFullYear(), today.getMonth(), 1);
        const list = enumerateMonths(created, today);
        if (list.length) {
          setMonthOptions(list);
          if (!list.includes(month)) {
            setMonth(list[list.length - 1]);
          }
        }
      } catch (e) {
        if (!alive) return;
        const fallback = enumerateMonths(new Date(today.getFullYear() - 1, today.getMonth(), 1), today);
        setMonthOptions(fallback);
        if (!fallback.includes(month)) setMonth(fallback[fallback.length - 1]);
      } finally {
        if (alive) setLoadingMonths(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load selected month slip
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setErr(null);
        setLoading(true);
        setHistory((prev) => ({
          ...prev,
          [month]: { hasSlip: prev[month]?.hasSlip ?? false, loading: true },
        }));
        const res = await api.get(`/salary/slips/mine`, { params: { month } });
        if (!alive) return;
        const tpl: Field[] = (res.data.template?.fields || []) as Field[];
        setTemplate(tpl);
        const v = res.data.slip?.values || {};
        setValues({ ...Object.fromEntries(Object.entries(v)) });
        setHistory((prev) => ({
          ...prev,
          [month]: { hasSlip: Boolean(res.data.slip?._id), loading: false },
        }));
      } catch (e: any) {
        if (!alive) return;
        const msg = e?.response?.data?.error || "Failed to load salary slip";
        setErr(msg);
        toast.error(msg);
        setHistory((prev) => ({
          ...prev,
          [month]: { hasSlip: false, loading: false },
        }));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [month]);

  // Prefetch history for other months (once)
  useEffect(() => {
    if (!monthOptions.length) return;
    const pending = monthOptions.filter((m) => m !== month && historyRef.current[m] === undefined);
    if (!pending.length) return;
    let alive = true;
    (async () => {
      for (const m of pending.sort().reverse()) {
        if (!alive) return;
        setHistory((prev) => ({
          ...prev,
          [m]: { hasSlip: prev[m]?.hasSlip ?? false, loading: true },
        }));
        try {
          const res = await api.get(`/salary/slips/mine`, { params: { month: m } });
          if (!alive) return;
          setHistory((prev) => ({
            ...prev,
            [m]: { hasSlip: Boolean(res.data.slip?._id), loading: false },
          }));
        } catch {
          if (!alive) return;
          setHistory((prev) => ({
            ...prev,
            [m]: { hasSlip: false, loading: false },
          }));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [monthOptions, month]);

  async function downloadPdf(targetMonth: string) {
    try {
      setDownloading(true);
      const res = await api.get(`/salary/slips/mine/pdf`, {
        params: { month: targetMonth },
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      await downloadFileBlob(blob, `SalarySlip-${targetMonth}.pdf`);
    } catch (e) {
      console.error(e);
      toast.error("Failed to download PDF");
    } finally {
      setDownloading(false);
    }
  }

  const hasData = useMemo(() => Object.keys(values || {}).length > 0, [values]);

  const { earnings, deductions, info, totals } = useMemo(() => {
    const tpl = (template || []).map((f) => ({
      ...f,
      category: (f.category as FieldCategory) || "info",
    }));
    const earnings = tpl.filter(
      (f) => f.category === "earning" && f.type === "number"
    );
    const deductions = tpl.filter(
      (f) => f.category === "deduction" && f.type === "number"
    );
    const info = tpl.filter(
      (f) => f.category !== "earning" && f.category !== "deduction"
    );

    const toNum = (v: any) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const sum = (list: Field[]) =>
      list.reduce((acc, f) => acc + toNum(values[f.key]), 0);
    const totalEarnings = sum(earnings);
    const totalDeductions = sum(deductions);
    const netPay = totalEarnings - totalDeductions;
    return {
      earnings,
      deductions,
      info,
      totals: { totalEarnings, totalDeductions, netPay },
    };
  }, [template, values]);

  const historyRows = useMemo(() => {
    return [...monthOptions].sort((a, b) => (a > b ? -1 : 1));
  }, [monthOptions]);

  if (loading) return <div>Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">My Salary Slip</h2>
          <p className="text-sm text-muted">
            Download and review salary slips month over month.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={loadingMonths}
            className="rounded-md border border-border bg-surface px-3 py-2"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(m)}
              </option>
            ))}
          </select>
          <button
            onClick={() => downloadPdf(month)}
            disabled={downloading}
            className="rounded-md bg-primary px-3 py-2 text-white disabled:opacity-50"
            title="Download PDF"
          >
            {downloading ? "Preparing…" : "Download PDF"}
          </button>
        </div>
      </div>
      {err && <div className="text-error text-sm">{err}</div>}

      {/* Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 border border-border rounded-md bg-surface">
          <div className="border-b border-border px-4 py-2 font-semibold">
            Earnings
          </div>
          <div className="divide-y divide-border">
            {earnings.length === 0 && (
              <div className="px-4 py-3 text-sm text-muted">
                No earning items
              </div>
            )}
            {earnings.map((f) => (
              <div
                key={f.key}
                className="px-4 py-2 flex items-center justify-between"
              >
                <div className="text-sm text-muted">{f.label}</div>
                <div className="font-medium">{formatAmount(values[f.key])}</div>
              </div>
            ))}
            <div className="px-4 py-3 flex items-center justify-between bg-bg font-semibold">
              <div>Total Earnings</div>
              <div>{formatAmount(totals.totalEarnings)}</div>
            </div>
          </div>
        </div>
        <div className="lg:col-span-1 border border-border rounded-md bg-surface">
          <div className="border-b border-border px-4 py-2 font-semibold">
            Deductions
          </div>
          <div className="divide-y divide-border">
            {deductions.length === 0 && (
              <div className="px-4 py-3 text-sm text-muted">
                No deduction items
              </div>
            )}
            {deductions.map((f) => (
              <div
                key={f.key}
                className="px-4 py-2 flex items-center justify-between"
              >
                <div className="text-sm text-muted">{f.label}</div>
                <div className="font-medium">{formatAmount(values[f.key])}</div>
              </div>
            ))}
            <div className="px-4 py-3 flex items-center justify-between bg-bg font-semibold">
              <div>Total Deductions</div>
              <div>{formatAmount(totals.totalDeductions)}</div>
            </div>
          </div>
        </div>
        <div className="lg:col-span-1 border border-border rounded-md bg-surface flex flex-col">
          <div className="border-b border-border px-4 py-2 font-semibold">
            Summary
          </div>
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="text-muted">Total Earnings</div>
              <div className="font-medium">
                {formatAmount(totals.totalEarnings)}
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <div className="text-muted">Total Deductions</div>
              <div className="font-medium">
                {formatAmount(totals.totalDeductions)}
              </div>
            </div>
            <div className="border-t border-border pt-2 mt-2 flex items-center justify-between text-lg font-bold">
              <div>Net Pay</div>
              <div>{formatAmount(totals.netPay)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Additional Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {template.length === 0 && (
          <div className="text-sm text-muted">
            No salary template configured yet.
          </div>
        )}
        {info.map((f) => (
          <div
            key={f.key}
            className="border border-border rounded-md p-3 bg-surface"
          >
            <div className="text-xs text-muted">{f.label}</div>
            <div className="text-base">{formatValue(values[f.key])}</div>
          </div>
        ))}
      </div>
      {!hasData && template.length > 0 && (
        <div className="text-sm text-muted">
          No values filled for this month yet.
        </div>
      )}

      {/* History */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-2 font-semibold">
          Salary Slip History
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/20 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Month</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((m) => {
                const entry = history[m] || { hasSlip: false, loading: true };
                const isCurrent = m === month;
                const status = entry.loading
                  ? "Loading…"
                  : entry.hasSlip
                  ? "Available"
                  : "Pending";
                const statusTone = entry.loading
                  ? "bg-warning/10 text-warning border-warning/30"
                  : entry.hasSlip
                  ? "bg-success/10 text-success border-success/30"
                  : "bg-muted/30 text-muted border-border";
                return (
                  <tr key={m} className="border-t border-border/60">
                    <td className="px-4 py-3">
                      <div className="font-medium">{formatMonthLabel(m)}</div>
                      {isCurrent && (
                        <div className="text-xs text-primary">Currently viewing</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusTone}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-3 space-x-2">
                      <button
                        onClick={() => setMonth(m)}
                        className="rounded-md border border-border px-2 py-1 text-xs"
                        disabled={isCurrent}
                      >
                        {isCurrent ? "Viewing" : "View"}
                      </button>
                      <button
                        onClick={() => downloadPdf(m)}
                        className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
                        disabled={!entry.hasSlip || downloading}
                      >
                        Download
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatAmount(val: any) {
  if (val === "" || val === null || val === undefined) return "-";
  const num = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(num)) return String(val || "-");
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatValue(val: any) {
  if (val === null || val === undefined || val === "") return "-";
  if (val instanceof Date) return val.toLocaleDateString();
  return String(val);
}

async function downloadFileBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parseIsoDate(value: any) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function enumerateMonths(from: Date, to: Date) {
  const start = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  const list: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    list.push(formatMonthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return list;
}

function formatMonthKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatMonthLabel(month: string) {
  if (!month) return "";
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}
