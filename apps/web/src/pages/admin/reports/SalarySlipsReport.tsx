import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api";
import { toast } from "react-hot-toast";

type FieldType = "text" | "number" | "date";

type TemplateField = {
  key: string;
  label: string;
  type: FieldType;
  locked?: boolean;
  required?: boolean;
};

type EmployeeLite = {
  id: string;
  name: string;
  email?: string;
  employeeId?: string;
};

type SlipRow = {
  employeeId: string;
  values: Record<string, any>;
  hasSlip: boolean;
  slipId?: string;
  error?: string | null;
  generating?: boolean;
};

function normalizeValues(values: any) {
  if (!values) return {};
  if (values instanceof Map) return Object.fromEntries(values.entries());
  if (typeof values === "object") return { ...values };
  return {};
}

function formatNumberValue(val: any) {
  if (val === "" || val === null || val === undefined) return "-";
  if (typeof val !== "number") {
    const num = Number(val);
    if (!Number.isNaN(num)) {
      return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return String(val);
  }
  return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function SalarySlipsReportPage() {
  const today = new Date();
  const initialMonth = `${today.getFullYear()}-${String(
    today.getMonth() + 1
  ).padStart(2, "0")}`;

  const [month, setMonth] = useState<string>(initialMonth);
  const [monthOptions, setMonthOptions] = useState<string[]>([initialMonth]);
  const [loadingMonths, setLoadingMonths] = useState(true);

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [rows, setRows] = useState<SlipRow[]>([]);
  const rowsRef = useRef<SlipRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [loadingSlips, setLoadingSlips] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [bulkGenerating, setBulkGenerating] = useState(false);

  // Derive the list of months from company inception to now
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingMonths(true);
        const res = await api.get("/companies/profile");
        console.log("hdsgvds", res);
        if (!alive) return;
        const rawCreated =
          res?.data?.company?.incorporatedOn ||
          res?.data?.company?.foundedOn ||
          res?.data?.company?.createdAt ||
          res?.data?.company?.createdOn;
        const created =
          parseIsoDate(rawCreated) ||
          new Date(today.getFullYear(), today.getMonth(), 1);
        const list = enumerateMonths(created, today);
        if (list.length) {
          setMonthOptions(list);
          if (!list.includes(month)) {
            setMonth(list[list.length - 1]);
          }
        }
      } catch (e) {
        if (!alive) return;
        const fallback = enumerateMonths(
          new Date(today.getFullYear() - 1, today.getMonth(), 1),
          today
        );
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

  // Fetch employees once
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingEmployees(true);
        setError(null);
        const res = await api.get("/companies/employees");
        if (!alive) return;
        const list: EmployeeLite[] = (res.data.employees || []).map(
          (e: any) => ({
            id: e.id,
            name: e.name,
            email: e.email,
            employeeId: e.employeeId,
          })
        );
        setEmployees(list);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.response?.data?.error || "Failed to load employees");
      } finally {
        if (alive) setLoadingEmployees(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Load slips whenever the selection changes
  useEffect(() => {
    if (!employees.length) {
      setRows([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        setLoadingSlips(true);
        setError(null);
        let templateCaptured = false;
        const results = await Promise.all(
          employees.map(async (emp): Promise<SlipRow> => {
            try {
              const res = await api.get("/salary/slips", {
                params: { employeeId: emp.id, month },
              });
              if (!alive)
                return { employeeId: emp.id, values: {}, hasSlip: false };
              if (!templateCaptured) {
                const tpl = (res.data.template?.fields ||
                  []) as TemplateField[];
                setFields(tpl);
                templateCaptured = true;
              }
              const slip = res.data.slip || {};
              const normalized = normalizeValues(slip.values);
              return {
                employeeId: emp.id,
                values: normalized,
                hasSlip: Boolean(slip._id),
                slipId: slip._id,
                error: null,
              };
            } catch (e: any) {
              const message = e?.response?.data?.error || "Failed to load slip";
              return {
                employeeId: emp.id,
                values: {},
                hasSlip: false,
                error: message,
              };
            }
          })
        );
        if (!alive) return;
        setRows(results);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.response?.data?.error || "Failed to load salary slips");
      } finally {
        if (alive) setLoadingSlips(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [employees, month]);

  const employeeMap = useMemo(() => {
    const map = new Map<string, EmployeeLite>();
    for (const emp of employees) map.set(emp.id, emp);
    return map;
  }, [employees]);

  const dataRows = useMemo(() => {
    const map = new Map(rows.map((row) => [row.employeeId, row]));
    return employees.map(
      (emp) =>
        map.get(emp.id) || { employeeId: emp.id, values: {}, hasSlip: false }
    );
  }, [rows, employees]);

  const generatedCount = useMemo(
    () => rows.filter((r) => r.hasSlip).length,
    [rows]
  );

  async function refreshRow(
    employeeId: string,
    options: { silent?: boolean } = {}
  ) {
    const { silent = false } = options;
    try {
      const res = await api.get("/salary/slips", {
        params: { employeeId, month },
      });
      const slip = res.data.slip || {};
      const normalized = normalizeValues(slip.values);
      setRows((prev) =>
        prev.map((row) =>
          row.employeeId === employeeId
            ? {
                ...row,
                values: normalized,
                hasSlip: Boolean(slip._id),
                slipId: slip._id,
                error: null,
                generating: false,
              }
            : row
        )
      );
      const tplFields = (res.data.template?.fields || []) as TemplateField[];
      if (tplFields.length) setFields(tplFields);
      return true;
    } catch (e: any) {
      const message = e?.response?.data?.error || "Failed to refresh slip";
      setRows((prev) =>
        prev.map((row) =>
          row.employeeId === employeeId
            ? { ...row, error: message, generating: false }
            : row
        )
      );
      if (!silent) throw e;
      return false;
    }
  }

  function buildPayload(row: SlipRow) {
    const payload: Record<string, any> = {};
    for (const field of fields) {
      if (field.locked) continue;
      const raw = row.values?.[field.key];
      if (field.type === "number") {
        payload[field.key] =
          raw === "" || raw === null || raw === undefined ? "" : Number(raw);
      } else {
        payload[field.key] = raw ?? "";
      }
    }
    return payload;
  }

  async function generateSlip(
    employeeId: string,
    { silent = false }: { silent?: boolean } = {}
  ) {
    if (!fields.length) {
      if (!silent) toast.error("Salary template not configured");
      return false;
    }

    setRows((prev) =>
      prev.map((row) =>
        row.employeeId === employeeId
          ? { ...row, generating: true, error: null }
          : row
      )
    );

    const currentRow = rowsRef.current.find(
      (r) => r.employeeId === employeeId
    ) || {
      employeeId,
      values: {},
      hasSlip: false,
    };
    const payload = buildPayload(currentRow);

    try {
      await api.post("/salary/slips", {
        employeeId,
        month,
        values: payload,
      });
      if (!silent) toast.success("Salary slip saved");
      await refreshRow(employeeId, { silent: true });
      return true;
    } catch (e: any) {
      const message =
        e?.response?.data?.error || "Failed to generate salary slip";
      if (!silent) toast.error(message);
      setRows((prev) =>
        prev.map((row) =>
          row.employeeId === employeeId ? { ...row, error: message } : row
        )
      );
      return false;
    } finally {
      setRows((prev) =>
        prev.map((row) =>
          row.employeeId === employeeId ? { ...row, generating: false } : row
        )
      );
    }
  }

  async function handleGenerate(employeeId: string) {
    await generateSlip(employeeId);
  }

  async function handleGenerateAll() {
    if (!allowBulkGenerate) return;
    setBulkGenerating(true);
    let success = 0;
    let failure = 0;
    for (const emp of employees) {
      const ok = await generateSlip(emp.id, { silent: true });
      if (ok) success += 1;
      else failure += 1;
    }
    if (success) {
      toast.success(`${success} salary slips generated`);
    }
    if (failure) {
      toast.error(
        `${failure} employee${
          failure === 1 ? "" : "s"
        } failed. Check highlighted rows.`
      );
    }
    setBulkGenerating(false);
  }

  const monthLabel = useMemo(() => formatMonthLabel(month), [month]);

  const allowBulkGenerate = useMemo(() => {
    if (!month) return false;
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) return false;
    const selected = new Date(y, m - 1, 1);
    const current = new Date(today.getFullYear(), today.getMonth(), 1);
    if (selected > current) return false;
    if (
      selected.getFullYear() === current.getFullYear() &&
      selected.getMonth() === current.getMonth()
    ) {
      return today.getDate() >= 28;
    }
    return true;
  }, [month, today]);

  const bulkDisabledReason = useMemo(() => {
    if (!month) return "Select a month first";
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) return "Select a valid month";
    const selected = new Date(y, m - 1, 1);
    const current = new Date(today.getFullYear(), today.getMonth(), 1);
    if (selected > current) return "Cannot generate slips for future months";
    if (
      selected.getFullYear() === current.getFullYear() &&
      selected.getMonth() === current.getMonth() &&
      today.getDate() < 28
    ) {
      return "Bulk generation unlocks on the 28th";
    }
    return "";
  }, [month, today]);

  async function downloadExcel() {
    if (!fields.length) {
      toast.error("Salary template not configured");
      return;
    }
    try {
      setDownloadingExcel(true);
      const esc = (value: string) =>
        String(value ?? "-")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;");

      const headerCells = [
        "<th>Employee</th>",
        "<th>Status</th>",
        ...fields.map((f) => `<th>${esc(f.label)}</th>`),
      ].join("");

      const rowsHtml = dataRows
        .map((row) => {
          const emp = employeeMap.get(row.employeeId);
          const name = emp?.name || row.employeeId;
          const email = emp?.email ? ` (${emp.email})` : "";
          const status = row.hasSlip ? "Generated" : "Draft";
          const cells = fields
            .map((field) => {
              const value = row.values?.[field.key];
              if (field.type === "number") {
                return `<td>${esc(formatNumberValue(value))}</td>`;
              }
              const display =
                value && String(value).length ? String(value) : "-";
              return `<td>${esc(display)}</td>`;
            })
            .join("");
          return `
            <tr>
              <td>${esc(name + email)}</td>
              <td>${status}</td>
              ${cells}
            </tr>`;
        })
        .join("");

      const html = `<!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8" />
            <title>Salary Slips</title>
          </head>
          <body>
            <h2>Salary Slips (${esc(monthLabel)})</h2>
            <table border="1" cellspacing="0" cellpadding="4">
              <thead><tr>${headerCells}</tr></thead>
              <tbody>${
                rowsHtml || "<tr><td colspan=2>No data</td></tr>"
              }</tbody>
            </table>
          </body>
        </html>`;

      const blob = new Blob([html], {
        type: "application/vnd.ms-excel",
      });
      const filename = `salary-slips-${month || "current"}.xls`;
      downloadFileBlob(blob, filename);
    } finally {
      setDownloadingExcel(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Salary Slip Reports</h2>
          <p className="text-sm text-muted">
            Review slip data across all employees and generate missing months.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={loadingMonths}
            className="h-10 rounded-md border border-border bg-surface px-3"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(m)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={downloadExcel}
            disabled={downloadingExcel || !fields.length}
            className="h-10 rounded-md border border-border bg-white px-3 text-sm disabled:opacity-50"
          >
            {downloadingExcel ? "Preparing…" : "Download Excel"}
          </button>
          <button
            type="button"
            onClick={handleGenerateAll}
            disabled={!allowBulkGenerate || bulkGenerating || !employees.length}
            title={allowBulkGenerate ? "" : bulkDisabledReason}
            className="h-10 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {bulkGenerating
              ? "Generating…"
              : `Generate slips for ${monthLabel || "selected month"}`}
          </button>
          <div className="text-xs text-muted">
            Generated {generatedCount}/{employees.length}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {loadingEmployees || loadingSlips ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : employees.length === 0 ? (
        <div className="text-sm text-muted">No employees found.</div>
      ) : fields.length === 0 ? (
        <div className="text-sm text-muted">
          No salary template configured. Set up a template before generating
          slips.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface shadow-sm">
          <div className="overflow-auto">
            <table className="min-w-[960px] w-full text-sm">
              <thead className="bg-muted/20 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  {fields.map((field) => (
                    <th key={field.key} className="px-4 py-3 font-medium">
                      {field.label}
                      {field.locked ? (
                        <span className="ml-1 text-[10px] uppercase text-muted">
                          Locked
                        </span>
                      ) : null}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row) => {
                  const emp = employeeMap.get(row.employeeId);
                  const name = emp?.name || row.employeeId;
                  const email = emp?.email || emp?.employeeId;
                  const status = row.hasSlip ? "Generated" : "Draft";
                  const statusTone = row.hasSlip
                    ? "bg-success/10 text-success border-success/30"
                    : "bg-warning/10 text-warning border-warning/30";
                  return (
                    <tr
                      key={row.employeeId}
                      className="border-t border-border/60 align-top"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{name}</div>
                        {email && (
                          <div className="text-xs text-muted">{email}</div>
                        )}
                        {row.error && (
                          <div className="text-xs text-error mt-1">
                            {row.error}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusTone}`}
                        >
                          {status}
                        </span>
                      </td>
                      {fields.map((field) => {
                        const value = row.values?.[field.key];
                        const display =
                          field.type === "number"
                            ? formatNumberValue(value)
                            : value && String(value).length
                            ? String(value)
                            : "-";
                        return (
                          <td
                            key={field.key}
                            className="px-4 py-3 whitespace-nowrap"
                          >
                            {display}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleGenerate(row.employeeId)}
                          disabled={row.generating}
                          className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {row.generating ? "Working…" : "Generate"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
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

function downloadFileBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
