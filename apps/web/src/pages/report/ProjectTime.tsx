import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { getEmployee } from "../../lib/auth";

type EmployeeLite = { id: string; name: string; email: string };
type Project = { _id: string; title: string };
type TimeLog = { minutes: number; note?: string; addedBy: string; createdAt: string };
type Task = {
  _id: string;
  title: string;
  assignedTo: string;
  project: string;
  timeLogs?: TimeLog[];
  timeSpentMinutes?: number;
};

function startOfMonthStr(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  return x.toISOString();
}
function endOfMonthStr(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return x.toISOString();
}
function parseMonthStr(month: string) {
  // month: yyyy-mm
  const [y, m] = month.split("-").map(Number);
  const start = new Date(y, (m || 1) - 1, 1);
  const end = new Date(y, (m || 1), 0, 23, 59, 59, 999);
  return { start, end };
}
function minutesToHours(min: number) {
  return Math.round((min / 60) * 100) / 100;
}

// A tiny SVG donut chart for professional look without external deps
function Donut({
  data,
  size = 200,
  thickness = 26,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2;
  const ir = r - thickness;
  let a = -90; // start at top
  const arcs = data.map((d) => {
    const ang = (d.value / total) * 360;
    const s = a;
    const e = a + ang;
    a = e;
    return { ...d, start: s, end: e };
  });

  function arcPath(startAngle: number, endAngle: number) {
    const sa = (startAngle * Math.PI) / 180;
    const ea = (endAngle * Math.PI) / 180;
    const x1 = r + r * Math.cos(sa);
    const y1 = r + r * Math.sin(sa);
    const x2 = r + r * Math.cos(ea);
    const y2 = r + r * Math.sin(ea);
    const xi1 = r + ir * Math.cos(ea);
    const yi1 = r + ir * Math.sin(ea);
    const xi2 = r + ir * Math.cos(sa);
    const yi2 = r + ir * Math.sin(sa);
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1}
            A ${r} ${r} 0 ${large} 1 ${x2} ${y2}
            L ${xi1} ${yi1}
            A ${ir} ${ir} 0 ${large} 0 ${xi2} ${yi2}
            Z`;
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* background ring */}
      <circle cx={r} cy={r} r={ir} fill="white" />
      {arcs.map((seg, i) => (
        <path key={i} d={arcPath(seg.start, seg.end)} fill={seg.color} />
      ))}
      {/* inner circle to create ring effect */}
      <circle cx={r} cy={r} r={ir} fill="white" />
    </svg>
  );
}

// Horizontal stacked bars using divs (responsive, no deps)
function StackedBars({
  rows,
  legend,
}: {
  rows: { label: string; total: number; segments: { key: string; value: number; color: string }[] }[];
  legend: { key: string; label: string; color: string }[];
}) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs">
        {legend.map((l) => (
          <div key={l.key} className="inline-flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: l.color }} />
            <span className="text-muted">{l.label}</span>
          </div>
        ))}
      </div>
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{r.label}</span>
              <span className="text-muted">{minutesToHours(r.total)} h</span>
            </div>
            <div className="h-6 w-full bg-bg border border-border rounded overflow-hidden flex">
              {r.segments
                .filter((s) => s.value > 0)
                .map((s, idx) => (
                  <div
                    key={idx}
                    className="h-full relative"
                    style={{ width: `${(s.value / max) * 100}%`, background: s.color }}
                    title={`${s.key}: ${minutesToHours(s.value)} h`}
                  >
                    {/* optional label inside segment if wide enough */}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProjectTime() {
  const me = getEmployee();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // yyyy-mm
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [employeeId, setEmployeeId] = useState<string>("ALL");
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<string, Task[]>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Color palettes
  const palette = [
    "#2563eb",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#14b8a6",
    "#f43f5e",
    "#22c55e",
    "#eab308",
    "#0ea5e9",
  ];

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        // Load employees and projects
        const [empsRes, projsRes] = await Promise.all([
          api.get("/companies/employees"),
          api.get("/projects"),
        ]);
        const emps = (empsRes.data.employees || []) as EmployeeLite[];
        setEmployees(emps);
        const projs = (projsRes.data.projects || []) as any[];
        setProjects(projs.map((p) => ({ _id: p._id, title: p.title })));

        // Load tasks for each project (includes timeLogs)
        const taskMap: Record<string, Task[]> = {};
        await Promise.all(
          projs.map(async (p) => {
            try {
              const t = await api.get(`/projects/${p._id}/tasks`);
              const list = (t.data.tasks || []) as Task[];
              taskMap[p._id] = list;
            } catch {
              taskMap[p._id] = [];
            }
          })
        );
        setTasksByProject(taskMap);
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const { start, end } = useMemo(() => parseMonthStr(month), [month]);

  // Aggregations
  const agg = useMemo(() => {
    const byProject: Record<string, number> = {};
    const byProjectByEmp: Record<string, Record<string, number>> = {};
    const byEmpTotal: Record<string, number> = {};
    const byDay: Record<string, number> = {};

    const includeEmp = (empId: string) => employeeId === "ALL" || employeeId === empId;

    for (const pid of Object.keys(tasksByProject)) {
      const tasks = tasksByProject[pid] || [];
      for (const t of tasks) {
        const logs = (t.timeLogs || []) as TimeLog[];
        for (const l of logs) {
          const when = new Date(l.createdAt);
          if (when < start || when > end) continue;
          if (!includeEmp(String(l.addedBy))) continue;
          byProject[pid] = (byProject[pid] || 0) + (l.minutes || 0);
          byProjectByEmp[pid] = byProjectByEmp[pid] || {};
          byProjectByEmp[pid][String(l.addedBy)] = (byProjectByEmp[pid][
            String(l.addedBy)
          ] || 0) + (l.minutes || 0);
          byEmpTotal[String(l.addedBy)] = (byEmpTotal[String(l.addedBy)] || 0) + (l.minutes || 0);
          const key = when.toISOString().slice(0, 10);
          byDay[key] = (byDay[key] || 0) + (l.minutes || 0);
        }
      }
    }

    // Prepare donut data: share of time by project
    const donut = Object.keys(byProject)
      .sort((a, b) => (byProject[b] || 0) - (byProject[a] || 0))
      .map((pid, i) => ({
        id: pid,
        label: projects.find((p) => p._id === pid)?.title || "Project",
        value: byProject[pid] || 0,
        color: palette[i % palette.length],
      }));

    // Prepare stacked bars: per project segments by employee
    const empMap = new Map(employees.map((e) => [e.id, e.name]));
    const legendKeys = new Set<string>();
    const rows = Object.keys(byProjectByEmp).map((pid, i) => {
      const segs = Object.entries(byProjectByEmp[pid])
        .sort((a, b) => b[1] - a[1])
        .map(([emp, val], j) => {
          const key = String(emp);
          legendKeys.add(key);
          return { key, value: val, color: palette[j % palette.length] };
        });
      return {
        label: projects.find((p) => p._id === pid)?.title || "Project",
        total: segs.reduce((s, x) => s + x.value, 0),
        segments: segs,
      };
    });

    // Build legend from ordered employees by total contribution
    const legend = Array.from(legendKeys)
      .map((k, idx) => ({ key: k, label: empMap.get(k) || "Employee", color: palette[idx % palette.length] }))
      .sort((a, b) => (byEmpTotal[b.key] || 0) - (byEmpTotal[a.key] || 0));

    // Summary
    const totalMinutes = Object.values(byProject).reduce((s, v) => s + v, 0);
    const activeProjects = Object.keys(byProject).length;
    const topProjectId = Object.entries(byProject).sort((a, b) => b[1] - a[1])[0]?.[0];
    const topProject = topProjectId ? projects.find((p) => p._id === topProjectId)?.title : undefined;
    const topContributorId = Object.entries(byEmpTotal).sort((a, b) => b[1] - a[1])[0]?.[0];
    const topContributor = topContributorId ? empMap.get(topContributorId) : undefined;
    const avgPerActiveDay = (() => {
      const days = Object.keys(byDay).length || 1;
      return Math.round(((totalMinutes / days) / 60) * 100) / 100;
    })();

    return {
      donut,
      rows,
      legend,
      summary: {
        totalHours: minutesToHours(totalMinutes),
        activeProjects,
        topProject: topProject || "-",
        topContributor: employeeId === "ALL" ? topContributor || "-" : employees.find((e) => e.id === employeeId)?.name || "-",
        avgPerActiveDay,
      },
    };
  }, [tasksByProject, projects, employees, month, employeeId]);

  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, (m || 1) - 1, 1);
    return d.toLocaleDateString([], { month: "long", year: "numeric" });
  }, [month]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-semibold">Project Time Analytics</h2>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-10 rounded-md border border-border bg-surface px-3"
          />
          <select
            className="h-10 rounded-md border border-border bg-surface px-3"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="ALL">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">{err}</div>
      )}
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-md border border-border bg-surface p-4">
              <div className="text-xs text-muted">Total Hours ({monthLabel})</div>
              <div className="text-2xl font-semibold mt-1">{agg.summary.totalHours} h</div>
            </div>
            <div className="rounded-md border border-border bg-surface p-4">
              <div className="text-xs text-muted">Active Projects</div>
              <div className="text-2xl font-semibold mt-1">{agg.summary.activeProjects}</div>
            </div>
            <div className="rounded-md border border-border bg-surface p-4">
              <div className="text-xs text-muted">Top Project</div>
              <div className="text-base font-medium mt-1">{agg.summary.topProject}</div>
            </div>
            <div className="rounded-md border border-border bg-surface p-4">
              <div className="text-xs text-muted">{employeeId === "ALL" ? "Top Contributor" : "Selected Employee"}</div>
              <div className="text-base font-medium mt-1">{agg.summary.topContributor}</div>
              <div className="text-xs text-muted mt-1">Avg per active day: {agg.summary.avgPerActiveDay} h</div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-md border border-border bg-surface p-4">
              <div className="text-sm font-medium mb-2">Time by Project</div>
              {agg.donut.length ? (
                <div className="flex items-center gap-6 flex-wrap">
                  <Donut data={agg.donut} />
                  <div className="space-y-2 text-sm">
                    {agg.donut.map((d) => (
                      <div key={d.id} className="flex items-center gap-3">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ background: d.color }} />
                        <span className="truncate max-w-[200px]" title={d.label}>{d.label}</span>
                        <span className="text-muted">{minutesToHours(d.value)} h</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted">No time logged in {monthLabel}.</div>
              )}
            </div>

            <div className="rounded-md border border-border bg-surface p-4">
              <div className="text-sm font-medium mb-2">Who worked how much (per project)</div>
              {agg.rows.length ? (
                <StackedBars rows={agg.rows} legend={agg.legend} />
              ) : (
                <div className="text-sm text-muted">No data</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

