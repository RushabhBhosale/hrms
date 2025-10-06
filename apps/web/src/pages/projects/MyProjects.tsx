import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { Link } from "react-router-dom";
import { getEmployee, hasPermission } from "../../lib/auth";
import type { PrimaryRole } from "../../lib/auth";

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
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tech, setTech] = useState("");
  const [teamLead, setTeamLead] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [estimatedHours, setEstimatedHours] = useState("");
  const [startTime, setStartTime] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

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
    [employees]
  );

  const teamLeadOptions = useMemo(() => {
    const priority = employees.filter((e) =>
      e.subRoles?.some((role) => role === "hr" || role === "manager")
    );
    const others = employees.filter(
      (e) => !e.subRoles?.some((role) => role === "hr" || role === "manager")
    );
    return [...priority, ...others];
  }, [employees]);

  function roleLabel(e: EmployeeLite) {
    if (e.subRoles?.length) return e.subRoles[0];
    if (e.primaryRole === "ADMIN") return "admin";
    if (e.primaryRole === "SUPERADMIN") return "superadmin";
    return "employee";
  }

  async function createProject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canCreate) return;
    if (!title.trim() || !teamLead) {
      setCreateError("Please provide a title and team lead.");
      return;
    }
    setCreateError(null);
    setSaving(true);
    try {
      const techStack = tech
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const hours = parseFloat(estimatedHours || "0");
      const payload: any = {
        title: title.trim(),
        description,
        techStack,
        teamLead,
        members,
      };
      if (Number.isFinite(hours) && hours > 0) {
        payload.estimatedTimeMinutes = Math.round(hours * 60);
      }
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
    } catch (err: any) {
      setCreateError(err?.response?.data?.error || "Failed to create project");
    } finally {
      setSaving(false);
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
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Projects</h2>

      {canCreate && (
        <form
          onSubmit={createProject}
          className="space-y-4 border border-border rounded-md bg-surface p-4"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm mb-1 required-label">Title</label>
              <input
                className="w-full h-10 rounded border border-border bg-bg px-3"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Project title"
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
              <label className="block text-sm mb-1">
                Estimated Time (hours)
              </label>
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

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm mb-1 required-label">
                Team Lead
              </label>
              <select
                className="w-full h-10 rounded border border-border bg-bg px-3"
                value={teamLead}
                onChange={(e) => setTeamLead(e.target.value)}
              >
                <option value="">Select team lead</option>
                {teamLeadOptions.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({roleLabel(emp)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">Members</label>
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-auto border border-border rounded p-2 bg-bg">
                {employees.map((emp) => (
                  <label
                    key={emp.id}
                    className="inline-flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={members.includes(emp.id)}
                      onChange={(ev) =>
                        setMembers((prev) =>
                          ev.target.checked
                            ? [...prev, emp.id]
                            : prev.filter((id) => id !== emp.id)
                        )
                      }
                    />
                    <span>
                      {emp.name}{" "}
                      <span className="text-muted">({roleLabel(emp)})</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {createError && (
            <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded px-3 py-2">
              {createError}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-white disabled:opacity-50"
              disabled={saving}
            >
              {saving ? "Creating…" : "Create Project"}
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-3">
        {projects.map((p) => (
          <div
            key={p._id}
            className="border border-border bg-surface rounded-md p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{p.title}</div>
                {p.description && (
                  <div className="text-sm text-muted mt-1">{p.description}</div>
                )}
                {!!p.techStack?.length && (
                  <div className="mt-2 text-xs text-muted">
                    Tech: {p.techStack?.join(", ")}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                  <span className="text-muted">
                    Start: {fmtDate(p.createdAt)}
                  </span>
                  <span className="text-muted">
                    Est: {minutesToHours(p.estimatedTimeMinutes || 0)} h
                  </span>
                  <span className="text-muted">
                    Lead: {empMap.get(String(p.teamLead)) || "—"}
                  </span>
                  <span className="text-muted">
                    Members: {p.members?.length || 0}
                  </span>
                </div>
              </div>
              <Link
                to={`/app/projects/${p._id}`}
                className="h-9 px-3 rounded-md border border-border hover:bg-bg inline-flex items-center"
              >
                Open
              </Link>
            </div>
          </div>
        ))}
        {projects.length === 0 && !loading && (
          <div className="text-sm text-muted">No projects found.</div>
        )}
      </div>
    </div>
  );
}
