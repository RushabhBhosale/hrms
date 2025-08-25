import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

type AttRecord = {
  date: string; // ISO date (startOfDay)
  firstPunchIn?: string; // ISO datetime
  lastPunchOut?: string; // ISO datetime
  workedMs?: number; // optional (if your API provides it)
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString();
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

export default function AttendanceRecords() {
  const [rows, setRows] = useState<AttRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState(""); // free text filter (date string)
  const [from, setFrom] = useState<string>(""); // yyyy-mm-dd
  const [to, setTo] = useState<string>(""); // yyyy-mm-dd

  async function load() {
    try {
      setLoading(true);
      setErr(null);
      const res = await api.get("/attendance/history");
      setRows(res.data.attendance || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load attendance history");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const fromTs = from ? new Date(from).setHours(0, 0, 0, 0) : undefined;
    const toTs = to ? new Date(to).setHours(23, 59, 59, 999) : undefined;

    return rows
      .filter((r) => {
        const dTs = new Date(r.date).getTime();
        if (fromTs && dTs < fromTs) return false;
        if (toTs && dTs > toTs) return false;
        if (!term) return true;
        // match on date string or formatted values
        const dateStr = fmtDate(r.date).toLowerCase();
        const firstStr = fmtTime(r.firstPunchIn).toLowerCase();
        const lastStr = fmtTime(r.lastPunchOut).toLowerCase();
        return (
          dateStr.includes(term) ||
          firstStr.includes(term) ||
          lastStr.includes(term)
        );
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [rows, q, from, to]);

  const totalWorked = useMemo(
    () => filtered.reduce((acc, r) => acc + inferWorkedMs(r), 0),
    [filtered]
  );

  function quickRange(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
  }

  function exportCsv() {
    const header = ["Date", "First In", "Last Out", "Worked"];
    const lines = filtered.map((r) => {
      const worked = fmtDur(inferWorkedMs(r));
      return [
        fmtDate(r.date),
        fmtTime(r.firstPunchIn),
        fmtTime(r.lastPunchOut),
        worked,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Attendance Records</h2>
          <p className="text-sm text-muted">
            Review your daily punches and durations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search date/time…"
            className="h-10 w-56 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-10 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
            aria-label="From date"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-10 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
            aria-label="To date"
          />
          <button
            onClick={() => quickRange(7)}
            className="h-10 rounded-md border border-border px-3"
          >
            Last 7d
          </button>
          <button
            onClick={() => quickRange(30)}
            className="h-10 rounded-md border border-border px-3"
          >
            Last 30d
          </button>
          <button
            onClick={load}
            className="h-10 rounded-md border border-border px-3"
          >
            Refresh
          </button>
          <button
            onClick={exportCsv}
            className="h-10 rounded-md bg-primary px-4 text-white"
          >
            Export CSV
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-red-50 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="text-sm text-muted">
            {loading
              ? "Loading…"
              : `${filtered.length} record${filtered.length === 1 ? "" : "s"}`}
          </div>
          <div className="text-sm text-muted">Total: {fmtDur(totalWorked)}</div>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-left">
                <Th>Date</Th>
                <Th>First In</Th>
                <Th>Last Out</Th>
                <Th>Worked</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={10} cols={4} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted">
                    No records.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.date} className="border-t border-border/70">
                    <Td>{fmtDate(r.date)}</Td>
                    <Td>{fmtTime(r.firstPunchIn)}</Td>
                    <Td>{fmtTime(r.lastPunchOut)}</Td>
                    <Td>{fmtDur(inferWorkedMs(r))}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border p-3 animate-pulse space-y-2"
                >
                  <div className="h-4 w-40 bg-bg rounded" />
                  <div className="h-3 w-56 bg-bg rounded" />
                  <div className="h-6 w-24 bg-bg rounded" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-muted">No records.</div>
          ) : (
            filtered.map((r) => (
              <div key={r.date} className="p-4">
                <div className="font-medium">{fmtDate(r.date)}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted">First In</div>
                  <div>{fmtTime(r.firstPunchIn)}</div>
                  <div className="text-muted">Last Out</div>
                  <div>{fmtTime(r.lastPunchOut)}</div>
                  <div className="text-muted">Worked</div>
                  <div>{fmtDur(inferWorkedMs(r))}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-middle">{children}</td>;
}
function SkeletonRows({ rows, cols }: { rows: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t border-border/70">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-4 py-3">
              <div className="h-4 w-40 bg-bg rounded animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
