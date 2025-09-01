import { useEffect, useRef, useState, useMemo } from "react";
import { api } from "../../lib/api";
import { Users, UserCheck } from "lucide-react";

type EmployeeLite = { id: string; name: string; email: string; subRoles: string[] };
type ProjectLite = {
  _id: string;
  title: string;
  teamLead: string;
  members: string[];
  isPersonal?: boolean;
};

type Attendance = {
  firstPunchIn?: string;
  lastPunchOut?: string;
  lastPunchIn?: string;
  workedMs?: number;
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

export default function AdminDash() {
  const [stats, setStats] = useState({ employees: 0, present: 0 });
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [loadingAtt, setLoadingAtt] = useState(true);
  const [pending, setPending] = useState<"in" | "out" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ candidates: number; closed: number } | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setErr(null);
        setLoadingProjects(true);
        const [empRes, att, projRes] = await Promise.all([
          api.get("/companies/employees"),
          api.get("/attendance/company/today"),
          api.get("/projects"),
        ]);
        const empList: EmployeeLite[] = empRes.data.employees || [];
        const projList: ProjectLite[] = (projRes.data.projects || []).filter((p: ProjectLite) => !p.isPersonal);
        setEmployees(empList);
        setProjects(projList);
        setStats({
          employees: empList.length,
          present: att.data.attendance.length,
        });
      } catch (err: any) {
        console.error(err);
        setErr(err?.response?.data?.error || "Failed to load dashboard data");
      } finally {
        setLoadingProjects(false);
      }
    }
    load();
  }, []);

  async function loadAttendance() {
    try {
      setErr(null);
      setLoadingAtt(true);
      const res = await api.get("/attendance/today");
      setAttendance(res.data.attendance ?? null);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load attendance");
    } finally {
      setLoadingAtt(false);
    }
  }

  async function punch(action: "in" | "out") {
    if (pending) return;
    try {
      setPending(action);
      await api.post("/attendance/punch", { action });
      await loadAttendance();
    } catch (e: any) {
      setErr(e?.response?.data?.error || `Failed to punch ${action}`);
    } finally {
      setPending(null);
    }
  }

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!attendance) {
      setElapsed(0);
      return;
    }
    const base = attendance.workedMs ?? 0;
    if (attendance.lastPunchIn && !attendance.lastPunchOut) {
      const start = new Date(attendance.lastPunchIn).getTime();
      const tick = () => setElapsed(base + (Date.now() - start));
      tick();
      timerRef.current = window.setInterval(tick, 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
    setElapsed(base);
  }, [attendance]);

  useEffect(() => {
    const handleVis = () => {
      if (document.hidden) return;
      setAttendance((prev) => (prev ? { ...prev } : prev));
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, []);

  useEffect(() => {
    loadAttendance();
  }, []);

  const punchedIn = Boolean(
    attendance?.lastPunchIn && !attendance?.lastPunchOut
  );

  const assignments = useMemo(() => {
    if (!employees.length || !projects.length) return [] as { emp: EmployeeLite; projs: ProjectLite[] }[];
    return employees
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((emp) => {
        const projs = projects.filter(
          (p) => p.teamLead === emp.id || (p.members || []).includes(emp.id)
        );
        return { emp, projs };
      });
  }, [employees, projects]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Admin Dashboard</h2>
        <p className="text-sm text-muted">
          Overview of company workforce and attendance today.
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
              onClick={loadAttendance}
              disabled={loadingAtt || !!pending}
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
            >
              {loadingAtt ? "Loading…" : "Refresh"}
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

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card
          icon={<Users size={22} />}
          title="Total Employees"
          value={stats.employees}
          tone="primary"
        />
        <Card
          icon={<UserCheck size={22} />}
          title="Today's Attendance"
          value={stats.present}
          tone="secondary"
        />
      </div>

      {/* Utilities */}
      <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
        <div className="mb-2 font-semibold">Utilities</div>
        {runErr && (
          <div className="mb-3 rounded-md border border-error/20 bg-red-50 px-3 py-2 text-sm text-error">
            {runErr}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-md bg-secondary px-3 py-2 text-white disabled:opacity-60"
            onClick={async () => {
              if (runLoading) return;
              setRunErr(null);
              setRunResult(null);
              try {
                setRunLoading(true);
                const res = await api.post("/attendance/admin/auto-punchout/run");
                setRunResult(res.data?.result || null);
                setLastRunAt(new Date().toLocaleString());
              } catch (e: any) {
                setRunErr(e?.response?.data?.error || "Failed to run auto punch-out");
              } finally {
                setRunLoading(false);
              }
            }}
            disabled={runLoading}
          >
            {runLoading ? "Running…" : "Run Auto Punch-out"}
          </button>
          {runResult && (
            <div className="text-sm text-muted">
              Closed {runResult.closed} of {runResult.candidates} candidates
              {lastRunAt ? ` • ${lastRunAt}` : ""}
            </div>
          )}
        </div>
      </section>

      {/* Project assignments */}
      <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Project Assignments</h3>
            <p className="text-sm text-muted">Employees and their assigned projects</p>
          </div>
          <button
            onClick={() => {
              // quick refresh of employees and projects
              (async () => {
                try {
                  setLoadingProjects(true);
                  const [empRes, projRes] = await Promise.all([
                    api.get("/companies/employees"),
                    api.get("/projects"),
                  ]);
                  const empList: EmployeeLite[] = empRes.data.employees || [];
                  const projList: ProjectLite[] = (projRes.data.projects || []).filter((p: ProjectLite) => !p.isPersonal);
                  setEmployees(empList);
                  setProjects(projList);
                  setStats((s) => ({ ...s, employees: empList.length }));
                } finally {
                  setLoadingProjects(false);
                }
              })();
            }}
            className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
            disabled={loadingProjects}
          >
            {loadingProjects ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="mt-4 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-2 pr-4 font-medium">Employee</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 font-medium">Projects</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map(({ emp, projs }) => (
                <tr key={emp.id} className="border-t border-border/60">
                  <td className="py-2 pr-4 whitespace-nowrap">{emp.name}</td>
                  <td className="py-2 pr-4 text-muted whitespace-nowrap">{emp.email}</td>
                  <td className="py-2">
                    {projs.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {projs.map((p) => (
                          <span
                            key={p._id}
                            className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs"
                            title={p.title}
                          >
                            {p.title}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted">No assignments</span>
                    )}
                  </td>
                </tr>
              ))}
              {assignments.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-muted">
                    {loadingProjects ? "Loading assignments…" : "No employees or projects found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Card({
  icon,
  title,
  value,
  tone = "primary",
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  tone?: "primary" | "secondary" | "accent";
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    secondary: "bg-secondary/10 text-secondary",
    accent: "bg-accent/10 text-accent",
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm flex items-center gap-4">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-full ${tones[tone]}`}
      >
        {icon}
      </div>
      <div className="space-y-1">
        <div className="text-sm text-muted">{title}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </div>
    </div>
  );
}
