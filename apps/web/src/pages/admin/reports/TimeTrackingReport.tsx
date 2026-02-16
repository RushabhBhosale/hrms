import { useEffect, useMemo, useState } from "react";
import ReportingPersonMultiSelect from "../../../components/ReportingPersonMultiSelect";
import { api } from "../../../lib/api";
import * as XLSX from "xlsx";
import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";

type EmployeeLite = { id: string; name: string; email?: string };

type EmployeeRow = {
  employeeId: string;
  name?: string;
  email?: string;
  totalMinutes: number;
  projects: {
    projectId: string;
    projectTitle: string;
    minutes: number;
    tasks: { taskId: string; taskTitle: string; minutes: number }[];
  }[];
};

type ProjectRow = {
  projectId: string;
  title?: string;
  totalMinutes: number;
  contributors: {
    employeeId: string;
    name?: string;
    email?: string;
    minutes: number;
    tasks: { taskId: string; taskTitle: string; minutes: number }[];
  }[];
};

type ProjectTableRow = {
  projectId: string;
  title: string;
  total: number;
  contributor: string;
  contributorHours: number;
  tasks: { title: string; hours: number }[];
};

export default function TimeTrackingReport() {
  const [month, setMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [employeeRows, setEmployeeRows] = useState<EmployeeRow[]>([]);
  const [projectRows, setProjectRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empPage, setEmpPage] = useState(1);
  const [projPage, setProjPage] = useState(1);
  const [empLimit, setEmpLimit] = useState(25);
  const [projLimit, setProjLimit] = useState(25);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/employees");
        setEmployees(res.data.employees || []);
      } catch {
        // ignore
      }
    })();
  }, []);

  const employeeOptions = useMemo(
    () =>
      employees.map((e) => ({
        value: e.id,
        label: e.name || e.email || e.id,
      })),
    [employees],
  );
  const projectOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [];
    projectRows.forEach((p) => {
      const id = String(p.projectId);
      if (seen.has(id)) return;
      seen.add(id);
      opts.push({ value: id, label: p.title || "Untitled" });
    });
    return opts;
  }, [projectRows]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params: Record<string, string> = { month };
        if (selectedEmployees.length) {
          params.employees = selectedEmployees.join(",");
        }
        const [byEmp, byProj] = await Promise.all([
          api.get("/projects/reports/time/by-employee", { params }),
          api.get("/projects/reports/time/by-project", { params }),
        ]);
        setEmployeeRows(byEmp.data.rows || []);
        setProjectRows(byProj.data.rows || []);
      } catch (e: any) {
        setError(
          e?.response?.data?.error || "Failed to load time tracking report",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [month, selectedEmployees]);

  const employeeMap = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  );

  const filteredEmployeeRows = useMemo(() => {
    const projectSet = new Set(selectedProjects);
    return employeeRows
      .map((row) => {
        const filteredProjects = projectSet.size
          ? row.projects.filter((p) => projectSet.has(String(p.projectId)))
          : row.projects;
        return { ...row, projects: filteredProjects };
      })
      .filter((row) => row.projects.length > 0 || projectSet.size === 0);
  }, [employeeRows, selectedProjects]);

  const filteredProjectRows = useMemo(() => {
    const projectSet = new Set(selectedProjects);
    return projectSet.size
      ? projectRows.filter((p) => projectSet.has(String(p.projectId)))
      : projectRows;
  }, [projectRows, selectedProjects]);

  const employeeTableRows = useMemo(() => {
    return filteredEmployeeRows.flatMap((row) => {
      const emp = employeeMap.get(String(row.employeeId));
      const base = {
        employeeId: row.employeeId,
        name: row.name || emp?.name || "Unknown",
        email: row.email || emp?.email || "—",
        total: minutesToHours(row.totalMinutes),
      };
      if (!row.projects.length) {
        return [{ ...base, projectTitle: "—", projectHours: 0, tasks: [] }];
      }
      return row.projects.map((p) => ({
        ...base,
        projectTitle: p.projectTitle || "Untitled",
        projectHours: minutesToHours(p.minutes),
        tasks: (p.tasks || []).map((t) => ({
          title: t.taskTitle || "Untitled task",
          hours: minutesToHours(t.minutes),
        })),
      }));
    });
  }, [filteredEmployeeRows, employeeMap]);

  const projectTableRows: ProjectTableRow[] = useMemo(() => {
    return filteredProjectRows.flatMap((row) => {
      const base = {
        projectId: row.projectId,
        title: row.title || "Untitled",
        total: minutesToHours(row.totalMinutes),
      };
      if (!row.contributors.length) {
        return [
          {
            ...base,
            contributor: "—",
            contributorHours: 0,
            tasks: [],
          },
        ];
      }
      return row.contributors.map((c) => {
        const emp = employeeMap.get(String(c.employeeId));
        return {
          ...base,
          contributor: c.name || emp?.name || "Unknown",
          contributorHours: minutesToHours(c.minutes),
          tasks: (c.tasks || []).map((t) => ({
            title: t.taskTitle || "Untitled task",
            hours: minutesToHours(t.minutes),
          })),
        };
      });
    });
  }, [filteredProjectRows, employeeMap]);

  const totalEmployeeHours = useMemo(
    () =>
      employeeTableRows.reduce(
        (sum, row) => sum + (Number(row.projectHours) || 0),
        0,
      ),
    [employeeTableRows],
  );

  const totalProjectHours = useMemo(
    () =>
      projectTableRows.reduce(
        (sum, row) => sum + (Number(row.contributorHours) || 0),
        0,
      ),
    [projectTableRows],
  );

  const employeePages = useMemo(
    () => ({
      total: Math.max(1, Math.ceil(employeeTableRows.length / empLimit)),
      start: employeeTableRows.length === 0 ? 0 : (empPage - 1) * empLimit + 1,
      end: Math.min(employeeTableRows.length, empPage * empLimit),
    }),
    [employeeTableRows, empLimit, empPage],
  );

  const projectPages = useMemo(
    () => ({
      total: Math.max(1, Math.ceil(projectTableRows.length / projLimit)),
      start: projectTableRows.length === 0 ? 0 : (projPage - 1) * projLimit + 1,
      end: Math.min(projectTableRows.length, projPage * projLimit),
    }),
    [projectTableRows, projLimit, projPage],
  );

  useEffect(() => {
    if (empPage > employeePages.total) setEmpPage(employeePages.total);
    if (projPage > projectPages.total) setProjPage(projectPages.total);
  }, [empPage, projPage, employeePages.total, projectPages.total]);

  const pagedEmployeeRows = useMemo(() => {
    const startIdx = (empPage - 1) * empLimit;
    return employeeTableRows.slice(startIdx, startIdx + empLimit);
  }, [employeeTableRows, empPage, empLimit]);

  const pagedProjectRows = useMemo(() => {
    const startIdx = (projPage - 1) * projLimit;
    return projectTableRows.slice(startIdx, startIdx + projLimit);
  }, [projectTableRows, projPage, projLimit]);

  function minutesToHours(min: number) {
    return Math.round((min / 60) * 100) / 100;
  }

  useEffect(() => {
    setEmpPage(1);
    setProjPage(1);
  }, [selectedProjects, selectedEmployees, month]);

  function exportEmployeesExcel() {
    const targetIds = new Set(
      selectedEmployees.length
        ? selectedEmployees
        : employeeTableRows.map((r) => r.employeeId),
    );
    const rows = employeeTableRows.filter((r) => targetIds.has(r.employeeId));
    if (!rows.length) return;

    const wb = XLSX.utils.book_new();
    const data: (string | number)[][] = [
      ["Employee", "Project", "Task", "Hours"],
      ...rows.flatMap((r) => {
        if (!r.tasks.length)
          return [[r.name, r.projectTitle, "—", r.projectHours]];
        return r.tasks.map((t) => [r.name, r.projectTitle, t.title, t.hours]);
      }),
    ];
    const total = rows.reduce(
      (sum, r) => sum + (Number(r.projectHours) || 0),
      0,
    );
    data.push(["Total", "", "", total]);

    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Employees");
    const filename = `employee-hours-${month || "report"}.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  function exportProjectsExcel() {
    if (!projectTableRows.length) return;
    const wb = XLSX.utils.book_new();
    const data: (string | number)[][] = [
      ["Project", "Contributor", "Task", "Hours"],
      ...projectTableRows.flatMap((r) => {
        if (!r.tasks.length)
          return [[r.title, r.contributor, "—", r.contributorHours]];
        return r.tasks.map((t) => [r.title, r.contributor, t.title, t.hours]);
      }),
      ["Total", "", "", totalProjectHours],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Projects");
    const filename = `project-hours-${month || "report"}.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div>
          <h2 className="text-2xl font-semibold">Time Tracking</h2>
          <p className="text-sm text-muted-foreground">
            Hours logged by employees and projects for the selected month.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-[180px_repeat(2,minmax(0,1fr))] lg:grid-cols-[200px_repeat(2,minmax(0,1fr))]">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Month</label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Employees</label>
              <ReportingPersonMultiSelect
                options={employeeOptions}
                value={selectedEmployees}
                onChange={setSelectedEmployees}
                placeholder="Filter employees (optional)"
                emptyMessage="No employees"
                showEmpty={true}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Projects</label>
              <ReportingPersonMultiSelect
                options={projectOptions}
                value={selectedProjects}
                onChange={setSelectedProjects}
                placeholder="Filter projects (optional)"
                emptyMessage="No projects"
                showEmpty={true}
              />
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              onClick={exportProjectsExcel}
              disabled={!projectTableRows.length}
            >
              Export Projects Excel
            </Button>
            <Button
              type="button"
              onClick={exportEmployeesExcel}
              disabled={!employeeTableRows.length}
            >
              Export Employees Excel
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          <section className="rounded-lg border border-border bg-surface shadow-sm">
            <div className="border-b border-border px-4 py-3 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">By Employee</h3>
                <p className="text-xs text-muted-foreground">
                  Total hours and project split per employee.
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Showing {employeePages.start}-{employeePages.end} of{" "}
                  {employeeTableRows.length} rows
                </span>
                <Select
                  value={String(empLimit)}
                  onValueChange={(v) => {
                    setEmpLimit(parseInt(v, 10));
                    setEmpPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 min-w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} / page
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-bg text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Employee</th>
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 font-medium">Task</th>
                    <th className="px-3 py-2 font-medium">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedEmployeeRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-4 text-center text-muted-foreground"
                      >
                        No data for this month.
                      </td>
                    </tr>
                  ) : (
                    pagedEmployeeRows.flatMap((row, idx) => {
                      if (!row.tasks.length) {
                        return (
                          <tr
                            key={`${row.employeeId}-${idx}-empty`}
                            className="border-t border-border/60"
                          >
                            <td className="px-3 py-2 whitespace-nowrap">
                              {row.name}
                            </td>
                            <td className="px-3 py-2">{row.projectTitle}</td>
                            <td className="px-3 py-2 text-muted-foreground text-xs">
                              —
                            </td>
                            <td className="px-3 py-2">{row.projectHours} h</td>
                          </tr>
                        );
                      }
                      return row.tasks.map((t, tIdx) => (
                        <tr
                          key={`${row.employeeId}-${idx}-task-${tIdx}`}
                          className="border-t border-border/60"
                        >
                          <td className="px-3 py-2 whitespace-nowrap">
                            {row.name}
                          </td>
                          <td className="px-3 py-2">{row.projectTitle}</td>
                          <td className="px-3 py-2 text-xs">{t.title}</td>
                          <td className="px-3 py-2">{t.hours} h</td>
                        </tr>
                      ));
                    })
                  )}
                  {employeeTableRows.length > 0 && (
                    <tr className="border-t border-border/60 font-semibold">
                      <td className="px-3 py-2" colSpan={3}>
                        Total hours
                      </td>
                      <td className="px-3 py-2">
                        {totalEmployeeHours.toFixed(1)} h
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {employeeTableRows.length > 0 && (
              <div className="flex items-center justify-end gap-2 px-4 py-3 text-xs text-muted-foreground">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={empPage <= 1}
                  onClick={() => setEmpPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span>
                  Page {empPage} of {employeePages.total}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={empPage >= employeePages.total}
                  onClick={() =>
                    setEmpPage((p) => Math.min(employeePages.total, p + 1))
                  }
                >
                  Next
                </Button>
              </div>
            )}
          </section>

          {/* <section className="rounded-lg border border-border bg-surface shadow-sm">
            <div className="border-b border-border px-4 py-3 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">By Project</h3>
                <p className="text-xs text-muted-foreground">
                  Hours logged on each project with contributor breakdown (one
                  row per contributor).
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Showing {projectPages.start}-{projectPages.end} of {projectTableRows.length} rows
                </span>
                <select
                  className="h-8 rounded-md border border-border bg-surface px-2"
                  value={projLimit}
                  onChange={(e) => {
                    setProjLimit(parseInt(e.target.value, 10));
                    setProjPage(1);
                  }}
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n} / page
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-bg text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 font-medium">Contributor</th>
                    <th className="px-3 py-2 font-medium">Task</th>
                    <th className="px-3 py-2 font-medium">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedProjectRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-4 text-center text-muted-foreground"
                      >
                        No data for this month.
                      </td>
                    </tr>
                  ) : (
                    pagedProjectRows.flatMap((row, idx) => {
                      if (!row.tasks.length) {
                        return (
                          <tr
                            key={`${row.projectId}-${idx}-empty`}
                            className="border-t border-border/60"
                          >
                            <td className="px-3 py-2">{row.title}</td>
                            <td className="px-3 py-2">{row.contributor}</td>
                            <td className="px-3 py-2 text-muted-foreground text-xs">—</td>
                            <td className="px-3 py-2">
                              {row.contributorHours} h
                            </td>
                          </tr>
                        );
                      }
                      return row.tasks.map((t, tIdx) => (
                        <tr
                          key={`${row.projectId}-${idx}-task-${tIdx}`}
                          className="border-t border-border/60"
                        >
                          <td className="px-3 py-2">{row.title}</td>
                          <td className="px-3 py-2">{row.contributor}</td>
                          <td className="px-3 py-2 text-xs">{t.title}</td>
                          <td className="px-3 py-2">{t.hours} h</td>
                        </tr>
                      ));
                    })
                  )}
                  {projectTableRows.length > 0 && (
                    <tr className="border-t border-border/60 font-semibold">
                      <td className="px-3 py-2" colSpan={3}>
                        Total hours
                      </td>
                      <td className="px-3 py-2">
                        {totalProjectHours.toFixed(1)} h
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {projectTableRows.length > 0 && (
              <div className="flex items-center justify-end gap-2 px-4 py-3 text-xs text-muted-foreground">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={projPage <= 1}
                  onClick={() => setProjPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span>
                  Page {projPage} of {projectPages.total}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={projPage >= projectPages.total}
                  onClick={() =>
                    setProjPage((p) => Math.min(projectPages.total, p + 1))
                  }
                >
                  Next
                </Button>
              </div>
            )}
          </section> */}
        </>
      )}
    </div>
  );
}
