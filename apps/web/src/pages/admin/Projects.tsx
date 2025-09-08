import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { Th, Td } from "../../components/ui/Table";
import { toast } from "react-hot-toast";
import { getEmployee } from "../../lib/auth";
import type { PrimaryRole } from "../../lib/auth";
import { Link, useNavigate } from "react-router-dom";

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
  const nav = useNavigate();
  const u = getEmployee();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [spentByProject, setSpentByProject] = useState<Record<string, number>>(
    {}
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tech, setTech] = useState("");
  const [teamLead, setTeamLead] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [estimatedHours, setEstimatedHours] = useState("");
  const [startTime, setStartTime] = useState<string>(""); // datetime-local string

  const teamLeadOptions = useMemo(() => {
    // prefer HR or manager as team lead (admins typically manage too, but keep current rule)
    const priority = employees.filter((e) =>
      e.subRoles?.some((r) => r === "hr" || r === "manager")
    );
    const others = employees.filter(
      (e) => !e.subRoles?.some((r) => r === "hr" || r === "manager")
    );
    return [...priority, ...others];
  }, [employees]);

  function roleLabel(e: EmployeeLite) {
    return (
      e.subRoles?.[0] ||
      (e.primaryRole === "ADMIN"
        ? "admin"
        : e.primaryRole === "SUPERADMIN"
        ? "superadmin"
        : "employee")
    );
  }

  async function load() {
    setLoading(true);
    try {
      const [emps, projs] = await Promise.all([
        api.get("/companies/employees"),
        api.get("/projects"),
      ]);
      const projList: Project[] = projs.data.projects || [];
      setEmployees(emps.data.employees || []);
      setProjects(projList);

      // Load total spent minutes per project (best-effort)
      const map: Record<string, number> = {};
      await Promise.all(
        projList.map(async (p) => {
          try {
            const t = await api.get(`/projects/${p._id}/time-summary`);
            map[p._id] = t.data.totalTimeSpentMinutes || 0;
          } catch {
            map[p._id] = 0;
          }
        })
      );
      setSpentByProject(map);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !teamLead) return;
    setLoading(true);
    try {
      const techStack = tech
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const eh = parseFloat(estimatedHours || "0");
      const payload: any = { title, description, techStack, teamLead, members };
      if (isFinite(eh) && eh > 0)
        payload.estimatedTimeMinutes = Math.round(eh * 60);
      if (startTime && startTime.trim()) payload.startTime = startTime;
      await api.post("/projects", payload);
      setTitle("");
      setDescription("");
      setTech("");
      setTeamLead("");
      setMembers([]);
      setEstimatedHours("");
      setStartTime("");
      await load();
    } finally {
      setLoading(false);
    }
  }

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
      </div>

      {/* Create form */}
      <form
        onSubmit={createProject}
        className="space-y-4 bg-surface border border-border rounded-md p-4"
      >
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Title</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project title"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Tech Stack</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={tech}
              onChange={(e) => setTech(e.target.value)}
              placeholder="e.g. React, Node, MongoDB"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Estimated Time (hours)</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              type="number"
              min={0}
              step={0.1}
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
              placeholder="e.g. 120"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Start Time</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Description</label>
            <textarea
              className="w-full rounded border border-border bg-bg px-3 py-2 min-h-20"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Team Lead</label>
            <select
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={teamLead}
              onChange={(e) => setTeamLead(e.target.value)}
              required
            >
              <option value="">Select team lead</option>
              {teamLeadOptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({roleLabel(e)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Members</label>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-auto border border-border rounded p-2 bg-bg">
              {employees.map((e) => (
                <label
                  key={e.id}
                  className="inline-flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={members.includes(e.id)}
                    onChange={(ev) =>
                      setMembers((prev) =>
                        ev.target.checked
                          ? [...prev, e.id]
                          : prev.filter((id) => id !== e.id)
                      )
                    }
                  />
                  <span>
                    {e.name}{" "}
                    <span className="text-muted">({roleLabel(e)})</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-white disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Creating…" : "Create Project"}
          </button>
        </div>
      </form>

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
              <Th>Actions</Th>
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
                    <div className="font-medium">{p.title}</div>
                    {p.description && (
                      <div
                        className="text-xs text-muted truncate max-w-[360px]"
                        title={p.description}
                      >
                        {p.description}
                      </div>
                    )}
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
                      <span className="text-muted">
                        - {minutesToHours(Math.max(0, est - spent))} h
                      </span>
                    )}
                  </Td>
                  <Td>
                    {p.isPersonal ? (
                      <span className="text-xs text-muted">Personal</span>
                    ) : (
                      <span
                        className={`text-xs px-2 py-0.5 rounded border ${
                          p.active !== false
                            ? "border-secondary/30 text-secondary bg-secondary/10"
                            : "border-muted/40 text-muted"
                        }`}
                      >
                        {p.active !== false ? "Active" : "Inactive"}
                      </span>
                    )}
                  </Td>
                  <Td>
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
                          className=""
                          title={
                            p.active !== false ? "Mark Inactive" : "Mark Active"
                          }
                        ></button>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
            {projects.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-sm text-muted" colSpan={8}>
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
