import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";

type EmployeeLite = {
  id: string;
  name: string;
  email: string;
  createdAt?: string | null;
};
type FieldType = "text" | "number" | "date";
type FieldCategory = "earning" | "deduction" | "info";
type Field = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  defaultValue?: any;
  order?: number;
  locked?: boolean;
  category?: FieldCategory | string;
};

type SlipData = {
  template: Field[];
  values: Record<string, any>;
  hasSlip: boolean;
};

export default function SalarySlipsAdmin() {
  const today = useMemo(() => new Date(), []);
  const initialMonth = useMemo(() => getCurrentMonthKey(), []);

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [month, setMonth] = useState<string>(initialMonth);
  const [monthOptions, setMonthOptions] = useState<string[]>([initialMonth]);
  const [template, setTemplate] = useState<Field[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [loadingSlip, setLoadingSlip] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasSlip, setHasSlip] = useState(false);

  const fetchSlipData = useCallback(
    async (targetEmployeeId: string, targetMonth: string): Promise<SlipData> => {
      const res = await api.get(`/salary/slips`, {
        params: { employeeId: targetEmployeeId, month: targetMonth },
      });
      const tpl: Field[] = (res.data.template?.fields || []) as Field[];
      const rawValues = res.data.slip?.values || {};
      return {
        template: tpl,
        values: { ...Object.fromEntries(Object.entries(rawValues)) },
        hasSlip: Boolean(res.data.slip?._id),
      };
    },
    []
  );

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await api.get("/companies/employees");
        const list: EmployeeLite[] = (res.data.employees || []).map((e: any) => ({
          id: e.id,
          name: e.name,
          email: e.email,
          createdAt: e.createdAt,
        }));
        setEmployees(list);
        setEmployeeId((prev) => prev || list[0]?.id || "");
      } catch (e: any) {
        const msg = e?.response?.data?.error || "Failed to load employees";
        setErr(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;
    const start =
      parseIsoDate(emp.createdAt) || new Date(today.getFullYear(), today.getMonth(), 1);
    const computed = enumerateMonths(start, today);
    const list = computed.length ? computed : [initialMonth];
    setMonthOptions(list);
    if (!list.includes(month)) {
      setMonth(list[list.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, employees, today, initialMonth]);

  useEffect(() => {
    if (!employeeId || !month) return;
    let cancelled = false;
    (async () => {
      try {
        setErr(null);
        setLoadingSlip(true);
        const data = await fetchSlipData(employeeId, month);
        if (cancelled) return;
        setTemplate(data.template);
        setValues(data.values);
        setHasSlip(data.hasSlip);
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.response?.data?.error || "Failed to load salary slip";
        setTemplate([]);
        setValues({});
        setHasSlip(false);
        setErr(msg);
        toast.error(msg);
      } finally {
        if (!cancelled) setLoadingSlip(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, month, fetchSlipData]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employeeId) || null,
    [employees, employeeId]
  );

  const { earnings, deductions, info, totals } = useMemo(() => {
    const tpl = (template || []).map((f) => ({
      ...f,
      category: (f.category as FieldCategory) || "info",
    }));
    const earningFields = tpl.filter(
      (f) => f.category === "earning" && f.type === "number"
    );
    const deductionFields = tpl.filter(
      (f) => f.category === "deduction" && f.type === "number"
    );
    const infoFields = tpl.filter(
      (f) => f.category !== "earning" && f.category !== "deduction"
    );
    const toNum = (val: any) => {
      const n = typeof val === "number" ? val : Number(val);
      return Number.isFinite(n) ? n : 0;
    };
    const sum = (items: Field[]) => items.reduce((acc, f) => acc + toNum(values[f.key]), 0);
    const totalEarnings = sum(earningFields);
    const totalDeductions = sum(deductionFields);
    return {
      earnings: earningFields,
      deductions: deductionFields,
      info: infoFields,
      totals: {
        totalEarnings,
        totalDeductions,
        netPay: totalEarnings - totalDeductions,
      },
    };
  }, [template, values]);

  const hasAnyData = useMemo(
    () => Object.keys(values || {}).some((k) => values[k] !== undefined && values[k] !== ""),
    [values]
  );

  const infoKeys = useMemo(() => new Set(info.map((f) => f.key)), [info]);

  async function generateSlip() {
    if (!employeeId || !month) return;
    try {
      setGenerating(true);
      setErr(null);
      const payload: Record<string, any> = {};
      for (const field of template) {
        if (field.locked) continue;
        const raw = values[field.key];
        if (field.type === "number") {
          payload[field.key] =
            raw === "" || raw === null || raw === undefined ? "" : Number(raw);
        } else {
          payload[field.key] = raw ?? "";
        }
      }
      await api.post("/salary/slips", { employeeId, month, values: payload });
      toast.success("Salary slip generated & emailed to the employee");
      const data = await fetchSlipData(employeeId, month);
      setTemplate(data.template);
      setValues(data.values);
      setHasSlip(data.hasSlip);
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to generate salary slip";
      setErr(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  }

  async function downloadPdf() {
    if (!employeeId || !month) return;
    try {
      setDownloading(true);
      const res = await api.get(`/salary/slips/pdf`, {
        params: { employeeId, month },
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const namePart = selectedEmployee
        ? selectedEmployee.name.replace(/[^a-z0-9\-_.]+/gi, "_")
        : employeeId;
      await downloadFileBlob(blob, `SalarySlip-${namePart}-${month}.pdf`);
    } catch (e) {
      console.error(e);
      toast.error("Failed to download PDF");
    } finally {
      setDownloading(false);
    }
  }

  if (loading && !employees.length) return <div>Loading…</div>;

  if (!employeeId) {
    return <div>No employees available.</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Salary Slips</h2>
        <p className="text-sm text-muted">
          Review generated slips and email them to employees month over month.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-muted">Employee</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2"
          >
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.email})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted">Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button
            onClick={generateSlip}
            disabled={generating || !template.length}
            className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate & Email"}
          </button>
          <button
            onClick={downloadPdf}
            disabled={downloading}
            className="rounded-md border border-border px-4 py-2 disabled:opacity-50"
          >
            {downloading ? "Preparing…" : "Download PDF"}
          </button>
        </div>
      </div>

      {err && <div className="text-error text-sm">{err}</div>}
      {loadingSlip && (
        <div className="text-sm text-muted">Loading salary slip…</div>
      )}

      {template.length === 0 ? (
        <div className="text-sm text-muted">
          No salary template configured yet.
        </div>
      ) : (
        <>
          <div className="border border-border rounded-lg bg-surface p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs text-muted">Net Pay</div>
              <div className="text-2xl font-semibold">{formatAmount(totals.netPay)}</div>
            </div>
            <div className="text-sm text-muted">
              {selectedEmployee?.name || "Employee"} · {formatMonthLabel(month)}
            </div>
          </div>

          {!hasSlip && !generating && (
            <div className="text-sm text-muted">
              No salary slip exists for this month yet. Click “Generate & Email” to create and
              send it.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-border rounded-lg overflow-hidden bg-surface">
              <div className="border-b border-border px-4 py-2 font-semibold">Earnings</div>
              <table className="min-w-full text-sm">
                <tbody>
                  {earnings.length === 0 ? (
                    <tr>
                      <td className="px-4 py-3 text-muted">No earnings configured</td>
                    </tr>
                  ) : (
                    earnings.map((field) => (
                      <tr key={field.key} className="border-t border-border/60">
                        <td className="px-4 py-2">{field.label}</td>
                        <td className="px-4 py-2 text-right">
                          {formatAmount(values[field.key])}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-muted/20">
                    <td className="px-4 py-2 font-semibold">Total Earnings</td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {formatAmount(totals.totalEarnings)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="border border-border rounded-lg overflow-hidden bg-surface">
              <div className="border-b border-border px-4 py-2 font-semibold">Deductions</div>
              <table className="min-w-full text-sm">
                <tbody>
                  {deductions.length === 0 ? (
                    <tr>
                      <td className="px-4 py-3 text-muted">No deductions configured</td>
                    </tr>
                  ) : (
                    deductions.map((field) => (
                      <tr key={field.key} className="border-t border-border/60">
                        <td className="px-4 py-2">{field.label}</td>
                        <td className="px-4 py-2 text-right">
                          {formatAmount(values[field.key])}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-muted/20">
                    <td className="px-4 py-2 font-semibold">Total Deductions</td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {formatAmount(totals.totalDeductions)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="border border-border rounded-lg overflow-hidden bg-surface">
            <div className="border-b border-border px-4 py-2 font-semibold">
              Additional Details
            </div>
            <table className="min-w-full text-sm">
              <tbody>
                {info.length === 0 && (
                  <tr>
                    <td className="px-4 py-3 text-muted">No additional information</td>
                  </tr>
                )}
                {info.map((field) => (
                  <tr key={field.key} className="border-t border-border/60">
                    <td className="px-4 py-2 w-1/3">{field.label}</td>
                    <td className="px-4 py-2">{formatValue(values[field.key])}</td>
                  </tr>
                ))}
                {hasAnyData &&
                  [
                    { key: "paid_days", label: "Paid Days", formatter: formatValue },
                    { key: "lop_days", label: "LOP Days", formatter: formatValue },
                    { key: "lop_deduction", label: "LOP Deduction", formatter: formatAmount },
                  ]
                    .filter((row) => !infoKeys.has(row.key))
                    .map((row) => (
                      <tr key={row.key} className="border-t border-border/60">
                        <td className="px-4 py-2">{row.label}</td>
                        <td className="px-4 py-2">{row.formatter(values[row.key])}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function getCurrentMonthKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parseIsoDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString([], { month: "long", year: "numeric" });
}

function formatAmount(val: any) {
  if (val === "" || val === null || val === undefined) return "-";
  const num = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(num)) return String(val || "-");
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatValue(val: any) {
  if (val === null || val === undefined || val === "") return "-";
  if (val instanceof Date) return val.toLocaleDateString();
  return String(val);
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
