import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Th, Td } from "../../components/ui/Table";
import { getEmployee } from "../../lib/auth";

type EmployeeLite = { id: string; name: string; email: string };
type Project = {
  _id: string;
  title: string;
  estimatedTimeMinutes?: number;
  startTime?: string;
  isPersonal?: boolean;
};
type TimeLog = {
  minutes: number;
  note?: string;
  addedBy: string;
  createdAt: string;
};
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
  const end = new Date(y, m || 1, 0, 23, 59, 59, 999);
  return { start, end };
}
function minutesToHours(min: number) {
  return Math.round((min / 60) * 100) / 100;
}

// A tiny SVG donut chart for professional look without external deps
function Donut({
  data,
  size = 220,
  thickness = 28,
  centerLabel,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string; // e.g. "All Projects" or month label
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2;
  const ir = r - thickness;
  let a = -90;

  const arcs = data.map((d) => {
    const ang = (d.value / total) * 360;
    const s = a;
    const e = a + ang;
    a = e;
    return { ...d, start: s, end: e };
  });

  const nonZero = data.filter((d) => d.value > 0);
  const isSingleFull =
    nonZero.length === 1 && Math.abs(nonZero[0].value - total) < 1e-6;

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
    <div className="flex items-center gap-6 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {isSingleFull ? (
          <>
            <circle cx={r} cy={r} r={r} fill={nonZero[0].color} />
            <circle cx={r} cy={r} r={ir} fill="white" />
          </>
        ) : (
          <>
            {arcs.map((seg, i) => (
              <path key={i} d={arcPath(seg.start, seg.end)} fill={seg.color} />
            ))}
            <circle cx={r} cy={r} r={ir} fill="white" />
          </>
        )}
        {/* Center label */}
        <text
          x={r}
          y={r - 2}
          textAnchor="middle"
          fontSize="16"
          fontWeight="600"
          fill="#111827"
        >
          {Math.round((total / 60) * 100) / 100} h
        </text>
        {centerLabel ? (
          <text
            x={r}
            y={r + 16}
            textAnchor="middle"
            fontSize="11"
            fill="#6B7280"
          >
            {centerLabel}
          </text>
        ) : null}
      </svg>

      {/* Compact legend */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm min-w-[220px]">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-3">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: d.color }}
            />
            <span className="truncate max-w-[180px]" title={d.label}>
              {d.label}
            </span>
            <span className="text-muted">
              {Math.round((d.value / 60) * 100) / 100} h
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Horizontal stacked bars using divs (responsive, no deps)
function StackedBars({
  rows,
  legend,
  basePath,
}: {
  rows: {
    id: string;
    label: string;
    total: number;
    segments: { key: string; value: number; color: string }[];
  }[];
  legend: { key: string; label: string; color: string }[];
  basePath: string;
}) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2 text-xs max-h-52 overflow-auto pr-1">
        {legend.map((l) => (
          <div key={l.key} className="inline-flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: l.color }}
            />
            <span className="text-muted">{l.label}</span>
          </div>
        ))}
      </div>
      <div className="space-y-4">
        {rows.map((r) => {
          console.log("dhsds", rows);
          return (
            <div key={r.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  {r.id === 'PERSONAL' ? (
                    <span>{r.label}</span>
                  ) : (
                    <Link
                      to={`${basePath}/projects/${r.id}`}
                      className="text-primary hover:underline"
                    >
                      {r.label}
                    </Link>
                  )}
                </span>
                <span className="text-muted">
                  {Math.round((r.total / 60) * 100) / 100} h
                </span>
              </div>
              <div
                className="h-7 w-full border border-border rounded overflow-hidden flex"
                style={{
                  background:
                    "repeating-linear-gradient(45deg, rgba(0,0,0,0.03), rgba(0,0,0,0.03) 8px, transparent 8px, transparent 16px)",
                }}
              >
                {r.segments
                  .filter((s) => s.value > 0)
                  .map((s, idx) => {
                    const pct = (s.value / max) * 100;
                    const canLabel = pct > 10; // inline label if segment is wide enough
                    return (
                      <div
                        key={idx}
                        className="h-full relative"
                        style={{ width: `${pct}%`, background: s.color }}
                        title={`${s.key}: ${
                          Math.round((s.value / 60) * 100) / 100
                        } h`}
                      >
                        {canLabel && (
                          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium text-white/95">
                            {Math.round((s.value / 60) * 10) / 10}h
                          </span>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ProjectTime() {
  const me = getEmployee();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // yyyy-mm
  const [dateMode, setDateMode] = useState<"ALL" | "MONTH">("ALL");
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [employeeId, setEmployeeId] = useState<string>("ALL");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("ALL");
  const [tasksByProject, setTasksByProject] = useState<Record<string, Task[]>>(
    {}
  );
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

        // Split normal and personal projects
        const normalProjs = projs.filter((p) => !p.isPersonal);
        const personalProjs = projs.filter((p) => p.isPersonal);

        // Aggregate personal projects into a single global project
        const PERSONAL_ID = 'PERSONAL';
        const aggregatedProjects: Project[] = [
          ...normalProjs.map((p) => ({
            _id: p._id,
            title: p.title,
            estimatedTimeMinutes: p.estimatedTimeMinutes,
            startTime: p.startTime,
            isPersonal: !!p.isPersonal,
          })),
        ];
        if (personalProjs.length) {
          const estSum = personalProjs.reduce(
            (s, p) => s + (p.estimatedTimeMinutes || 0),
            0
          );
          const startTimes = personalProjs
            .map((p) => p.startTime)
            .filter(Boolean) as string[];
          const earliestStart = startTimes.length
            ? new Date(
                Math.min(
                  ...startTimes.map((d) => new Date(d).getTime())
                )
              ).toISOString()
            : undefined;
          aggregatedProjects.push({
            _id: PERSONAL_ID,
            title: 'Personal Tasks',
            estimatedTimeMinutes: estSum || undefined,
            startTime: earliestStart,
            isPersonal: true,
          });
        }
        setProjects(aggregatedProjects);

        // Load tasks for each project (includes timeLogs)
        const rawTaskMap: Record<string, Task[]> = {};
        await Promise.all(
          projs.map(async (p) => {
            try {
              const t = await api.get(`/projects/${p._id}/tasks`);
              const list = (t.data.tasks || []) as Task[];
              rawTaskMap[p._id] = list;
            } catch {
              rawTaskMap[p._id] = [];
            }
          })
        );
        // Re-map into aggregated task map with single PERSONAL bucket
        const aggregatedTaskMap: Record<string, Task[]> = {};
        for (const p of normalProjs) {
          aggregatedTaskMap[p._id] = rawTaskMap[p._id] || [];
        }
        if (personalProjs.length) {
          const allPersonal: Task[] = [];
          for (const p of personalProjs) {
            allPersonal.push(...(rawTaskMap[p._id] || []));
          }
          aggregatedTaskMap[PERSONAL_ID] = allPersonal;
        }
        setTasksByProject(aggregatedTaskMap);
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // All-time range from first available time log to now
  const allTimeRange = useMemo(() => {
    let minDate: Date | null = null;
    for (const pid of Object.keys(tasksByProject)) {
      const tasks = tasksByProject[pid] || [];
      for (const t of tasks) {
        const logs = (t.timeLogs || []) as TimeLog[];
        for (const l of logs) {
          const when = new Date(l.createdAt);
          if (!minDate || when < minDate) minDate = when;
        }
      }
    }
    return {
      start:
        minDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      end: new Date(),
    };
  }, [tasksByProject]);

  const { start, end } = useMemo(() => {
    return dateMode === "MONTH" ? parseMonthStr(month) : allTimeRange;
  }, [dateMode, month, allTimeRange]);

  // Aggregations
  const agg = useMemo(() => {
    const byProject: Record<string, number> = {};
    const byProjectByEmp: Record<string, Record<string, number>> = {};
    const byEmpTotal: Record<string, number> = {};
    const byDay: Record<string, number> = {};

    const includeEmp = (empId: string) =>
      employeeId === "ALL" || employeeId === empId;

    for (const pid of Object.keys(tasksByProject)) {
      if (projectId !== "ALL" && pid !== projectId) continue;
      const tasks = tasksByProject[pid] || [];
      for (const t of tasks) {
        const logs = (t.timeLogs || []) as TimeLog[];
        for (const l of logs) {
          const when = new Date(l.createdAt);
          if (when < start || when > end) continue;
          if (!includeEmp(String(l.addedBy))) continue;
          byProject[pid] = (byProject[pid] || 0) + (l.minutes || 0);
          byProjectByEmp[pid] = byProjectByEmp[pid] || {};
          byProjectByEmp[pid][String(l.addedBy)] =
            (byProjectByEmp[pid][String(l.addedBy)] || 0) + (l.minutes || 0);
          byEmpTotal[String(l.addedBy)] =
            (byEmpTotal[String(l.addedBy)] || 0) + (l.minutes || 0);
          const key = when.toISOString().slice(0, 10);
          byDay[key] = (byDay[key] || 0) + (l.minutes || 0);
        }
      }
    }

    // Prepare donut data
    // - If a specific project is selected: show breakdown by employees for that project
    // - Otherwise: show share of time by project
    const donut =
      projectId !== "ALL"
        ? Object.entries(byProjectByEmp[projectId] || {})
            .sort((a, b) => b[1] - a[1])
            .map(([empId, val], i) => ({
              id: String(empId),
              label: employees.find((e) => e.id === empId)?.name || "Employee",
              value: val || 0,
              color: palette[i % palette.length],
            }))
        : Object.keys(byProject)
            .sort((a, b) => (byProject[b] || 0) - (byProject[a] || 0))
            .map((pid, i) => ({
              id: pid,
              label: projects.find((p) => p._id === pid)?.title || "Project",
              value: byProject[pid] || 0,
              color: palette[i % palette.length],
            }));

    // Prepare stacked bars: per project segments by employee
    const empMap = new Map(employees.map((e) => [e.id, e.name]));
    // Establish a stable color per employee based on total contribution
    const empOrder = Object.keys(byEmpTotal).sort(
      (a, b) => (byEmpTotal[b] || 0) - (byEmpTotal[a] || 0)
    );
    const empColor = new Map<string, string>(
      empOrder.map((id, idx) => [id, palette[idx % palette.length]])
    );

    const rows = Object.keys(byProjectByEmp).map((pid) => {
      const segs = Object.entries(byProjectByEmp[pid])
        .sort((a, b) => b[1] - a[1])
        .map(([emp, val]) => {
          const key = String(emp);
          return { key, value: val, color: empColor.get(key) || palette[0] };
        });
      return {
        id: pid,
        label: projects.find((p) => p._id === pid)?.title || "Project",
        total: segs.reduce((s, x) => s + x.value, 0),
        segments: segs,
      };
    });

    // Build legend from ordered employees by total contribution with stable colors
    const legend = empOrder.map((k) => ({
      key: k,
      label: empMap.get(k) || "Employee",
      color: empColor.get(k) || palette[0],
    }));

    // Summary
    const totalMinutes = Object.values(byProject).reduce((s, v) => s + v, 0);
    const activeProjects = Object.keys(byProject).length;
    const avgPerActiveDay = (() => {
      const days = Object.keys(byDay).length || 1;
      return Math.round((totalMinutes / days / 60) * 100) / 100;
    })();

    const selectedSpent =
      projectId !== "ALL" ? byProject[projectId] || 0 : undefined;
    const selectedEst =
      projectId !== "ALL"
        ? projects.find((p) => p._id === projectId)?.estimatedTimeMinutes || 0
        : undefined;

    return {
      donut,
      rows,
      legend,
      summary: {
        totalHours: minutesToHours(totalMinutes),
        activeProjects,
        avgPerActiveDay,
        selectedProjectId: projectId !== "ALL" ? projectId : undefined,
        selectedEstimatedHours:
          selectedEst !== undefined ? minutesToHours(selectedEst) : undefined,
        selectedSpentHours:
          selectedSpent !== undefined
            ? minutesToHours(selectedSpent)
            : undefined,
      },
    };
  }, [tasksByProject, projects, employees, start, end, employeeId, projectId]);

  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, (m || 1) - 1, 1);
    return d.toLocaleDateString([], { month: "long", year: "numeric" });
  }, [month]);

  const timeLabel = useMemo(
    () => (dateMode === "MONTH" ? monthLabel : "All Dates"),
    [dateMode, monthLabel]
  );

  // Determine base path for project details links
  const basePath = useMemo(() => {
    const role = me?.primaryRole;
    return role === "ADMIN" || role === "SUPERADMIN" ? "/admin" : "/app";
  }, [me?.primaryRole]);

  // Table data: per-project spent within current filters
  const projectTable = useMemo(() => {
    const rows = projects
      .filter((p) => projectId === "ALL" || p._id === projectId)
      .map((p) => {
        const tasks = tasksByProject[p._id] || [];
        let spent = 0;
        for (const t of tasks) {
          const logs = (t.timeLogs || []) as TimeLog[];
          for (const l of logs) {
            const when = new Date(l.createdAt);
            if (when < start || when > end) continue;
            if (
              employeeId !== "ALL" &&
              String(l.addedBy) !== String(employeeId)
            )
              continue;

            spent += l.minutes || 0;
          }
        }
        return {
          id: p._id,
          title: p.title,
          estimatedMinutes: p.estimatedTimeMinutes || 0,
          spentMinutes: spent,
          startTime: p.startTime,
        };
      })
      .sort((a, b) => b.spentMinutes - a.spentMinutes);
    return rows;
  }, [projects, tasksByProject, start, end, employeeId, projectId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-semibold">Project Time Analytics</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="h-10 rounded-md border border-border bg-surface px-3"
            value={dateMode}
            onChange={(e) => setDateMode(e.target.value as any)}
          >
            <option value="ALL">All time</option>
            <option value="MONTH">Monthly</option>
          </select>
          {dateMode === "MONTH" && (
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-10 rounded-md border border-border bg-surface px-3"
            />
          )}
          <select
            className="h-10 rounded-md border border-border bg-surface px-3"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="ALL">All projects</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.title}
              </option>
            ))}
          </select>
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
        <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
          {err}
        </div>
      )}
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-md border border-border bg-surface p-4">
              <div className="text-xs text-muted">
                Total Hours ({timeLabel})
              </div>
              <div className="text-2xl font-semibold mt-1">
                {agg.summary.totalHours} h
              </div>
            </div>
            <div className="rounded-md border border-border bg-surface p-4">
              <div className="text-xs text-muted">Active Projects</div>
              <div className="text-2xl font-semibold mt-1">
                {agg.summary.activeProjects}
              </div>
            </div>
            {agg.summary.selectedProjectId && (
              <>
                <div className="rounded-md border border-border bg-surface p-4">
                  <div className="text-xs text-muted">
                    Estimated Time (selected project)
                  </div>
                  <div className="text-base font-medium mt-1">
                    {agg.summary.selectedEstimatedHours !== undefined
                      ? `${agg.summary.selectedEstimatedHours} h`
                      : "-"}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-surface p-4">
                  <div className="text-xs text-muted">
                    Spent Time (selected project)
                  </div>
                  <div className="text-base font-medium mt-1">
                    {agg.summary.selectedSpentHours !== undefined
                      ? `${agg.summary.selectedSpentHours} h`
                      : "-"}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Charts */}
          <div
            className={
              projects.length > 4 ? "space-y-6" : "grid lg:grid-cols-2 gap-6"
            }
          >
            <div className="rounded-md border border-border bg-surface p-5 min-h-[280px]">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-sm font-medium">
                  {projectId === "ALL"
                    ? "Time by Project"
                    : "Time by Employee (Selected Project)"}
                </div>
                <div className="text-xs text-muted">{timeLabel}</div>
              </div>
              {agg.donut.length ? (
                <Donut
                  data={agg.donut}
                  centerLabel={
                    projectId === "ALL" ? "All Projects" : "Selected Project"
                  }
                />
              ) : (
                <div className="text-sm text-muted">
                  No time logged in {timeLabel}.
                </div>
              )}
            </div>

            <div className="rounded-md border border-border bg-surface p-5 min-h-[280px]">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-sm font-medium">
                  Who worked how much (per project)
                </div>
                <div className="text-xs text-muted">Stacked totals</div>
              </div>
              {agg.rows.length ? (
                <StackedBars
                  rows={agg.rows}
                  legend={agg.legend}
                  basePath={basePath}
                />
              ) : (
                <div className="text-sm text-muted">No data</div>
              )}
            </div>
          </div>

          {/* Projects table */}
          <div className="rounded-md border border-border bg-surface p-4">
            <div className="text-sm font-medium mb-2">Projects</div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-bg border-b border-border">
                    <Th>Project</Th>
                    <Th>Start</Th>
                    <Th>Estimated (h)</Th>
                    <Th>Spent (h)</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {projectTable.map((r) => {
                    const over = r.spentMinutes - r.estimatedMinutes;
                    return (
                      <tr key={r.id} className="border-b border-border">
                        <Td>{r.title}</Td>
                        <Td>
                          {r.startTime
                            ? new Date(r.startTime).toLocaleDateString()
                            : "-"}
                        </Td>
                        <Td>{minutesToHours(r.estimatedMinutes)}</Td>
                        <Td>{minutesToHours(r.spentMinutes)}</Td>
                        <Td>
                          {over > 0 ? (
                            <span className="text-error">
                              Over by {minutesToHours(over)} h
                            </span>
                          ) : (
                            <span className="text-muted">
                              Remaining{" "}
                              {minutesToHours(
                                Math.max(0, r.estimatedMinutes - r.spentMinutes)
                              )}{" "}
                              h
                            </span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                  {projectTable.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-sm text-muted" colSpan={5}>
                        No projects
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
