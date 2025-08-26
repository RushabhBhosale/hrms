import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { getEmployee } from "../../lib/auth";

type AttRecord = {
  date: string; // ISO (00:00:00)
  firstPunchIn?: string;
  lastPunchOut?: string;
  workedMs?: number;
  autoPunchOut?: boolean;
};

function fmtDate(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleDateString();
}
function fmtTime(t?: string) {
  if (!t) return "-";
  return new Date(t).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtDur(ms?: number) {
  if (!ms || ms <= 0) return "-";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
function inferWorkedMs(r: AttRecord) {
  if (typeof r.workedMs === "number") return r.workedMs;
  if (r.firstPunchIn && r.lastPunchOut) {
    return (
      new Date(r.lastPunchOut).getTime() - new Date(r.firstPunchIn).getTime()
    );
  }
  return 0;
}
function toISODateOnly(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function AttendanceRecords() {
  const u = getEmployee();
  const canViewOthers =
    ["ADMIN", "SUPERADMIN"].includes(u?.primaryRole || "") ||
    (u?.subRoles || []).some((r) => r === "hr" || r === "manager");

  const [employees, setEmployees] = useState<{ id: string; name: string }[]>(
    []
  );
  const [employeeId, setEmployeeId] = useState<string>(u?.id || "");
  const [empQuery, setEmpQuery] = useState("");

  const [rows, setRows] = useState<AttRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // yyyy-mm
  const [summary, setSummary] = useState<{
    workedDays: number;
    leaveDays: number;
    leaveDates: string[];
  } | null>(null);

  const [detail, setDetail] = useState<AttRecord | null>(null);

  // ADMIN/HR filters
  const [showWeekends, setShowWeekends] = useState(true);
  const [onlyWorked, setOnlyWorked] = useState(false);
  const [minHours, setMinHours] = useState<number>(0);
  const [showLeaves, setShowLeaves] = useState(true);

  // Load employees for admin/hr
  useEffect(() => {
    if (!canViewOthers) return;
    (async () => {
      try {
        const res = await api.get("/companies/employees");
        const list = res.data.employees || [];
        setEmployees(list);
        if (!employeeId && list.length) setEmployeeId(list[0].id);
      } catch {
        /* ignore */
      }
    })();
  }, [canViewOthers]); // eslint-disable-line

  async function load(empId: string) {
    try {
      setLoading(true);
      setErr(null);
      const res = await api.get(`/attendance/history/${empId}`);
      setRows(res.data.attendance || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load attendance history");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!employeeId) return;
    load(employeeId);
  }, [employeeId]);

  useEffect(() => {
    if (!employeeId) return;
    (async () => {
      try {
        const res = await api.get(`/attendance/report/${employeeId}`, {
          params: { month },
        });
        setSummary(res.data.report);
      } catch {
        /* ignore */
      }
    })();
  }, [month, employeeId]);

  const filtered = useMemo(
    () => rows.filter((r) => r.date.slice(0, 7) === month),
    [rows, month]
  );

  const byDate = useMemo(() => {
    const m = new Map<string, AttRecord>();
    for (const r of filtered) {
      const key = toISODateOnly(new Date(r.date));
      m.set(key, r);
    }
    return m;
  }, [filtered]);

  // Build calendar grid for selected month (Sunday → Saturday)
  const cursor = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }, [month]);

  const grid = useMemo(() => {
    const start = startOfMonth(cursor);
    const end = endOfMonth(cursor);
    const gridStart = addDays(start, -start.getDay()); // back to Sunday
    const gridEnd = addDays(end, 6 - end.getDay()); // forward to Saturday

    const days: { date: Date; inMonth: boolean; rec?: AttRecord }[] = [];
    for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
      const key = toISODateOnly(d);
      days.push({
        date: new Date(d),
        inMonth: d.getMonth() === cursor.getMonth(),
        rec: byDate.get(key),
      });
    }
    return days;
  }, [cursor, byDate]);

  const totalWorked = useMemo(
    () =>
      grid
        .filter((d) => d.inMonth && d.rec)
        .reduce((acc, d) => acc + inferWorkedMs(d.rec!), 0),
    [grid]
  );

  const leaveSet = useMemo(() => new Set(summary?.leaveDates || []), [summary]);

  // Color scale by worked hours
  function colorFor(ms?: number) {
    if (!ms || ms <= 0) return "bg-gray-200";
    const h = ms / 3600000;
    if (h < 2) return "bg-red-300";
    if (h < 4) return "bg-orange-400";
    if (h < 6) return "bg-yellow-400";
    if (h < 8) return "bg-lime-400";
    return "bg-green-500";
  }

  const legend = [
    { label: "0h", cls: "bg-gray-200" },
    { label: "≤2h", cls: "bg-red-300" },
    { label: "≤4h", cls: "bg-orange-400" },
    { label: "≤6h", cls: "bg-yellow-400" },
    { label: "≤8h", cls: "bg-lime-400" },
    { label: "8h+", cls: "bg-green-500" },
    { label: "Leave", cls: "bg-blue-300" },
  ];

  // Month navigation
  function shiftMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    setMonth(newMonth);
  }
  function jumpToday() {
    const d = new Date();
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    setMonth(newMonth);
  }

  const weekHeaders = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();

  // Admin: employee search & filtered list
  const filteredEmployees = useMemo(() => {
    const q = empQuery.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)
    );
  }, [empQuery, employees]);

  // Day-level filter predicate
  function passesDayFilters(date: Date, rec?: AttRecord) {
    if (!canViewOthers) return true; // only admins/hr see filters
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const key = toISODateOnly(date);
    const isLeave = leaveSet.has(key);
    const worked = rec ? inferWorkedMs(rec) : 0;
    const workedH = worked / 3600000;

    if (!showWeekends && isWeekend) return false;
    if (!showLeaves && isLeave) return false;
    if (onlyWorked && worked <= 0) return false;
    if (workedH < minHours) return false;
    return true;
  }

  return (
    <div className="space-y-8">
      {/* Monthly report */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold">Monthly Report</h3>
          <div className="hidden md:flex items-center gap-2">
            {legend.map((b, i) => (
              <div key={i} className="flex items-center gap-1 text-xs">
                <div className={`h-3 w-3 rounded ${b.cls}`} />
                <span className="text-muted">{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canViewOthers && (
            <>
              <input
                value={empQuery}
                onChange={(e) => setEmpQuery(e.target.value)}
                placeholder="Search employee…"
                className="h-10 w-48 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
              />
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="h-10 rounded-md border border-border bg-surface px-3"
              >
                {filteredEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>

              {/* Admin day filters */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showWeekends}
                    onChange={(e) => setShowWeekends(e.target.checked)}
                  />
                  Show weekends
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={onlyWorked}
                    onChange={(e) => setOnlyWorked(e.target.checked)}
                  />
                  Only worked days
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  Min hours
                  <select
                    className="h-8 rounded-md border border-border bg-surface px-2"
                    value={minHours}
                    onChange={(e) => setMinHours(Number(e.target.value))}
                  >
                    <option value={0}>0</option>
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                    <option value={6}>6</option>
                    <option value={8}>8</option>
                  </select>
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showLeaves}
                    onChange={(e) => setShowLeaves(e.target.checked)}
                  />
                  Show leave days
                </label>
              </div>
            </>
          )}

          <div className="inline-flex rounded-md border border-border bg-surface overflow-hidden">
            <button
              onClick={() => shiftMonth(-1)}
              className="px-3 py-2 border-r border-border"
            >
              ← Prev
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-2 outline-none"
            />
            <button
              onClick={() => shiftMonth(1)}
              className="px-3 py-2 border-l border-border"
            >
              Next →
            </button>
          </div>
          <button
            onClick={jumpToday}
            className="rounded-md border border-border px-3 py-2"
          >
            Today
          </button>

          {summary && (
            <div className="text-sm ml-auto">
              <span className="text-muted">Worked Days:</span>{" "}
              {summary.workedDays}
              <span className="mx-2">•</span>
              <span className="text-muted">Leave Days:</span>{" "}
              {summary.leaveDays}
              <span className="mx-2">•</span>
              <span className="text-muted">Total:</span>{" "}
              <span className="font-medium">{fmtDur(totalWorked)}</span>
            </div>
          )}
        </div>
      </section>

      {/* Heatmap */}
      <section className="rounded-lg border border-border bg-surface shadow-sm p-4">
        {err && (
          <div className="mb-3 rounded-md border border-error/20 bg-red-50 px-4 py-2 text-sm text-error">
            {err}
          </div>
        )}

        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            {/* Week headers: Sun → Sat */}
            <div className="grid grid-cols-7 gap-2 px-1 pb-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="text-xs text-muted text-center">
                  {d}
                </div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-2">
              {loading
                ? Array.from({ length: 42 }).map((_, i) => (
                    <div key={i} className="h-20 rounded bg-bg animate-pulse" />
                  ))
                : grid.map(({ date, inMonth, rec }) => {
                    const worked = rec ? inferWorkedMs(rec) : 0;
                    const key = toISODateOnly(date);
                    const isLeave = leaveSet.has(key);
                    const color = inMonth
                      ? isLeave
                        ? showLeaves
                          ? "bg-blue-300"
                          : "bg-bg"
                        : colorFor(worked)
                      : "bg-bg";
                    const isToday = isSameDay(date, today);

                    // Apply filters (dim & disable instead of removing)
                    const hidden = canViewOthers
                      ? !passesDayFilters(date, rec)
                      : false;

                    return (
                      <button
                        key={date.toISOString()}
                        onClick={() => rec && !hidden && setDetail(rec)}
                        disabled={!rec || hidden}
                        className={[
                          "relative h-20 rounded border p-2 text-left transition",
                          "border-border/60",
                          color,
                          !inMonth ? "opacity-70" : "",
                          hidden ? "opacity-25 pointer-events-none" : "",
                          rec && !hidden
                            ? "hover:ring-2 hover:ring-primary"
                            : "",
                          isToday ? "outline outline-2 outline-primary/70" : "",
                        ].join(" ")}
                        title={
                          isLeave
                            ? `${fmtDate(date)} — Leave`
                            : `${fmtDate(date)} — ${fmtDur(worked)}`
                        }
                      >
                        {/* Day number (top-right) */}
                        <div className="absolute top-1 right-1 text-[11px] font-medium opacity-80">
                          {date.getDate()}
                        </div>

                        {/* Content */}
                        {rec && !hidden && (
                          <div className="mt-5 space-y-1 text-[11px] leading-tight">
                            <div>In: {fmtTime(rec.firstPunchIn)}</div>
                            <div>Out: {fmtTime(rec.lastPunchOut)}</div>
                            <div className="inline-flex rounded-full bg-white/70 px-2 py-[2px] text-[10px] font-medium">
                              {fmtDur(worked)}
                            </div>
                          </div>
                        )}
                        {!rec && isLeave && showLeaves && (
                          <div className="mt-5 text-[11px] font-medium text-blue-700">
                            Leave
                          </div>
                        )}
                        {rec?.autoPunchOut && (
                          <div className="absolute bottom-1 left-1 text-[10px] text-error">
                            !
                          </div>
                        )}
                      </button>
                    );
                  })}
            </div>

            {/* Legend (mobile) */}
            <div className="mt-4 flex md:hidden items-center gap-2">
              {[
                ...legend.filter((l) => l.label !== "Leave"),
                ...(showLeaves
                  ? legend.filter((l) => l.label === "Leave")
                  : []),
              ].map((b, i) => (
                <div key={i} className="flex items-center gap-1 text-xs">
                  <div className={`h-3 w-3 rounded ${b.cls}`} />
                  <span className="text-muted">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDetail(null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h4 className="text-lg font-semibold mb-1">Attendance Details</h4>
            <div className="text-sm text-muted mb-3">
              {fmtDate(detail.date)}
            </div>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <div className="text-muted">First In</div>
              <div>{fmtTime(detail.firstPunchIn)}</div>
              <div className="text-muted">Last Out</div>
              <div>{fmtTime(detail.lastPunchOut)}</div>
              <div className="text-muted">Worked</div>
              <div>{fmtDur(inferWorkedMs(detail))}</div>
              {detail.autoPunchOut && (
                <div className="col-span-2 mt-2 text-xs text-error">
                  Auto punched out
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                className="rounded-md border border-border px-4 py-2"
                onClick={() => setDetail(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
