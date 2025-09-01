import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

type FieldType = "text" | "number" | "date";
type FieldCategory = "earning" | "deduction" | "info";
type Field = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  category?: FieldCategory;
};

export default function MySalarySlip() {
  const today = new Date();
  const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
    2,
    "0"
  )}`;
  const [month, setMonth] = useState<string>(ym);
  const [template, setTemplate] = useState<Field[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await api.get(`/salary/slips/mine`, { params: { month } });
        const tpl: Field[] = (res.data.template?.fields || []) as Field[];
        setTemplate(tpl);
        const v = res.data.slip?.values || {};
        setValues({ ...Object.fromEntries(Object.entries(v)) });
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load salary slip");
      } finally {
        setLoading(false);
      }
    })();
  }, [month]);

  async function downloadPdf() {
    try {
      setDownloading(true);
      const res = await api.get(`/salary/slips/mine/pdf`, {
        params: { month },
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      await downloadFileBlob(blob, `SalarySlip-${month}.pdf`);
    } catch (e) {
      console.error(e);
      alert("Failed to download PDF");
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

  if (loading) return <div>Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">My Salary Slip</h2>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2"
          />
          <button
            onClick={downloadPdf}
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
    </div>
  );
}

function formatValue(v: any) {
  if (v === undefined || v === null || v === "") return "-";
  return String(v);
}

function formatAmount(v: any) {
  const n = typeof v === "number" ? v : Number(v);
  if (!isFinite(n)) return "-";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function downloadFileBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 0);
}

//
