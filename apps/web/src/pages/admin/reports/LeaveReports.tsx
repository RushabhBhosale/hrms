import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";

type LeaveType = "CASUAL" | "PAID" | "UNPAID" | "SICK";
type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";

type LeaveRecord = {
  _id: string;
  employee: { _id: string; name: string } | string;
  type: LeaveType;
  fallbackType?: LeaveType | "UNPAID" | null;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  reason?: string;
  allocations?: {
    paid?: number;
    casual?: number;
    sick?: number;
    unpaid?: number;
  };
};

type EmployeeLite = {
  id: string;
  name: string;
  email?: string;
};

type Portion = {
  paid: number;
  casual: number;
  sick: number;
  unpaid: number;
  total: number;
};

type SummaryRow = Portion & { employeeId: string };

type DetailRow = {
  leaveId: string;
  employeeId: string;
  status: LeaveStatus;
  type: LeaveType;
  fallbackType?: LeaveRecord["fallbackType"];
  startDate: string;
  endDate: string;
  totalDays: number;
  portion?: Portion;
  reason?: string;
};

export default function LeaveReportsPage() {
  const today = new Date();
  const initialMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState<string>(initialMonth);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [leavesRes, employeesRes] = await Promise.all([
          api.get("/leaves/company"),
          api.get("/companies/employees"),
        ]);
        if (!alive) return;
        const leaveRows = (leavesRes.data.leaves || []) as LeaveRecord[];
        setLeaves(leaveRows);
        const employeeRows = (employeesRes.data.employees || []).map((e: any) => ({
          id: e.id,
          name: e.name,
          email: e.email,
        }));
        setEmployees(employeeRows);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.response?.data?.error || "Failed to load leave data");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const employeeMap = useMemo(() => {
    const map = new Map<string, EmployeeLite>();
    for (const emp of employees) map.set(emp.id, emp);
    return map;
  }, [employees]);

  const { summaryRows, summaryTotals, detailRows } = useMemo(() => {
    const summaries = new Map<string, Portion>();
    const details: DetailRow[] = [];

    for (const leave of leaves) {
      const employeeId = extractEmployeeId(leave.employee);
      if (!employeeId) continue;

      const distribution = distributeLeaveAcrossMonths(leave);
      const portion = distribution[month];
      const workingDaysInMonth = countWorkingDaysInMonth(leave, month);

      if (leave.status === "APPROVED" && portion && portion.total > 0) {
        const current = summaries.get(employeeId) || {
          paid: 0,
          casual: 0,
          sick: 0,
          unpaid: 0,
          total: 0,
        };
        current.paid += portion.paid;
        current.casual += portion.casual;
        current.sick += portion.sick;
        current.unpaid += portion.unpaid;
        current.total += portion.total;
        summaries.set(employeeId, current);
      }

      if ((portion && portion.total > 0) || workingDaysInMonth > 0) {
        details.push({
          leaveId: leave._id,
          employeeId,
          status: leave.status,
          type: leave.type,
          fallbackType: leave.fallbackType,
          startDate: leave.startDate,
          endDate: leave.endDate,
          totalDays: portion?.total || workingDaysInMonth,
          portion,
          reason: leave.reason,
        });
      }
    }

    const summaryList: SummaryRow[] = Array.from(summaries.entries()).map(
      ([employeeId, portion]) => ({ employeeId, ...portion })
    );

    summaryList.sort((a, b) => {
      const nameA = employeeMap.get(a.employeeId)?.name || "";
      const nameB = employeeMap.get(b.employeeId)?.name || "";
      return nameA.localeCompare(nameB);
    });

    const totals = summaryList.reduce(
      (acc, row) => ({
        paid: acc.paid + row.paid,
        casual: acc.casual + row.casual,
        sick: acc.sick + row.sick,
        unpaid: acc.unpaid + row.unpaid,
        total: acc.total + row.total,
      }),
      { paid: 0, casual: 0, sick: 0, unpaid: 0, total: 0 }
    );

    details.sort((a, b) =>
      new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );

    return { summaryRows: summaryList, summaryTotals: totals, detailRows: details };
  }, [leaves, month, employeeMap]);

  const filteredSummary = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return summaryRows;
    return summaryRows.filter((row) => {
      const emp = employeeMap.get(row.employeeId);
      if (!emp) return false;
      return (
        emp.name.toLowerCase().includes(term) ||
        (emp.email || "").toLowerCase().includes(term)
      );
    });
  }, [summaryRows, employeeMap, search]);

  const filteredDetails = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return detailRows;
    return detailRows.filter((row) => {
      const emp = employeeMap.get(row.employeeId);
      if (!emp) return false;
      return (
        emp.name.toLowerCase().includes(term) ||
        (emp.email || "").toLowerCase().includes(term)
      );
    });
  }, [detailRows, employeeMap, search]);

  const monthLabel = useMemo(() => formatMonthLabel(month), [month]);

  async function downloadExcel() {
    try {
      setDownloading(true);
      const esc = (value: string) =>
        String(value ?? "-").replace(/&/g, "&amp;").replace(/</g, "&lt;");

      const summaryHeader =
        "<tr><th>Employee</th><th>Paid</th><th>Casual</th><th>Sick</th><th>Unpaid</th><th>Total Days</th></tr>";
      const summaryRowsHtml = filteredSummary
        .map((row) => {
          const emp = employeeMap.get(row.employeeId);
          const name = emp?.name || row.employeeId;
          const email = emp?.email ? ` (${emp.email})` : "";
          return `
            <tr>
              <td>${esc(name + email)}</td>
              <td>${fmtNumber(row.paid)}</td>
              <td>${fmtNumber(row.casual)}</td>
              <td>${fmtNumber(row.sick)}</td>
              <td>${fmtNumber(row.unpaid)}</td>
              <td>${fmtNumber(row.total)}</td>
            </tr>`;
        })
        .join("");

      const detailHeader =
        "<tr><th>Employee</th><th>Type</th><th>Status</th><th>From</th><th>To</th><th>Days</th><th>Breakdown</th><th>Reason</th></tr>";
      const detailRowsHtml = filteredDetails
        .map((row) => {
          const emp = employeeMap.get(row.employeeId);
          const name = emp?.name || row.employeeId;
          const email = emp?.email ? ` (${emp.email})` : "";
          return `
            <tr>
              <td>${esc(name + email)}</td>
              <td>${esc(formatLeaveType(row.type))}</td>
              <td>${esc(row.status)}</td>
              <td>${esc(formatDate(row.startDate))}</td>
              <td>${esc(formatDate(row.endDate))}</td>
              <td>${fmtNumber(row.totalDays)}</td>
              <td>${esc(formatBreakdown(row.portion, row.type))}</td>
              <td>${esc(row.reason || "-")}</td>
            </tr>`;
        })
        .join("");

      const html = `<!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8" />
            <title>Leave Report</title>
          </head>
          <body>
            <h2>Leave Summary (${esc(monthLabel)})</h2>
            <table border="1" cellspacing="0" cellpadding="4">
              <thead>${summaryHeader}</thead>
              <tbody>${summaryRowsHtml || "<tr><td colspan=6>No data</td></tr>"}</tbody>
            </table>
            <br />
            <h2>Leave Details (${esc(monthLabel)})</h2>
            <table border="1" cellspacing="0" cellpadding="4">
              <thead>${detailHeader}</thead>
              <tbody>${detailRowsHtml || "<tr><td colspan=8>No data</td></tr>"}</tbody>
            </table>
          </body>
        </html>`;

      const blob = new Blob([html], {
        type: "application/vnd.ms-excel",
      });
      const filename = `leave-report-${month || "current"}.xls`;
      downloadFileBlob(blob, filename);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Leave Reports</h2>
          <p className="text-sm text-muted">
            Track approved leave utilisation across the company by month.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-10 rounded-md border border-border bg-surface px-3"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter employees…"
            className="h-10 w-52 rounded-md border border-border bg-surface px-3"
          />
          <button
            type="button"
            onClick={downloadExcel}
            disabled={downloading}
            className="h-10 rounded-md border border-border bg-white px-3 text-sm disabled:opacity-50"
          >
            {downloading ? "Preparing…" : "Download Excel"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-surface shadow-sm">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Summary by employee</h3>
              <div className="flex gap-4 text-xs text-muted">
                <span>Paid: {fmtNumber(summaryTotals.paid)}</span>
                <span>Casual: {fmtNumber(summaryTotals.casual)}</span>
                <span>Sick: {fmtNumber(summaryTotals.sick)}</span>
                <span>Unpaid: {fmtNumber(summaryTotals.unpaid)}</span>
                <span>Total: {fmtNumber(summaryTotals.total)}</span>
              </div>
            </header>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/20 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Paid</th>
                    <th className="px-4 py-3 font-medium">Casual</th>
                    <th className="px-4 py-3 font-medium">Sick</th>
                    <th className="px-4 py-3 font-medium">Unpaid</th>
                    <th className="px-4 py-3 font-medium">Total Days</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSummary.length ? (
                    filteredSummary.map((row) => {
                      const emp = employeeMap.get(row.employeeId);
                      const name = emp?.name || row.employeeId;
                      const email = emp?.email;
                      return (
                        <tr key={row.employeeId} className="border-t border-border/60">
                          <td className="px-4 py-3">
                            <div className="font-medium">{name}</div>
                            {email && (
                              <div className="text-xs text-muted">{email}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">{fmtNumber(row.paid)}</td>
                          <td className="px-4 py-3">{fmtNumber(row.casual)}</td>
                          <td className="px-4 py-3">{fmtNumber(row.sick)}</td>
                          <td className="px-4 py-3">{fmtNumber(row.unpaid)}</td>
                          <td className="px-4 py-3 font-medium">{fmtNumber(row.total)}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="px-4 py-6 text-center text-sm text-muted" colSpan={6}>
                        No approved leaves recorded for this month.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-surface shadow-sm">
            <header className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Leave details</h3>
              <p className="text-xs text-muted">
                Includes all leaves that overlap the selected month, regardless of status.
              </p>
            </header>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/20 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Dates</th>
                    <th className="px-4 py-3 font-medium">Days</th>
                    <th className="px-4 py-3 font-medium">Breakdown</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDetails.length ? (
                    filteredDetails.map((row) => {
                      const emp = employeeMap.get(row.employeeId);
                      const name = emp?.name || row.employeeId;
                      const breakdown = formatBreakdown(row.portion, row.type);
                      const dates = `${formatDate(row.startDate)} → ${formatDate(row.endDate)}`;
                      return (
                        <tr key={row.leaveId} className="border-t border-border/60">
                          <td className="px-4 py-3">
                            <div className="font-medium">{name}</div>
                            {emp?.email && (
                              <div className="text-xs text-muted">{emp.email}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">{formatLeaveType(row.type)}</td>
                          <td className="px-4 py-3">
                            <StatusPill status={row.status} />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">{dates}</td>
                          <td className="px-4 py-3 font-medium">
                            {fmtNumber(row.totalDays)}
                          </td>
                          <td className="px-4 py-3">{breakdown}</td>
                          <td className="px-4 py-3 max-w-xs truncate" title={row.reason || "-"}>
                            {row.reason || "-"}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="px-4 py-6 text-center text-sm text-muted" colSpan={7}>
                        No leave applications overlap this month.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
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

function extractEmployeeId(emp: LeaveRecord["employee"]): string | null {
  if (!emp) return null;
  if (typeof emp === "string") return emp;
  return emp._id || null;
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function countWorkingDaysInMonth(leave: LeaveRecord, month: string) {
  const start = startOfDay(new Date(leave.startDate));
  const end = startOfDay(new Date(leave.endDate));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return 0;
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0);
  const from = start > monthStart ? start : monthStart;
  const to = end < monthEnd ? end : monthEnd;
  let count = 0;
  const cursor = new Date(from);
  while (cursor <= to) {
    if (!isWeekend(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function distributeLeaveAcrossMonths(leave: LeaveRecord): Record<string, Portion> {
  const start = startOfDay(new Date(leave.startDate));
  const end = startOfDay(new Date(leave.endDate));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return {};
  const allocations = leave.allocations || {};
  const countsByMonth: Record<string, number> = {};
  const cursor = new Date(start);
  while (cursor <= end) {
    if (!isWeekend(cursor)) {
      const key = monthKey(cursor);
      countsByMonth[key] = (countsByMonth[key] || 0) + 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  const totalWorkingDays = Object.values(countsByMonth).reduce(
    (sum, n) => sum + n,
    0
  );
  const totalAllocated =
    Number(allocations.paid || 0) +
    Number(allocations.casual || 0) +
    Number(allocations.sick || 0) +
    Number(allocations.unpaid || 0);

  if (!totalWorkingDays) {
    if (!totalAllocated) return {};
    const key = monthKey(start);
    return {
      [key]: {
        paid: Number(allocations.paid || 0),
        casual: Number(allocations.casual || 0),
        sick: Number(allocations.sick || 0),
        unpaid: Number(allocations.unpaid || 0),
        total: totalAllocated,
      },
    };
  }

  const portions: Record<string, Portion> = {};
  for (const [key, workingDays] of Object.entries(countsByMonth)) {
    const ratio = workingDays / totalWorkingDays;
    const paid = Number(allocations.paid || 0) * ratio;
    const casual = Number(allocations.casual || 0) * ratio;
    const sick = Number(allocations.sick || 0) * ratio;
    const unpaid = Number(allocations.unpaid || 0) * ratio;
    portions[key] = {
      paid,
      casual,
      sick,
      unpaid,
      total: paid + casual + sick + unpaid,
    };
  }
  return portions;
}

function fmtNumber(n: number) {
  const rounded = Math.round(n * 100) / 100;
  if (Number.isNaN(rounded)) return "0";
  if (Math.abs(rounded % 1) < 1e-4) return String(Math.round(rounded));
  return rounded.toFixed(2);
}

function formatMonthLabel(month: string) {
  if (!month) return "";
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function formatDate(input: string) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

function formatLeaveType(type: LeaveType) {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

function formatBreakdown(portion: Portion | undefined, type: LeaveType) {
  if (!portion || portion.total <= 0) return "—";
  const parts: string[] = [];
  if (portion.paid > 0.001) parts.push(`Paid ${fmtNumber(portion.paid)}`);
  if (portion.casual > 0.001) parts.push(`Casual ${fmtNumber(portion.casual)}`);
  if (portion.sick > 0.001) parts.push(`Sick ${fmtNumber(portion.sick)}`);
  if (portion.unpaid > 0.001) parts.push(`Unpaid ${fmtNumber(portion.unpaid)}`);
  if (parts.length) return parts.join(", ");
  return formatLeaveType(type);
}

function StatusPill({ status }: { status: LeaveStatus }) {
  const colors: Record<LeaveStatus, string> = {
    APPROVED: "bg-success/10 text-success border-success/30",
    PENDING: "bg-warning/10 text-warning border-warning/30",
    REJECTED: "bg-error/10 text-error border-error/30",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colors[status]}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
