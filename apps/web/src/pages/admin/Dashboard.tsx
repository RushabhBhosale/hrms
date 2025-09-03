import { useEffect, useRef, useState, useMemo } from "react";
import { api } from "../../lib/api";
import ProjectTime from "../report/ProjectTime";
import { Users, UserCheck } from "lucide-react";

type EmployeeLite = {
  id: string;
  name: string;
  email: string;
  subRoles: string[];
};
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
  const [runResult, setRunResult] = useState<{
    candidates: number;
    closed: number;
  } | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [leaveMap, setLeaveMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function load() {
      try {
        setErr(null);
        setLoadingProjects(true);
        const [empRes, att, projRes, leavesRes] = await Promise.all([
          api.get("/companies/employees"),
          api.get("/attendance/company/today"),
          api.get("/projects"),
          api.get("/leaves/company/today"),
        ]);
        const empList: EmployeeLite[] = empRes.data.employees || [];
        const projList: ProjectLite[] = (projRes.data.projects || []).filter(
          (p: ProjectLite) => !p.isPersonal
        );
        setEmployees(empList);
        setProjects(projList);
        const lmap: Record<string, boolean> = {};
        (leavesRes.data.leaves || []).forEach((l: any) => {
          const id = l.employee.id || l.employee._id;
          lmap[id] = true;
        });
        setLeaveMap(lmap);
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
    if (!employees.length || !projects.length)
      return [] as { emp: EmployeeLite; projs: ProjectLite[] }[];
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

  // Project assignments table controls
  const [assignQ, setAssignQ] = useState("");
  const [assignPage, setAssignPage] = useState(1);
  const [assignLimit, setAssignLimit] = useState(20);
  const filteredAssignments = useMemo(() => {
    const term = assignQ.trim().toLowerCase();
    if (!term) return assignments;
    return assignments.filter(({ emp }) =>
      emp.name.toLowerCase().includes(term) || emp.email.toLowerCase().includes(term)
    );
  }, [assignments, assignQ]);
  const assignTotal = filteredAssignments.length;
  const assignPages = Math.max(1, Math.ceil(assignTotal / Math.max(1, assignLimit)));
  const assignStart = assignTotal === 0 ? 0 : (assignPage - 1) * assignLimit + 1;
  const assignEnd = Math.min(assignTotal, assignPage * assignLimit);
  const assignRows = useMemo(() => filteredAssignments.slice((assignPage-1)*assignLimit, (assignPage-1)*assignLimit + assignLimit), [filteredAssignments, assignPage, assignLimit]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Admin Dashboard</h2>
        <p className="text-sm text-muted">
          Overview of company workforce and attendance today.
        </p>
      </div>

      {/* Project time analytics at top */}
      <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
        <ProjectTime />
      </section>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
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

      {/* Project assignments */}
      <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold">Project Assignments</h3>
            <p className="text-sm text-muted">
              Employees and their assigned projects
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={assignQ}
              onChange={(e) => { setAssignPage(1); setAssignQ(e.target.value); }}
              placeholder="Search name or email…"
              className="h-10 w-64 rounded-md border border-border bg-surface px-3"
            />
            <select
              className="h-10 rounded-md border border-border bg-surface px-2 text-sm"
              value={assignLimit}
              onChange={(e)=>{ setAssignPage(1); setAssignLimit(parseInt(e.target.value,10)); }}
            >
              {[10,20,50,100].map(n=> <option key={n} value={n}>{n} / page</option>)}
            </select>
            <button
            onClick={() => {
              // quick refresh of employees and projects
              (async () => {
                try {
                  setLoadingProjects(true);
                  const [empRes, projRes, leavesRes] = await Promise.all([
                    api.get("/companies/employees"),
                    api.get("/projects"),
                    api.get("/leaves/company/today"),
                  ]);
                  const empList: EmployeeLite[] = empRes.data.employees || [];
                  const projList: ProjectLite[] = (
                    projRes.data.projects || []
                  ).filter((p: ProjectLite) => !p.isPersonal);
                  setEmployees(empList);
                  setProjects(projList);
                  const lmap: Record<string, boolean> = {};
                  (leavesRes.data.leaves || []).forEach((l: any) => {
                    const id = l.employee.id || l.employee._id;
                    lmap[id] = true;
                  });
                  setLeaveMap(lmap);
                  setStats((s) => ({ ...s, employees: empList.length }));
                } finally {
                  setLoadingProjects(false);
                }
              })();
            }}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-bg disabled:opacity-60"
            disabled={loadingProjects}
          >
            {loadingProjects ? "Refreshing…" : "Refresh"}
          </button>
          </div>
        </div>

        <div className="mt-3 text-sm text-muted">{loadingProjects ? 'Loading…' : `Showing ${assignStart}-${assignEnd} of ${assignTotal}`}</div>

        <div className="mt-2 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-2 pr-4 font-medium">Employee</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Projects</th>
              </tr>
            </thead>
            <tbody>
              {assignRows.map(({ emp, projs }) => (
                <tr key={emp.id} className="border-t border-border/60">
                  <td className="py-2 pr-4 whitespace-nowrap">{emp.name}</td>
                  <td className="py-2 pr-4 text-muted whitespace-nowrap">
                    {emp.email}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <span
                      className={[
                        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium",
                        leaveMap[emp.id]
                          ? "bg-accent/10 text-accent"
                          : "bg-secondary/10 text-secondary",
                      ].join(" ")}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          leaveMap[emp.id] ? "bg-accent" : "bg-secondary"
                        }`}
                      />
                      {leaveMap[emp.id] ? "On Leave" : "Present"}
                    </span>
                  </td>
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
              {assignTotal === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-muted">
                    {loadingProjects
                      ? "Loading assignments…"
                      : "No employees or projects found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          <button className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50" onClick={()=>setAssignPage(1)} disabled={assignPage===1}>First</button>
          <button className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50" onClick={()=>setAssignPage(p=>Math.max(1,p-1))} disabled={assignPage===1}>Prev</button>
          <div className="text-sm text-muted">Page {assignPage} of {assignPages}</div>
          <button className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50" onClick={()=>setAssignPage(p=>Math.min(assignPages,p+1))} disabled={assignPage>=assignPages}>Next</button>
          <button className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50" onClick={()=>setAssignPage(assignPages)} disabled={assignPage>=assignPages}>Last</button>
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
