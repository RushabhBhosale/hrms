import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { Th, Td, PaginationFooter } from "../../../components/utils/Table";

type LeaveType = "CASUAL" | "PAID" | "UNPAID" | "SICK";
type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";

type LeaveRecord = {
  _id: string;
  employee: { _id: string; name: string; email?: string } | string;
  type: LeaveType;
  fallbackType?: LeaveType | "UNPAID" | null;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  reason?: string;
  isAuto?: boolean;
};

type EmployeeLite = {
  id: string;
  name: string;
  email?: string;
};

type ViewMode = "ALL" | "MONTH";

function StatusPill({ status }: { status: LeaveStatus }) {
  const colors: Record<LeaveStatus, string> = {
    PENDING: "bg-amber-100 text-amber-800 border-amber-200",
    APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-200",
    REJECTED: "bg-rose-100 text-rose-800 border-rose-200",
  };
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        colors[status],
      ].join(" ")}
    >
      {status}
    </span>
  );
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function overlapsMonth(
  leave: LeaveRecord,
  monthKey: string,
  mode: ViewMode,
): boolean {
  if (mode !== "MONTH") return true;
  if (!monthKey) return true;
  const start = startOfDay(new Date(leave.startDate));
  const end = startOfDay(new Date(leave.endDate));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return false;
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return true;
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0);
  return start <= monthEnd && end >= monthStart;
}

function countWorkingDays(leave: LeaveRecord, monthFilter?: string) {
  const start = startOfDay(new Date(leave.startDate));
  const end = startOfDay(new Date(leave.endDate));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  let from = start;
  let to = end;
  if (monthFilter) {
    const [y, m] = monthFilter.split("-").map(Number);
    if (y && m) {
      const monthStart = new Date(y, m - 1, 1);
      const monthEnd = new Date(y, m, 0);
      if (from < monthStart) from = monthStart;
      if (to > monthEnd) to = monthEnd;
    }
  }

  let count = 0;
  const cursor = new Date(from);
  while (cursor <= to) {
    if (!isWeekend(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Invalid date";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatLeaveType(type: LeaveType) {
  switch (type) {
    case "PAID":
      return "Paid";
    case "CASUAL":
      return "Casual";
    case "UNPAID":
      return "Unpaid";
    case "SICK":
      return "Sick";
    default:
      return type;
  }
}

function formatEmployee(
  emp: LeaveRecord["employee"],
  map: Map<string, EmployeeLite>,
) {
  if (!emp) return { name: "Unknown", email: "" };
  if (typeof emp === "string") {
    const match = map.get(emp);
    return { name: match?.name || emp, email: match?.email || "" };
  }
  return { name: emp.name, email: emp.email || "" };
}

export default function LeaveRecordsPage() {
  const today = new Date();
  const initialMonth = `${today.getFullYear()}-${String(
    today.getMonth() + 1,
  ).padStart(2, "0")}`;

  const [viewMode] = useState<ViewMode>("MONTH");
  const [month, setMonth] = useState(initialMonth);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [sortKey, setSortKey] = useState<"date" | "type">("date");

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
        setLeaves(leavesRes.data.leaves || []);
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
        setError(e?.response?.data?.error || "Failed to load leave records");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const employeeMap = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leaves
      .filter((leave) => overlapsMonth(leave, month, viewMode))
      .filter((leave) => {
        if (!term) return true;
        const emp = formatEmployee(leave.employee, employeeMap);
        const haystack = `${emp.name} ${emp.email} ${
          leave.reason || ""
        }`.toLowerCase();
        return haystack.includes(term);
      });
  }, [leaves, search, employeeMap, month, viewMode]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "type") {
        return dir * a.type.localeCompare(b.type);
      }
      const aStart = new Date(a.startDate).getTime();
      const bStart = new Date(b.startDate).getTime();
      if (Number.isNaN(aStart) || Number.isNaN(bStart)) return 0;
      return dir * (aStart - bStart);
    });
  }, [filtered, sortDir, sortKey]);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(total, page * limit);

  useEffect(() => {
    setPage(1);
  }, [month, search]);

  const pageRows = useMemo(
    () => sorted.slice((page - 1) * limit, (page - 1) * limit + limit),
    [sorted, page, limit],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Leave Records</h2>
          <p className="text-sm text-muted-foreground">
            Detailed leave entries with pagination. For summaries, use Leave
            Reports.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="month"
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <input
            className="h-10 w-64 rounded-md border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            placeholder="Search employee or reason…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `Showing ${start}-${end} of ${total} records`}
          </div>
          <div className="flex items-center gap-3">
            <select
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              value={limit}
              onChange={(e) => {
                setPage(1);
                setLimit(parseInt(e.target.value, 10));
              }}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
            <button
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              Sort: {sortDir === "asc" ? "Oldest first" : "Newest first"}
            </button>
            <select
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as "date" | "type")}
            >
              <option value="date">Sort by Date</option>
              <option value="type">Sort by Type</option>
            </select>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/20 text-left">
              <tr>
                <Th>Employee</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Dates</Th>
                <Th>Days</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-3" colSpan={6}>
                    Loading…
                  </td>
                </tr>
              ) : pageRows.length ? (
                pageRows.map((leave) => {
                  const emp = formatEmployee(leave.employee, employeeMap);
                  const dates = `${formatDate(leave.startDate)} → ${formatDate(
                    leave.endDate,
                  )}`;
                  const days = countWorkingDays(
                    leave,
                    viewMode === "MONTH" ? month : undefined,
                  );
                  const reason = leave.reason || "—";
                  return (
                    <tr
                      key={leave._id}
                      className="border-t border-border/60 align-top"
                    >
                      <Td>
                        <div className="font-medium">{emp.name}</div>
                        {emp.email && (
                          <div className="text-xs text-muted-foreground">
                            {emp.email}
                          </div>
                        )}
                      </Td>
                      <Td>
                        {formatLeaveType(leave.type)}
                        {leave.fallbackType &&
                          leave.fallbackType !== leave.type && (
                            <div className="text-xs text-muted-foreground">
                              Fallback:{" "}
                              {formatLeaveType(leave.fallbackType as LeaveType)}
                            </div>
                          )}
                      </Td>
                      <Td>
                        <StatusPill status={leave.status} />
                      </Td>
                      <Td className="whitespace-nowrap">{dates}</Td>
                      <Td className="font-semibold text-center">
                        {days || "—"}
                      </Td>
                      <td className="px-4 py-3" title={reason}>
                        <span className="line-clamp-2">{reason}</span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-muted-foreground text-sm"
                  >
                    No leave records match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-4 py-3">
          <PaginationFooter
            page={page}
            pages={pages}
            onFirst={() => setPage(1)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(pages, p + 1))}
            onLast={() => setPage(pages)}
            disabled={loading}
          />
        </div>
      </section>
    </div>
  );
}
