import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";

type FieldType = "text" | "number" | "date";

type TemplateField = {
  key: string;
  label: string;
  type: FieldType;
  locked?: boolean;
  required?: boolean;
  order?: number;
};

type EmployeeLite = {
  id: string;
  name: string;
  email?: string;
  employeeId?: string;
  hasTds?: boolean;
};

type SlipRow = {
  employeeId: string;
  values: Record<string, any>;
  hasSlip: boolean;
  slipId?: string;
  error?: string | null;
  generating?: boolean;
};

type LopAdjustment = {
  employeeId: string;
  taken: number;
  available: number;
  deducted: number;
  maxDeductable: number;
  carryAfter: number;
};

const HIDE_LOP_FIELD_KEYS = new Set([
  "lop_days",
  "lop_deduction",
  "uan",
  "pan_number",
  "pay_date",
  "date_of_joining",
  "designation",
]);

function normalizeValues(values: any) {
  if (!values) return {};
  if (values instanceof Map) return Object.fromEntries(values.entries());
  if (typeof values === "object") return { ...values };
  return {};
}

function sortTemplateFields(list: TemplateField[]) {
  return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function fmtNumber(val: any) {
  const num = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(num)) return "0";
  if (Math.abs(num % 1) < 1e-4) return String(Math.round(num));
  return num.toFixed(2);
}

function fmtAmount(val: any) {
  const num = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  const navigate = useNavigate();
  const [month, setMonth] = useState<string>("");
  const [monthOptions, setMonthOptions] = useState<string[]>([]);
  const [loadingMonths, setLoadingMonths] = useState(true);

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [rows, setRows] = useState<SlipRow[]>([]);
  const [tdsNotes, setTdsNotes] = useState<Record<string, string>>({});
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
  const [lopAdjustments, setLopAdjustments] = useState<
    Record<string, LopAdjustment>
  >({});
  const [lopValues, setLopValues] = useState<Record<string, string>>({});
  const [lopLoading, setLopLoading] = useState(false);
  const [lopError, setLopError] = useState<string | null>(null);
  const [lopSaving, setLopSaving] = useState<Record<string, boolean>>({});

  // Derive the list of months from company inception to the last completed month
  useEffect(() => {
    let alive = true;
    const lastCompletedMonthDate = getLastCompletedMonthDate(today);
    const fallbackStart = new Date(lastCompletedMonthDate);
    fallbackStart.setFullYear(fallbackStart.getFullYear() - 1);
    (async () => {
      try {
        setLoadingMonths(true);
        const res = await api.get("/companies/profile");
        if (!alive) return;
        const rawCreated =
          res?.data?.company?.incorporatedOn ||
          res?.data?.company?.foundedOn ||
          res?.data?.company?.createdAt ||
          res?.data?.company?.createdOn;
        const created = parseIsoDate(rawCreated);
        const rangeStart =
          created && created <= lastCompletedMonthDate
            ? created
            : fallbackStart;
        const list = enumerateMonths(rangeStart, lastCompletedMonthDate);
        if (!alive) return;
        setMonthOptions(list);
        if (list.length) {
          if (!list.includes(month)) {
            setMonth(list[list.length - 1]);
          }
        } else {
          setMonth("");
        }
      } catch (e) {
        if (!alive) return;
        const fallback = enumerateMonths(fallbackStart, lastCompletedMonthDate);
        setMonthOptions(fallback);
        if (fallback.length) {
          if (!fallback.includes(month)) {
            setMonth(fallback[fallback.length - 1]);
          }
        } else {
          setMonth("");
        }
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
            hasTds: !!e.hasTds,
          }),
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
    if (!month) {
      setRows([]);
      setError(null);
      setLoadingSlips(false);
      setTdsNotes({});
      setLopAdjustments({});
      setLopValues({});
      return;
    }
    if (!employees.length) {
      setRows([]);
      setLoadingSlips(false);
      setTdsNotes({});
      setLopAdjustments({});
      setLopValues({});
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
                setFields(sortTemplateFields(tpl));
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
          }),
        );
        if (!alive) return;
        setRows(results);
        const noteMap: Record<string, string> = {};
        for (const row of results) {
          const rawNote = row.values?.tds_note;
          noteMap[row.employeeId] =
            typeof rawNote === "string"
              ? rawNote
              : rawNote
                ? String(rawNote)
                : "";
        }
        setTdsNotes(noteMap);
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
        map.get(emp.id) || { employeeId: emp.id, values: {}, hasSlip: false },
    );
  }, [rows, employees]);

  const generatedCount = useMemo(
    () => rows.filter((r) => r.hasSlip).length,
    [rows],
  );

  const visibleFields = useMemo(
    () => fields.filter((field) => !HIDE_LOP_FIELD_KEYS.has(field.key)),
    [fields],
  );

  async function refreshRow(
    employeeId: string,
    options: { silent?: boolean } = {},
  ) {
    const { silent = false } = options;
    try {
      const res = await api.get("/salary/slips", {
        params: { employeeId, month },
      });
      const slip = res.data.slip || {};
      const normalized = normalizeValues(slip.values);
      const noteValue =
        typeof normalized?.tds_note === "string"
          ? normalized.tds_note
          : normalized?.tds_note
            ? String(normalized.tds_note)
            : "";
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
            : row,
        ),
      );
      const tplFields = (res.data.template?.fields || []) as TemplateField[];
      if (tplFields.length) setFields(sortTemplateFields(tplFields));
      setTdsNotes((prev) => ({ ...prev, [employeeId]: noteValue }));
      return true;
    } catch (e: any) {
      const message = e?.response?.data?.error || "Failed to refresh slip";
      setRows((prev) =>
        prev.map((row) =>
          row.employeeId === employeeId
            ? { ...row, error: message, generating: false }
            : row,
        ),
      );
      if (!silent) throw e;
      return false;
    }
  }

  // Load LOP adjustments for the month
  useEffect(() => {
    if (!month || !employees.length) {
      setLopAdjustments({});
      setLopValues({});
      setLopError(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        setLopLoading(true);
        setLopError(null);
        const res = await api.get("/unpaid-leaves/adjustments", {
          params: { month },
        });
        if (!alive) return;
        const rows: LopAdjustment[] = res?.data?.rows || [];
        const map: Record<string, LopAdjustment> = {};
        const nextValues: Record<string, string> = {};
        for (const row of rows) {
          map[row.employeeId] = row;
          nextValues[row.employeeId] = String(row.deducted ?? 0);
        }
        setLopAdjustments(map);
        setLopValues(nextValues);
      } catch (e: any) {
        if (!alive) return;
        setLopAdjustments({});
        setLopValues({});
        setLopError(
          e?.response?.data?.error || "Failed to load LOP adjustments",
        );
      } finally {
        if (alive) setLopLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [month, employees.length]);

  async function saveLopDeduction(employeeId: string) {
    const raw = lopValues[employeeId] ?? "0";
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0) {
      toast.error("Enter a valid LOP deduction (>= 0)");
      return;
    }
    const info = lopAdjustments[employeeId];
    if (info && numeric > info.maxDeductable + 1e-6) {
      toast.error(`Cannot deduct more than ${info.maxDeductable}`);
      return;
    }
    try {
      setLopSaving((prev) => ({ ...prev, [employeeId]: true }));
      await api.post("/unpaid-leaves/adjustments", {
        employeeId,
        month,
        deducted: numeric,
      });
      toast.success("LOP deduction updated");
      // refresh adjustments and slip row for consistency
      const res = await api.get("/unpaid-leaves/adjustments", {
        params: { month },
      });
      const rows: LopAdjustment[] = res?.data?.rows || [];
      const map: Record<string, LopAdjustment> = {};
      const nextValues: Record<string, string> = {};
      for (const row of rows) {
        map[row.employeeId] = row;
        nextValues[row.employeeId] = String(row.deducted ?? 0);
      }
      setLopAdjustments(map);
      setLopValues(nextValues);
      refreshRow(employeeId, { silent: true });
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update LOP deduction";
      toast.error(msg);
    } finally {
      setLopSaving((prev) => ({ ...prev, [employeeId]: false }));
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
    { silent = false }: { silent?: boolean } = {},
  ) {
    if (!month) {
      if (!silent)
        toast.error("Select a completed month before generating salary slips");
      return false;
    }
    if (!fields.length) {
      if (!silent) toast.error("Salary template not configured");
      return false;
    }

    setRows((prev) =>
      prev.map((row) =>
        row.employeeId === employeeId
          ? { ...row, generating: true, error: null }
          : row,
      ),
    );

    const currentRow = rowsRef.current.find(
      (r) => r.employeeId === employeeId,
    ) || {
      employeeId,
      values: {},
      hasSlip: false,
    };
    const payload = buildPayload(currentRow);
    const noteValue = tdsNotes[employeeId] ?? "";
    const hasTdsFlag = employeeMap.get(employeeId)?.hasTds;
    if (hasTdsFlag || noteValue) {
      payload.tds_note = noteValue;
    }

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
          row.employeeId === employeeId ? { ...row, error: message } : row,
        ),
      );
      return false;
    } finally {
      setRows((prev) =>
        prev.map((row) =>
          row.employeeId === employeeId ? { ...row, generating: false } : row,
        ),
      );
    }
  }

  async function handleGenerate(employeeId: string) {
    await generateSlip(employeeId);
  }

  async function handleGenerateAll() {
    if (!month) {
      toast.error("Select a completed month before generating salary slips");
      return;
    }
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
        } failed. Check highlighted rows.`,
      );
    }
    setBulkGenerating(false);
  }

  const monthLabel = useMemo(() => formatMonthLabel(month), [month]);

  async function downloadExcel() {
    if (!month) {
      toast.error("Select a completed month before downloading salary slips");
      return;
    }
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
        ...visibleFields.map((f) => `<th>${esc(f.label)}</th>`),
      ].join("");

      const rowsHtml = dataRows
        .map((row) => {
          const emp = employeeMap.get(row.employeeId);
          const name = emp?.name || row.employeeId;
          const email = emp?.email ? ` (${emp.email})` : "";
          const status = row.hasSlip ? "Generated" : "Draft";
          const cells = visibleFields
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
    <div className="space-y-6 w-full max-w-full">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Salary Slip Reports</h2>
          <p className="text-sm text-muted-foreground">
            Review slip data across all employees and generate missing months.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={month || ""}
            onChange={(e) => setMonth(e.target.value)}
            disabled={loadingMonths || !monthOptions.length}
            className="h-10 rounded-md border border-border bg-surface px-3"
          >
            {monthOptions.length ? (
              monthOptions.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))
            ) : (
              <option value="">
                {loadingMonths ? "Loading months…" : "No completed months yet"}
              </option>
            )}
          </select>
          {/* <button
            type="button"
            onClick={downloadExcel}
            disabled={downloadingExcel || !fields.length || !month}
            className="h-10 rounded-md border border-border bg-white px-3 text-sm disabled:opacity-50"
          >
            {downloadingExcel ? "Preparing…" : "Download Excel"}
          </button> */}
          <button
            type="button"
            onClick={handleGenerateAll}
            disabled={
              bulkGenerating ||
              !employees.length ||
              generatedCount === employees.length ||
              !month
            }
            title={
              !month
                ? "Select a completed month before generating salary slips"
                : generatedCount === employees.length
                  ? "All salary slips are already generated"
                  : undefined
            }
            className="h-10 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {bulkGenerating
              ? "Generating…"
              : monthLabel
                ? `Generate slips for ${monthLabel}`
                : "Select a completed month"}
          </button>
          <div className="text-xs text-muted-foreground">
            Generated {generatedCount}/{employees.length}
          </div>
        </div>
      </div>

      {!loadingMonths && !monthOptions.length && (
        <div className="text-xs text-muted-foreground">
          Salary slips are available once a month has completed. Check back
          after the next month ends.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}
      {lopError && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
          {lopError}
        </div>
      )}

      {loadingEmployees || loadingSlips ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !month ? (
        <div className="text-sm text-muted-foreground">
          Salary slips can only be generated for completed months.
        </div>
      ) : employees.length === 0 ? (
        <div className="text-sm text-muted-foreground">No employees found.</div>
      ) : fields.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No salary template configured. Set up a template before generating
          slips.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[170vw] w-full text-sm">
              <thead className="bg-muted/20 text-left">
                <tr>
                  <th className="w-[10%] px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  {visibleFields.map((field) => (
                    <th key={field.key} className="px-4 py-3 font-medium">
                      {field.label}
                      {field.locked ? (
                        <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                          Locked
                        </span>
                      ) : null}
                    </th>
                  ))}
                  <th className="w-[13%] px-4 py-3 font-medium">
                    LOP Deduction
                  </th>
                  <th className="w-[12%] px-4 py-3 font-medium">TDS Note</th>
                  <th className="w-[7%] px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row) => {
                  const emp = employeeMap.get(row.employeeId);
                  const name = emp?.name;
                  const email = emp?.email;
                  const empId = emp?.employeeId;
                  const status = row.hasSlip ? "Generated" : "Draft";
                  const statusTone = row.hasSlip
                    ? "bg-success/10 text-success border-success/30"
                    : "bg-warning/10 text-warning border-warning/30";
                  const lopInfo = lopAdjustments[row.employeeId];
                  const lopValue = lopValues[row.employeeId] ?? "0";
                  const lopDirty =
                    Number(lopValue || 0) !== Number(lopInfo?.deducted || 0);
                  const lopDays = Number(row.values?.lop_days || 0);
                  const lopAmount = Number(row.values?.lop_deduction || 0);
                  const unpaidTaken = Number(row.values?.unpaid_taken || 0);
                  return (
                    <tr
                      key={row.employeeId}
                      className="border-t border-border/60 align-top"
                    >
                      <td className="px-4 py-3 align-top break-words">
                        <div className="font-medium">{name}</div>
                        {empId && (
                          <div className="text-xs text-muted-foreground">
                            {empId}
                          </div>
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
                      {visibleFields.map((field) => {
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
                            className="px-4 py-3 align-top break-words"
                          >
                            {display}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 align-top">
                        <div className="text-xs leading-tight w-[260px] space-y-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>
                              LOP: <strong>{fmtNumber(lopDays)}</strong>
                              {lopAmount ? ` (${fmtAmount(lopAmount)})` : ""}
                            </span>
                            {/* <span>Unpaid: {fmtNumber(unpaidTaken)}</span> */}
                            <span>
                              Avail:{" "}
                              {lopInfo ? fmtNumber(lopInfo.available) : "—"}
                            </span>
                          </div>
                          {lopInfo ? (
                            <div className="flex justify-between">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  Adjust
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.25"
                                  value={lopValue}
                                  onChange={(e) =>
                                    setLopValues((prev) => ({
                                      ...prev,
                                      [row.employeeId]: e.target.value,
                                    }))
                                  }
                                  className="h-8 w-20 rounded-md border border-border bg-bg px-2 text-sm"
                                />
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                  Max {fmtNumber(lopInfo.maxDeductable)}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => saveLopDeduction(row.employeeId)}
                                disabled={
                                  lopSaving[row.employeeId] || !lopDirty
                                }
                                className="h-8 rounded-md bg-primary px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
                              >
                                {lopSaving[row.employeeId] ? "Saving…" : "Save"}
                              </button>
                            </div>
                          ) : lopLoading ? (
                            <div className="text-xs text-muted-foreground">
                              Loading…
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              No unpaid leaves this month.
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {emp?.hasTds ? (
                          <div className="space-y-1 w-[220px]">
                            <label className="text-[10px] font-semibold text-muted-foreground">
                              TDS Note
                            </label>
                            <input
                              type="text"
                              placeholder="Add note for TDS"
                              value={tdsNotes[row.employeeId] ?? ""}
                              onChange={(event) =>
                                setTdsNotes((prev) => ({
                                  ...prev,
                                  [row.employeeId]: event.target.value,
                                }))
                              }
                              className="w-full rounded-md border border-border px-2 py-1 text-xs"
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            N/A
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => handleGenerate(row.employeeId)}
                            disabled={row.generating}
                            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {row.generating ? "Working…" : "Generate"}
                          </button>
                        </div>
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

function getLastCompletedMonthDate(reference = new Date()) {
  const result = new Date(reference.getFullYear(), reference.getMonth(), 1);
  result.setMonth(result.getMonth() - 1);
  return result;
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
