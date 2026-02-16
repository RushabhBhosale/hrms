import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { Link } from "react-router-dom";
import { getEmployee, hasPermission } from "../../lib/auth";
import type { PrimaryRole } from "../../lib/auth";
import { Td, Th } from "../../components/utils/Table";

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
};

export default function MyProjects() {
  const viewer = getEmployee();
  const canCreate = hasPermission(viewer, "projects", "write");
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [projRes, empRes] = await Promise.all([
        api.get("/projects"),
        api.get("/companies/employees"),
      ]);
      setProjects(projRes.data.projects || []);
      setEmployees(empRes.data.employees || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const empMap = useMemo(
    () => new Map(employees.map((e) => [e.id, e.name])),
    [employees],
  );

  function minutesToHours(min: number) {
    if (!Number.isFinite(min)) return "0.00";
    const totalMinutes = Math.max(0, Math.round(min || 0));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}.${minutes.toString().padStart(2, "0")}`;
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Projects</h2>
        {canCreate && (
          <Link
            to="/app/projects/new"
            className="h-10 px-4 rounded-md bg-primary text-white text-sm inline-flex items-center justify-center"
          >
            Add Project
          </Link>
        )}
      </div>

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-left">
                <Th>Project</Th>
                <Th>Tech</Th>
                <Th>Lead</Th>
                <Th>Members</Th>
                <Th>Estimated</Th>
                <Th>Start</Th>
                {/* <Th>Actions</Th> */}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-10 text-center text-muted-foreground"
                  >
                    Loading…
                  </td>
                </tr>
              ) : projects.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-10 text-center text-muted-foreground"
                  >
                    No projects found.
                  </td>
                </tr>
              ) : (
                projects.map((p) => {
                  const leadName = empMap.get(String(p.teamLead)) || "—";
                  const tech = p.techStack?.length
                    ? p.techStack.join(", ")
                    : "—";
                  const est =
                    (p.estimatedTimeMinutes || 0) > 0
                      ? `${minutesToHours(p.estimatedTimeMinutes || 0)} h`
                      : "—";
                  return (
                    <tr
                      key={p._id}
                      className="border-t border-border/70 hover:bg-bg/60 transition-colors"
                    >
                      <Td>
                        <Link to={`/app/projects/${p._id}`}>
                          {" "}
                          <div className="min-w-[16rem]">
                            <div className="font-medium text-primary">
                              {p.title}
                            </div>
                            {p.description && (
                              <div
                                className="mt-0.5 text-xs text-muted-foreground max-w-[32rem] truncate"
                                title={p.description}
                              >
                                {p.description}
                              </div>
                            )}
                          </div>
                        </Link>
                      </Td>
                      <Td className="text-muted-foreground">
                        <div className="max-w-[22rem] truncate" title={tech}>
                          {tech}
                        </div>
                      </Td>
                      <Td className="text-muted-foreground whitespace-nowrap">
                        {leadName}
                      </Td>
                      <Td className="text-muted-foreground whitespace-nowrap">
                        {p.members?.length || 0}
                      </Td>
                      <Td className="text-muted-foreground whitespace-nowrap">
                        {est}
                      </Td>
                      <Td className="text-muted-foreground whitespace-nowrap">
                        {fmtDate(p.createdAt)}
                      </Td>
                      {/* <Td className="whitespace-nowrap">
                        <Link
                          to={`/app/projects/${p._id}`}
                          className="h-8 px-3 rounded-md border border-border hover:bg-bg inline-flex items-center"
                        >
                          Open
                        </Link>
                      </Td> */}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
