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
  isAuto?: boolean;
  autoPenalty?: string;
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

type AdjustmentInfo = {
  deducted: number;
};

type SummaryRow = Portion & { employeeId: string; deducted: number };

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
  isAuto?: boolean;
};

type ViewMode = "MONTH" | "ALL";

type AttendanceSummaryMap = Record<
  string,
  {
    leaveDays: number;
    halfDayLeaves?: number;
  }
>;

export default function LeaveReportsPage() {
  const today = new Date();
  const initialMonth = `${today.getFullYear()}-${String(
    today.getMonth() + 1,
  ).padStart(2, "0")}`;
  const [month, setMonth] = useState<string>(initialMonth);
  const [viewMode, setViewMode] = useState<ViewMode>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [attendanceSummary, setAttendanceSummary] =
    useState<AttendanceSummaryMap>({});
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<
    Record<string, AdjustmentInfo>
  >({});
  const [adjustmentsLoading, setAdjustmentsLoading] = useState(false);
  const [adjustmentsError, setAdjustmentsError] = useState<string | null>(null);

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
        const employeeRows = (employeesRes.data.employees || []).map(
          (e: any) => ({
            id: e.id,
            name: e.name,
            email: e.email,
          }),
        );
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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setAttendanceLoading(true);
        setAttendanceError(null);
        const params: Record<string, string> = {};
        if (viewMode === "ALL") {
          params.scope = "all";
        } else if (viewMode === "MONTH" && month) {
          params.month = month;
        }
        const res = await api.get("/attendance/company/report", {
          params,
        });
        if (!alive) return;
        const summaries = res?.data?.summaries || res?.data?.report || [];
        const next: AttendanceSummaryMap = {};
        for (const entry of summaries) {
          if (!entry) continue;
          const employeeId =
            entry.employeeId ||
            entry.employee?.id ||
            entry.employee?._id ||
            entry.employee;
          if (!employeeId) continue;
          const leaveDays = Number(entry.leaveDays);
          const halfDayLeaves =
            entry.halfDayLeaves !== undefined
              ? Number(entry.halfDayLeaves)
              : undefined;
          next[String(employeeId)] = {
            leaveDays: Number.isFinite(leaveDays) ? leaveDays : 0,
            halfDayLeaves:
              halfDayLeaves !== undefined && Number.isFinite(halfDayLeaves || 0)
                ? halfDayLeaves
                : undefined,
          };
        }
        setAttendanceSummary(next);
      } catch (e: any) {
        if (!alive) return;
        setAttendanceSummary({});
        setAttendanceError(
          e?.response?.data?.error ||
            "Failed to load attendance-adjusted leave summary",
        );
      } finally {
        if (alive) setAttendanceLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [viewMode, month]);

  useEffect(() => {
    if (viewMode !== "MONTH") {
      let alive = true;
      (async () => {
        try {
          setAdjustmentsLoading(true);
          setAdjustmentsError(null);
          const res = await api.get("/unpaid-leaves/adjustments", {
            params: { scope: "all" },
          });
          console.log("ckdec", res);
          if (!alive) return;
          const rows = res?.data?.rows || [];
          const map: Record<string, AdjustmentInfo> = {};
          for (const row of rows) {
            map[row.employeeId] = { deducted: Number(row.deducted || 0) };
          }
          setAdjustments(map);
        } catch (e: any) {
          if (!alive) return;
          setAdjustments({});
          setAdjustmentsError(
            e?.response?.data?.error ||
              "Failed to load unpaid leave deductions",
          );
        } finally {
          if (alive) setAdjustmentsLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }
    let alive = true;
    (async () => {
      try {
        setAdjustmentsLoading(true);
        setAdjustmentsError(null);
        const res = await api.get("/unpaid-leaves/adjustments", {
          params: { month },
        });
        if (!alive) return;
        const rows = res?.data?.rows || [];
        const map: Record<string, AdjustmentInfo> = {};
        for (const row of rows) {
          map[row.employeeId] = { deducted: Number(row.deducted || 0) };
        }
        setAdjustments(map);
      } catch (e: any) {
        if (!alive) return;
        setAdjustments({});
        setAdjustmentsError(
          e?.response?.data?.error || "Failed to load unpaid leave deductions",
        );
      } finally {
        if (alive) setAdjustmentsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [viewMode, month]);

  const employeeMap = useMemo(() => {
    const map = new Map<string, EmployeeLite>();
    for (const emp of employees) map.set(emp.id, emp);
    return map;
  }, [employees]);

  const { summaryRows, summaryTotals, detailRows } = useMemo(() => {
    const summaries = new Map<string, Portion>();
    const details: DetailRow[] = [];
    const selectedMonth = viewMode === "MONTH" ? month : null;

    for (const leave of leaves) {
      const employeeId = extractEmployeeId(leave.employee);
      if (!employeeId) continue;

      const distribution = distributeLeaveAcrossMonths(leave);
      const portion =
        viewMode === "ALL"
          ? sumPortions(Object.values(distribution))
          : selectedMonth
            ? distribution[selectedMonth]
            : undefined;
      const workingDaysForView =
        viewMode === "ALL"
          ? countWorkingDays(leave)
          : selectedMonth
            ? countWorkingDaysInMonth(leave, selectedMonth)
            : 0;

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

      if ((portion && portion.total > 0) || workingDaysForView > 0) {
        details.push({
          leaveId: leave._id,
          employeeId,
          status: leave.status,
          type: leave.type,
          fallbackType: leave.fallbackType,
          startDate: leave.startDate,
          endDate: leave.endDate,
          totalDays: portion?.total || workingDaysForView,
          portion,
          reason: leave.reason,
          isAuto: Boolean(leave.isAuto),
        });
      }
    }

    const summaryMap = new Map<string, Portion>(summaries);

    // Ensure employees with only deductions still appear in summary
    for (const [employeeId, adj] of Object.entries(adjustments)) {
      if (!summaryMap.has(employeeId)) {
        summaryMap.set(employeeId, {
          paid: 0,
          casual: 0,
          sick: 0,
          unpaid: 0,
          total: 0,
        });
      }
    }

    const summaryList: any[] = Array.from(summaryMap.entries()).map(
      ([employeeId, portion]) => ({ employeeId, ...portion }),
    );

    summaryList.sort((a, b) => {
      const nameA = employeeMap.get(a.employeeId)?.name || "";
      const nameB = employeeMap.get(b.employeeId)?.name || "";
      return nameA.localeCompare(nameB);
    });
    const summaryWithDeducted = summaryList.map((row) => ({
      ...row,
      deducted: adjustments[row.employeeId]?.deducted || 0,
    }));

    const totals = summaryWithDeducted.reduce(
      (acc, row) => ({
        paid: acc.paid + row.paid,
        casual: acc.casual + row.casual,
        sick: acc.sick + row.sick,
        unpaid: acc.unpaid + row.unpaid,
        deducted: acc.deducted + row.deducted,
        total: acc.total + row.total,
      }),
      { paid: 0, casual: 0, sick: 0, unpaid: 0, deducted: 0, total: 0 },
    );

    details.sort(
      (a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );

    return {
      summaryRows: summaryWithDeducted,
      summaryTotals: totals,
      detailRows: details,
    };
  }, [leaves, month, viewMode, employeeMap, adjustments]);

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

  const reportLabel = useMemo(
    () => (viewMode === "ALL" ? "All time" : formatMonthLabel(month)),
    [viewMode, month],
  );

  const attendanceAggregates = useMemo(() => {
    let total = 0;
    let halfDays = 0;
    let counted = 0;
    for (const row of filteredSummary) {
      const entry = attendanceSummary[row.employeeId];
      if (!entry || !Number.isFinite(entry.leaveDays)) continue;
      total += entry.leaveDays;
      halfDays += Number(entry.halfDayLeaves || 0);
      counted += 1;
    }
    return { total, halfDays, counted };
  }, [filteredSummary, attendanceSummary]);

  const pageLoading = loading || attendanceLoading;

  async function downloadExcel() {
    try {
      setDownloading(true);
      const esc = (value: string) =>
        String(value ?? "-")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;");

      const summaryHeader =
        "<tr><th>Employee</th><th>Paid</th><th>Casual</th><th>Sick</th><th>Unpaid</th><th>Deducted</th><th>Half Days</th><th>Total Days</th></tr>";
      const summaryRowsHtml = filteredSummary
        .map((row) => {
          const emp = employeeMap.get(row.employeeId);
          const name = emp?.name || row.employeeId;
          const email = emp?.email ? ` (${emp.email})` : "";
          const attendanceTotals = attendanceSummary[row.employeeId];
          const attendanceTotal = attendanceTotals?.leaveDays;
          const hasAttendance =
            typeof attendanceTotal === "number" &&
            Number.isFinite(attendanceTotal);
          const displayTotal = hasAttendance ? attendanceTotal : row.total;
          const totalDiff =
            hasAttendance && Math.abs(attendanceTotal - row.total) > 0.005;
          const halfDayValue =
            attendanceTotals && Number.isFinite(attendanceTotals.halfDayLeaves)
              ? fmtNumber(attendanceTotals.halfDayLeaves || 0)
              : "-";
          return `
            <tr>
              <td>${esc(name + email)}</td>
              <td>${fmtNumber(row.paid)}</td>
              <td>${fmtNumber(row.casual)}</td>
              <td>${fmtNumber(row.sick)}</td>
              <td>${fmtNumber(row.unpaid)}</td>
              <td>${fmtNumber(row.deducted)}</td>
              <td>${halfDayValue}</td>
              <td>${fmtNumber(displayTotal)}${
                totalDiff ? ` (Leaves: ${fmtNumber(row.total)})` : ""
              }</td>
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
          const reasonText = row.reason || "-";
          const decoratedReason = row.isAuto
            ? `[AUTO] ${reasonText}`
            : reasonText;
          return `
            <tr>
              <td>${esc(name + email)}</td>
              <td>${esc(formatLeaveType(row.type))}</td>
              <td>${esc(row.status)}</td>
              <td>${esc(formatDate(row.startDate))}</td>
              <td>${esc(formatDate(row.endDate))}</td>
              <td>${fmtNumber(row.totalDays)}</td>
              <td>${esc(formatBreakdown(row.portion, row.type))}</td>
              <td>${esc(decoratedReason)}</td>
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
            <h2>Leave Summary (${esc(reportLabel)})</h2>
            <table border="1" cellspacing="0" cellpadding="4">
              <thead>${summaryHeader}</thead>
              <tbody>${
                summaryRowsHtml || "<tr><td colspan=8>No data</td></tr>"
              }</tbody>
            </table>
            <br />
            <h2>Leave Details (${esc(reportLabel)})</h2>
            <table border="1" cellspacing="0" cellpadding="4">
              <thead>${detailHeader}</thead>
              <tbody>${
                detailRowsHtml || "<tr><td colspan=8>No data</td></tr>"
              }</tbody>
            </table>
          </body>
        </html>`;

      const blob = new Blob([html], {
        type: "application/vnd.ms-excel",
      });
      const filename = `leave-report-${
        viewMode === "ALL" ? "all-time" : month || "current"
      }.xls`;
      downloadFileBlob(blob, filename);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 ">
        <div>
          <h2 className="text-xl font-semibold">Leave Reports</h2>
          <p className="text-sm text-muted-foreground">
            Track approved leave utilisation across the company by month or for
            all time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as ViewMode)}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
          >
            <option value="MONTH">Monthly view</option>
            <option value="ALL">All time</option>
          </select>
          {viewMode === "MONTH" && (
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-10 rounded-md border border-border bg-surface px-3"
            />
          )}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter employees…"
            className="h-10 w-52 rounded-md border border-border bg-surface px-3"
          />
          {/* <button
            type="button"
            onClick={downloadExcel}
            disabled={downloading || attendanceLoading}
            className="h-10 rounded-md border border-border bg-white px-3 text-sm disabled:opacity-50"
          >
            {downloading ? "Preparing…" : "Download Excel"}
          </button> */}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {attendanceError && (
        <div className="rounded-md border border-warning/20 bg-warning/10 px-4 py-2 text-sm text-warning">
          {attendanceError}
        </div>
      )}
      {adjustmentsError && (
        <div className="rounded-md border border-warning/20 bg-warning/10 px-4 py-2 text-sm text-warning">
          {adjustmentsError}
        </div>
      )}

      {pageLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-surface shadow-sm">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Summary by employee</h3>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>Paid: {fmtNumber(summaryTotals.paid)}</span>
                <span>Casual: {fmtNumber(summaryTotals.casual)}</span>
                <span>Sick: {fmtNumber(summaryTotals.sick)}</span>
                <span>Unpaid: {fmtNumber(summaryTotals.unpaid)}</span>
                <span>Deducted: {fmtNumber(summaryTotals.deducted)}</span>
                <span>Total (Leaves): {fmtNumber(summaryTotals.total)}</span>
                {attendanceAggregates.counted > 0 && (
                  <>
                    <span>
                      Half Days: {fmtNumber(attendanceAggregates.halfDays)}
                    </span>
                  </>
                )}
              </div>
            </header>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/20 text-left">
                  <tr>
                    <th className="w-[30%] px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Paid</th>
                    <th className="px-4 py-3 font-medium">Casual</th>
                    <th className="px-4 py-3 font-medium">Sick</th>
                    <th className="px-4 py-3 font-medium">Unpaid</th>
                    <th className="px-4 py-3 font-medium">Deducted</th>
                    <th className="px-4 py-3 font-medium">Half Days</th>
                    <th className="px-4 py-3 font-medium">Total Days</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSummary.length ? (
                    filteredSummary.map((row) => {
                      const emp = employeeMap.get(row.employeeId);
                      const name = emp?.name || row.employeeId;
                      const email = emp?.email;
                      const attendanceTotals =
                        attendanceSummary[row.employeeId];
                      const attendanceTotal = attendanceTotals?.leaveDays;
                      const hasAttendance =
                        typeof attendanceTotal === "number" &&
                        Number.isFinite(attendanceTotal);
                      const displayTotal = hasAttendance
                        ? attendanceTotal
                        : row.total;
                      const hasDifference =
                        hasAttendance &&
                        Math.abs(attendanceTotal - row.total) > 0.005;
                      const halfDayCount =
                        attendanceTotals &&
                        Number.isFinite(attendanceTotals.halfDayLeaves)
                          ? attendanceTotals.halfDayLeaves || 0
                          : null;
                      return (
                        <tr
                          key={row.employeeId}
                          className="border-t border-border/60"
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium">{name}</div>
                            {email && (
                              <div className="text-xs text-muted-foreground">
                                {email}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">{fmtNumber(row.paid)}</td>
                          <td className="px-4 py-3">{fmtNumber(row.casual)}</td>
                          <td className="px-4 py-3">{fmtNumber(row.sick)}</td>
                          <td className="px-4 py-3">{fmtNumber(row.unpaid)}</td>
                          <td className="px-4 py-3">
                            {fmtNumber(row.deducted)}
                          </td>
                          <td className="px-4 py-3">
                            {halfDayCount != null
                              ? fmtNumber(halfDayCount)
                              : "—"}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {fmtNumber(
                              row.total +
                                (halfDayCount ? halfDayCount * 0.5 : 0),
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        className="px-4 py-6 text-center text-sm text-muted-foreground"
                        colSpan={7}
                      >
                        No approved leaves recorded for this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* <section className="rounded-lg border border-border bg-surface shadow-sm">
            <header className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Leave details</h3>
              <p className="text-xs text-muted-foreground">
                {viewMode === "ALL"
                  ? "Includes every leave recorded, regardless of status."
                  : "Includes all leaves that overlap the selected month, regardless of status."}
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
                      const dates = `${formatDate(
                        row.startDate
                      )} → ${formatDate(row.endDate)}`;
                      const reasonText = row.reason || "-";
                      const reasonTitle = row.isAuto
                        ? `${reasonText} (Auto leave)`
                        : reasonText;
                      return (
                        <tr
                          key={row.leaveId}
                          className="border-t border-border/60"
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium">{name}</div>
                            {emp?.email && (
                              <div className="text-xs text-muted-foreground">
                                {emp.email}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {formatLeaveType(row.type)}
                          </td>
                          <td className="px-4 py-3">
                            <StatusPill status={row.status} />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {dates}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {fmtNumber(row.totalDays)}
                          </td>
                          <td className="px-4 py-3">{breakdown}</td>
                          <td
                            className="px-4 py-3 max-w-xs"
                            title={reasonTitle}
                          >
                            <div className="flex min-h-[1.5rem] min-w-0 items-center gap-2">
                              <span className="truncate">{reasonText}</span>
                              {row.isAuto && (
                                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Auto
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        className="px-4 py-6 text-center text-sm text-muted-foreground"
                        colSpan={7}
                      >
                        {viewMode === "ALL"
                          ? "No leave applications found in this view."
                          : "No leave applications overlap this month."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section> */}
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}`;
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

function countWorkingDays(leave: LeaveRecord) {
  const start = startOfDay(new Date(leave.startDate));
  const end = startOfDay(new Date(leave.endDate));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (!isWeekend(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function distributeLeaveAcrossMonths(
  leave: LeaveRecord,
): Record<string, Portion> {
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
    0,
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

function sumPortions(portions: Portion[]) {
  if (!portions.length) return undefined;
  const total = portions.reduce(
    (acc, portion) => ({
      paid: acc.paid + portion.paid,
      casual: acc.casual + portion.casual,
      sick: acc.sick + portion.sick,
      unpaid: acc.unpaid + portion.unpaid,
      total: acc.total + portion.total,
    }),
    { paid: 0, casual: 0, sick: 0, unpaid: 0, total: 0 },
  );
  if (total.total <= 0) return undefined;
  return total;
}

function fmtNumber(n: number) {
  const rounded = Math.round(n * 100) / 100;
  if (Number.isNaN(rounded)) return "0";
  if (Math.abs(rounded % 1) < 1e-4) return String(Math.round(rounded));
  return rounded.toFixed(1);
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
  return d.toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colors[status]}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
