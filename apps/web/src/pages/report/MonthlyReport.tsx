import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { getEmployee } from "../../lib/auth";

type MonthlyDay = {
  date: string; // yyyy-mm-dd
  firstPunchIn: string | null;
  lastPunchOut: string | null;
  timeSpentMs: number;
  dayType: "FULL_DAY" | "HALF_DAY";
  status?: "" | "WORKED" | "HOLIDAY" | "LEAVE" | "WEEKEND";
};

function fmtTime(t?: string | null) {
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

export default function MonthlyReport() {
  const u = getEmployee();
  const canViewOthers =
    ["ADMIN", "SUPERADMIN"].includes(u?.primaryRole || "") ||
    (u?.subRoles || []).some((r) => r === "hr" || r === "manager");

  const [employees, setEmployees] = useState<{ id: string; name: string }[]>(
    []
  );
  const [employeeId, setEmployeeId] = useState<string>(u?.id || "");
  const [empQuery, setEmpQuery] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // yyyy-mm

  const [rows, setRows] = useState<MonthlyDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Load employees for admin/hr/manager
  useEffect(() => {
    if (!canViewOthers) return;
    (async () => {
      try {
        const res = await api.get("/companies/employees");
        const list = res.data.employees || [];
        setEmployees(list);
        if (!employeeId && list.length) setEmployeeId(list[0].id);
      } catch {}
    })();
  }, [canViewOthers]); // eslint-disable-line

  async function load() {
    if (!employeeId) return;
    try {
      setLoading(true);
      setErr(null);
      const res = await api.get(`/attendance/monthly/${employeeId}`, {
        params: { month },
      });
      setRows(res.data.days || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [employeeId, month]); // eslint-disable-line

  const filteredEmployees = useMemo(() => {
    const q = empQuery.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)
    );
  }, [empQuery, employees]);

  function shiftMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    setMonth(newMonth);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Monthly Report</h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-surface overflow-hidden">
            <button
              onClick={() => shiftMonth(-1)}
              className="px-3 py-2 border-r border-border"
            >
              Prev
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-2 bg-surface"
            />
            <button
              onClick={() => shiftMonth(1)}
              className="px-3 py-2 border-l border-border"
            >
              Next
            </button>
          </div>
          <button
            className="rounded-md border border-border px-3 py-3 text-sm bg-white"
            onClick={async () => {
              try {
                const name =
                  employees.find((e) => e.id === employeeId)?.name ||
                  employeeId;
                const res = await api.get(
                  `/attendance/monthly/${employeeId}/excel`,
                  {
                    params: { month },
                    responseType: "blob",
                  } as any
                );
                const blob = new Blob([res.data], {
                  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `attendance-${name.replace(
                  /\s+/g,
                  "_"
                )}-${month}.xlsx`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              } catch (e) {
                // eslint-disable-next-line no-console
                console.error(e);
                alert("Failed to download Excel");
              }
            }}
          >
            Download Excel
          </button>
        </div>
      </div>

      {canViewOthers && (
        <div className="flex flex-wrap items-center gap-3">
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
        </div>
      )}

      <div className="rounded-md border border-border overflow-hidden bg-white">
        {loading ? (
          <div className="p-4 text-sm text-muted">Loading…</div>
        ) : err ? (
          <div className="p-4 text-sm text-error">{err}</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-[720px] w-full text-sm">
              <thead>
                <tr className="bg-white text-left">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Punch In</th>
                  <th className="px-3 py-2 font-medium">Punch Out</th>
                  <th className="px-3 py-2 font-medium">Time Spent</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  // Merge day type and status like the Excel export:
                  // - WORKED => Full Day / Half Day
                  // - Otherwise => Weekend / Holiday / Leave (or blank for future)
                  const statusLabel =
                    d.status === "WORKED"
                      ? d.dayType === "FULL_DAY"
                        ? "Full Day"
                        : "Half Day"
                      : d.status === "WEEKEND"
                      ? "Weekend"
                      : d.status === "HOLIDAY"
                      ? "Holiday"
                      : d.status === "LEAVE"
                      ? "Leave"
                      : "";
                  return (
                    <tr key={d.date} className="border-t border-border/60">
                      <td className="px-3 py-2 whitespace-nowrap">{d.date}</td>
                      <td className="px-3 py-2">{fmtTime(d.firstPunchIn)}</td>
                      <td className="px-3 py-2">{fmtTime(d.lastPunchOut)}</td>
                      <td className="px-3 py-2">
                        {statusLabel ? fmtDur(d.timeSpentMs) : ""}
                      </td>
                      <td className="px-3 py-2">{statusLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
