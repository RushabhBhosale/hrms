import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

type AttendanceRecord = {
  employee: { id: string; name: string };
  firstPunchIn?: string;
  lastPunchOut?: string;
};

function formatTime(ts?: string) {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, "0");
  return `${h}h ${m}m`;
}

export default function AttendanceList() {
  const [rows, setRows] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [now, setNow] = useState(Date.now());

  async function load() {
    try {
      setLoading(true);
      setErr(null);
      const res = await api.get("/attendance/company/today");
      setRows(res.data.attendance || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load attendance");
    } finally {
      setLoading(false);
    }
  }

  // initial + pull every 60s
  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  // tick per minute for live elapsed of "IN" users
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = term
      ? rows.filter((r) => r.employee.name.toLowerCase().includes(term))
      : rows;

    // sort: IN first, then by name
    return [...base].sort((a, b) => {
      const aIn = a.firstPunchIn && !a.lastPunchOut ? 1 : 0;
      const bIn = b.firstPunchIn && !b.lastPunchOut ? 1 : 0;
      if (aIn !== bIn) return bIn - aIn; // IN first
      return a.employee.name.localeCompare(b.employee.name);
    });
  }, [rows, q]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Attendance (Today)</h2>
          <p className="text-sm text-muted">
            Live status of employees who have punched in/out today.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search employee…"
            className="h-10 w-72 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={load}
            className="h-10 rounded-md bg-primary px-4 text-white"
          >
            Refresh
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
              : `${filtered.length} ${
                  filtered.length === 1 ? "employee" : "employees"
                }`}
          </div>
          <div className="text-xs text-muted">
            Updated{" "}
            {new Date(now).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-left">
                <Th>Name</Th>
                <Th>First In</Th>
                <Th>Last Out</Th>
                <Th>Status</Th>
                <Th>Elapsed</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={6} cols={5} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted">
                    No attendance records yet.
                  </td>
                </tr>
              ) : (
                filtered.map((a) => {
                  const isIn = !!a.firstPunchIn && !a.lastPunchOut;
                  const elapsed = a.firstPunchIn
                    ? isIn
                      ? now - new Date(a.firstPunchIn).getTime()
                      : new Date(a.lastPunchOut || 0).getTime() -
                        new Date(a.firstPunchIn).getTime()
                    : 0;
                  return (
                    <tr
                      key={a.employee.id}
                      className="border-t border-border/70"
                    >
                      <Td className="font-medium">{a.employee.name}</Td>
                      <Td>{formatTime(a.firstPunchIn)}</Td>
                      <Td>{formatTime(a.lastPunchOut)}</Td>
                      <Td>
                        <StatusBadge inOffice={isIn} />
                      </Td>
                      <Td>{a.firstPunchIn ? formatElapsed(elapsed) : "-"}</Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
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
            <div className="px-4 py-6 text-center text-muted">
              No attendance records yet.
            </div>
          ) : (
            filtered.map((a) => {
              const isIn = !!a.firstPunchIn && !a.lastPunchOut;
              const elapsed = a.firstPunchIn
                ? isIn
                  ? now - new Date(a.firstPunchIn).getTime()
                  : new Date(a.lastPunchOut || 0).getTime() -
                    new Date(a.firstPunchIn).getTime()
                : 0;
              return (
                <div key={a.employee.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{a.employee.name}</div>
                    <StatusBadge inOffice={isIn} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div className="text-muted">First In</div>
                    <div>{formatTime(a.firstPunchIn)}</div>
                    <div className="text-muted">Last Out</div>
                    <div>{formatTime(a.lastPunchOut)}</div>
                    <div className="text-muted">Elapsed</div>
                    <div>{a.firstPunchIn ? formatElapsed(elapsed) : "-"}</div>
                  </div>
                </div>
              );
            })
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

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

function StatusBadge({ inOffice }: { inOffice: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium",
        inOffice
          ? "bg-secondary/10 text-secondary"
          : "bg-accent/10 text-accent",
      ].join(" ")}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          inOffice ? "bg-secondary" : "bg-accent"
        }`}
      />
      {inOffice ? "In" : "Out"}
    </span>
  );
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
