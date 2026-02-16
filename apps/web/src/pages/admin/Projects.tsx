import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Th, Td } from "../../components/utils/Table";
import { toast } from "react-hot-toast";
import { getEmployee, hasPermission } from "../../lib/auth";
import type { PrimaryRole } from "../../lib/auth";
import { Link } from "react-router-dom";

type EmployeeLite = {
  id: string;
  name: string;
  email: string;
  subRoles: string[];
  primaryRole: PrimaryRole;
};

type Project = {
  _id: string;
  title: string;
  description?: string;
  techStack?: string[];
  teamLead: string;
  members: string[];
  estimatedTimeMinutes?: number;
  createdAt?: string;
  startTime?: string;
  isPersonal?: boolean;
  active?: boolean;
};

export default function ProjectsAdmin() {
  const u = getEmployee();
  const canManageProjects = hasPermission(u, "projects", "write");

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [spentByProject, setSpentByProject] = useState<Record<string, number>>(
    {},
  );

  async function load() {
    try {
      const [emps, projs] = await Promise.all([
        api.get("/companies/employees"),
        api.get("/projects"),
      ]);
      const projList: Project[] = projs.data.projects || [];
      setEmployees(emps.data.employees || []);
      setProjects(projList);

      const map: Record<string, number> = {};
      await Promise.all(
        projList.map(async (p) => {
          try {
            const t = await api.get(`/projects/${p._id}/time-summary`);
            map[p._id] = t.data.totalTimeSpentMinutes || 0;
          } catch {
            map[p._id] = 0;
          }
        }),
      );
      setSpentByProject(map);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to load projects");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function minutesToHours(min: number) {
    return Math.round((min / 60) * 10) / 10;
  }

  function fmtDate(s?: string) {
    if (!s) return "-";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Projects</h2>
        {canManageProjects && (
          <Link
            to="/admin/projects/new"
            className="h-10 px-4 rounded-md bg-primary text-white text-sm inline-flex items-center justify-center"
          >
            Add Project
          </Link>
        )}
      </div>

      {/* List as table */}
      <div className="overflow-auto border border-border rounded-md bg-surface">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-bg border-b border-border">
              <Th>Project</Th>
              <Th>Team Lead</Th>
              <Th>Members</Th>
              <Th>Start</Th>
              <Th>Est (h)</Th>
              <Th>Spent (h)</Th>
              <Th>Budget</Th>
              <Th>Active</Th>
              {/* <Th>Actions</Th> */}
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const est = p.estimatedTimeMinutes || 0;
              const spent = spentByProject[p._id] || 0;
              const over = spent - est;
              return (
                <tr key={p._id} className="border-b border-border">
                  <Td>
                    <Link to={`/admin/projects/${p._id}`}>
                      <div className="font-medium text-primary">{p.title}</div>
                      {p.description && (
                        <div
                          className="text-xs text-muted-foreground truncate max-w-[360px]"
                          title={p.description}
                        >
                          {p.description}
                        </div>
                      )}
                    </Link>
                  </Td>

                  <Td>
                    {employees.find((e) => e.id === p.teamLead)?.name || "—"}
                  </Td>
                  <Td>{p.members?.length || 0}</Td>
                  <Td>{fmtDate(p.startTime || p.createdAt)}</Td>
                  <Td>{minutesToHours(est)}</Td>
                  <Td>{minutesToHours(spent)}</Td>
                  <Td>
                    {over > 0 ? (
                      <span className="text-error">
                        + {minutesToHours(over)} h
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        - {minutesToHours(Math.max(0, est - spent))} h
                      </span>
                    )}
                  </Td>
                  <Td>
                    {p.isPersonal ? (
                      <span className="text-xs text-muted-foreground">
                        Personal
                      </span>
                    ) : (
                      <span
                        className={`text-xs px-2 py-0.5 rounded border ${
                          p.active !== false
                            ? "border-secondary/30 text-secondary bg-secondary/10"
                            : "border-muted/40 text-muted-foreground"
                        }`}
                      >
                        {p.active !== false ? "Active" : "Inactive"}
                      </span>
                    )}
                  </Td>
                  {/* <Td>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/admin/projects/${p._id}`}
                        className="h-8 px-3 rounded-md border border-border hover:bg-bg inline-flex items-center"
                      >
                        Open
                      </Link>
                      {!p.isPersonal && (
                        <button
                          onClick={async () => {
                            try {
                              const resp = await api.put(`/projects/${p._id}`, {
                                active: !p.active,
                              });
                              const next = resp.data.project?.active;
                              setProjects((list) =>
                                list.map((x) =>
                                  x._id === p._id ? { ...x, active: next } : x
                                )
                              );
                            } catch (e: any) {
                              toast.error(
                                e?.response?.data?.error ||
                                  "Failed to update project"
                              );
                            }
                          }}
                          className="h-8 px-3 rounded-md border border-border hover:bg-bg inline-flex items-center"
                          title={
                            p.active !== false ? "Mark Inactive" : "Mark Active"
                          }
                        >
                          {p.active !== false ? "Deactivate" : "Activate"}
                        </button>
                      )}
                    </div>
                  </Td> */}
                </tr>
              );
            })}
            {projects.length === 0 && (
              <tr>
                <td
                  className="px-3 py-3 text-sm text-muted-foreground"
                  colSpan={9}
                >
                  No projects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
