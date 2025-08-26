import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import RoleGuard from "../../components/RoleGuard";

type Attendance = {
  firstPunchIn?: string;
  lastPunchOut?: string;
  lastPunchIn?: string;
  workedMs?: number; // accumulated up to the last punch/out
};

function format(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(total % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export default function EmployeeDash() {
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"in" | "out" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  async function load() {
    try {
      setErr(null);
      setLoading(true);
      const res = await api.get("/attendance/today");
      setAttendance(res.data.attendance ?? null);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load attendance");
    } finally {
      setLoading(false);
    }
  }

  async function punch(action: "in" | "out") {
    if (pending) return;
    try {
      setPending(action);
      await api.post("/attendance/punch", { action });
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || `Failed to punch ${action}`);
    } finally {
      setPending(null);
    }
  }

  // drive elapsed from backend fields
  useEffect(() => {
    // clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!attendance) {
      setElapsed(0);
      return;
    }

    const base = attendance.workedMs ?? 0;

    // actively punched in: base + (now - lastPunchIn)
    if (attendance.lastPunchIn && !attendance.lastPunchOut) {
      const start = new Date(attendance.lastPunchIn).getTime();

      const tick = () => setElapsed(base + (Date.now() - start));
      tick(); // immediate
      timerRef.current = window.setInterval(tick, 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }

    // not currently punched in: show base only
    setElapsed(base);
  }, [attendance]);

  // keep timer correct when tab visibility changes (prevents drift)
  useEffect(() => {
    const handleVis = () => {
      if (document.hidden) return;
      // force recompute by re-setting attendance (no extra fetch)
      setAttendance((prev) => (prev ? { ...prev } : prev));
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, []);

  useEffect(() => {
    load();
  }, []);

  const punchedIn = Boolean(
    attendance?.lastPunchIn && !attendance?.lastPunchOut
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Employee Area</h2>
        <p className="text-sm text-muted">
          Track today’s time and quick actions.
        </p>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-red-50 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-sm text-muted">Time worked today</div>
            <div className="text-4xl font-semibold tabular-nums">
              {format(elapsed)}
            </div>
            <div className="mt-2">
              <span
                className={[
                  "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium",
                  punchedIn
                    ? "bg-secondary/10 text-secondary"
                    : "bg-accent/10 text-accent",
                ].join(" ")}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    punchedIn ? "bg-secondary" : "bg-accent"
                  }`}
                />
                {punchedIn ? "Punched In" : "Punched Out"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading || !!pending}
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            {punchedIn ? (
              <button
                className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-60"
                onClick={() => punch("out")}
                disabled={pending === "out"}
              >
                {pending === "out" ? "Punching Out…" : "Punch Out"}
              </button>
            ) : (
              <button
                className="rounded-md bg-secondary px-4 py-2 text-white disabled:opacity-60"
                onClick={() => punch("in")}
                disabled={pending === "in"}
              >
                {pending === "in" ? "Punching In…" : "Punch In"}
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <div className="p-4 rounded-lg border border-border bg-surface shadow-sm">
          General
        </div>
        <RoleGuard sub={["hr"]}>
          <HRPanel />
        </RoleGuard>
        <RoleGuard sub={["manager"]}>
          <div className="p-4 rounded-lg border border-border bg-surface shadow-sm">
            Manager Panel
          </div>
        </RoleGuard>
      </div>
    </div>
  );
}

type CompanyEmployee = { id: string; name: string };

function HRPanel() {
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [leaveMap, setLeaveMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setErr(null);
        setLoading(true);
        const [emps, leaves] = await Promise.all([
          api.get("/companies/employees"),
          api.get("/leaves/company/today"),
        ]);
        setEmployees(emps.data.employees || []);
        const map: Record<string, boolean> = {};
        (leaves.data.leaves || []).forEach((l: any) => {
          const id = l.employee.id || l.employee._id;
          map[id] = true;
        });
        setLeaveMap(map);
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load HR data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="p-4 rounded-lg border border-border bg-surface shadow-sm">
      <div className="mb-4 font-semibold">HR Panel</div>
      {err && (
        <div className="mb-4 rounded-md border border-error/20 bg-red-50 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}
      {loading ? (
        <div>Loading…</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="px-2 py-1">Employee</th>
              <th className="px-2 py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-t border-border/70">
                <td className="px-2 py-1">{e.name}</td>
                <td className="px-2 py-1">
                  {leaveMap[e.id] ? "On Leave" : "Present"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
