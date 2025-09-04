import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";
import { getEmployee } from "../../lib/auth";

type EmployeeLite = {
  id: string;
  name: string;
  email: string;
  subRoles: string[];
};
type Project = {
  _id: string;
  title: string;
  description?: string;
  techStack?: string[];
  teamLead: string;
  members: string[];
  estimatedTimeMinutes?: number;
  startTime?: string;
};

type Task = {
  _id: string;
  title: string;
  description?: string;
  assignedTo: string;
  createdBy: string;
  status: "PENDING" | "INPROGRESS" | "DONE";
  priority?: "URGENT" | "FIRST" | "SECOND" | "LEAST";
  comments?: { author: string; text: string; createdAt: string }[];
  timeSpentMinutes?: number;
  estimatedTimeMinutes?: number;
  createdAt?: string;
  updatedAt?: string;
};

export default function ProjectDetails() {
  const { id } = useParams();
  const nav = useNavigate();
  const me = getEmployee();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeTotalMinutes, setTimeTotalMinutes] = useState<number>(0);
  const [taskTotal, setTaskTotal] = useState<number>(0);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<
    "URGENT" | "FIRST" | "SECOND" | "LEAST"
  >("SECOND");
  const [estimatedHours, setEstimatedHours] = useState("");

  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [timeEntry, setTimeEntry] = useState<Record<string, { hours: string }>>(
    {}
  );
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null);
  const [editEstimatedHours, setEditEstimatedHours] = useState<string>("");
  const [savingEstimate, setSavingEstimate] = useState(false);
  const [editStartTime, setEditStartTime] = useState<string>("");
  const [savingStartTime, setSavingStartTime] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editTech, setEditTech] = useState("");
  const [editTeamLead, setEditTeamLead] = useState("");
  const [editMembers, setEditMembers] = useState<string[]>([]);
  const [savingProject, setSavingProject] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [taskEditForm, setTaskEditForm] = useState<{
    title: string;
    description: string;
    assignedTo: string;
    priority: NonNullable<Task["priority"]> | "";
    estimatedHours: string;
    status: Task["status"];
  } | null>(null);
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);

  const memberIds = useMemo(() => {
    if (!project) return [] as string[];
    return [project.teamLead, ...(project.members || [])].map(String);
  }, [project]);

  const members = useMemo(
    () => employees.filter((e) => memberIds.includes(e.id)),
    [employees, memberIds]
  );

  const canCreateTask = useMemo(() => {
    if (!project || !me) return false;
    const isAdmin =
      me.primaryRole === "ADMIN" || me.primaryRole === "SUPERADMIN";
    const isMember = memberIds.includes(me.id);
    return isAdmin || isMember;
  }, [project, me, memberIds]);

  const canCollaborate = canCreateTask; // placeholder; will check per-task for assignee only

  async function loadAll() {
    if (!id) return;
    setLoading(true);
    try {
      const [proj, tlist, tsum] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/tasks`, { params: { page: 1, limit: 3 } }),
        api.get(`/projects/${id}/time-summary`),
      ]);
      setProject(proj.data.project);
      setTasks(tlist.data.tasks || []);
      setTaskTotal(tlist.data.total || (tlist.data.tasks || []).length || 0);
      setTimeTotalMinutes(tsum.data.totalTimeSpentMinutes || 0);
      const est = proj?.data?.project?.estimatedTimeMinutes || 0;
      setEditEstimatedHours(
        est ? String(Math.round((est / 60) * 10) / 10) : ""
      );
      const st = proj?.data?.project?.startTime;
      setEditStartTime(st ? toInputDateTimeLocal(st) : "");
      // Try to load full employees list (admin/hr/manager). Fallback to project members only.
      try {
        const emps = await api.get("/companies/employees");
        setEmployees(emps.data.employees || []);
      } catch (e) {
        const mem = await api.get(`/projects/${id}/members`);
        setEmployees(mem.data.members || []);
      }
      // seed edit form
      const P = proj?.data?.project;
      if (P) {
        setEditTitle(P.title || "");
        setEditDesc(P.description || "");
        setEditTech((P.techStack || []).join(", "));
        setEditTeamLead(String(P.teamLead || ""));
        setEditMembers((P.members || []).map(String));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [id]);

  function minutesToHours(min: number) {
    return Math.round((min / 60) * 10) / 10;
  }

  function toInputDateTimeLocal(s?: string) {
    if (!s) return "";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  // Tiny donut chart copied inline (no external deps)
  function Donut({
    data,
    size = 160,
    thickness = 22,
  }: {
    data: { label: string; value: number; color: string }[];
    size?: number;
    thickness?: number;
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
        <circle cx={r} cy={r} r={ir} fill="white" />
        {arcs.map((seg, i) => (
          <path key={i} d={arcPath(seg.start, seg.end)} fill={seg.color} />
        ))}
        <circle cx={r} cy={r} r={ir} fill="white" />
      </svg>
    );
  }

  const spentMinutes = timeTotalMinutes;

  const canEditEstimate = useMemo(() => {
    return me?.primaryRole === "ADMIN" || me?.primaryRole === "SUPERADMIN";
  }, [me]);

  const canAdminProject = canEditEstimate;

  async function saveEstimate() {
    if (!id) return;
    const h = parseFloat(editEstimatedHours || "0");
    if (!isFinite(h) || h < 0) return;
    setSavingEstimate(true);
    try {
      const payload: any = { estimatedTimeMinutes: Math.round(h * 60) };
      const resp = await api.put(`/projects/${id}`, payload);
      setProject(resp.data.project);
    } finally {
      setSavingEstimate(false);
    }
  }

  async function saveStartTime() {
    if (!id) return;
    setSavingStartTime(true);
    try {
      const payload: any = { startTime: editStartTime || null };
      const resp = await api.put(`/projects/${id}`, payload);
      setProject(resp.data.project);
    } finally {
      setSavingStartTime(false);
    }
  }

  // Refresh time summary after changing any task's time
  async function refreshTimeSummary() {
    if (!id) return;
    try {
      const tsum = await api.get(`/projects/${id}/time-summary`);
      setTimeTotalMinutes(tsum.data.totalTimeSpentMinutes || 0);
    } catch {}
  }

  async function saveProjectDetails() {
    if (!id) return;
    setSavingProject(true);
    try {
      const payload: any = {
        title: editTitle.trim(),
        description: editDesc.trim(),
        techStack: editTech
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        teamLead: editTeamLead,
        members: editMembers,
      };
      const resp = await api.put(`/projects/${id}`, payload);
      setProject(resp.data.project);
      setEditOpen(false);
    } finally {
      setSavingProject(false);
    }
  }

  async function deleteProject() {
    if (!id) return;
    if (!confirm("Delete this project? This cannot be undone.")) return;
    try {
      await api.delete(`/projects/${id}`);
      const base =
        me?.primaryRole === "ADMIN" || me?.primaryRole === "SUPERADMIN"
          ? "/admin/projects"
          : "/app/projects";
      nav(base, { replace: true });
    } catch (e) {
      toast.error("Failed to delete project");
    }
  }

  function openEditTask(t: Task) {
    setEditTask(t);
    setTaskEditForm({
      title: t.title || "",
      description: t.description || "",
      assignedTo: String(t.assignedTo || ""),
      priority: (t.priority || "") as any,
      estimatedHours: t.estimatedTimeMinutes
        ? String(Math.round(((t.estimatedTimeMinutes || 0) / 60) * 10) / 10)
        : "",
      status: t.status,
    });
  }

  async function saveTaskEdit() {
    if (!id || !editTask || !taskEditForm) return;
    setSavingTaskEdit(true);
    try {
      const payload: any = {
        title: taskEditForm.title.trim(),
        description: taskEditForm.description.trim(),
        assignedTo: taskEditForm.assignedTo,
        priority: taskEditForm.priority || undefined,
        status: taskEditForm.status,
      };
      const h = parseFloat(taskEditForm.estimatedHours || "");
      if (isFinite(h) && h >= 0) payload.estimatedHours = h;
      await api.put(`/projects/${id}/tasks/${editTask._id}`, payload);
      const tlist = await api.get(`/projects/${id}/tasks`, {
        params: { page: 1, limit: 3 },
      });
      setTasks(tlist.data.tasks || []);
      setTaskTotal(tlist.data.total || (tlist.data.tasks || []).length || 0);
      setEditTask(null);
      setTaskEditForm(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to save task");
    } finally {
      setSavingTaskEdit(false);
    }
  }

  async function deleteTask(taskId: string) {
    if (!id) return;
    if (!confirm("Delete this task?")) return;
    try {
      await api.delete(`/projects/${id}/tasks/${taskId}`);
      const tlist = await api.get(`/projects/${id}/tasks`, {
        params: { page: 1, limit: 3 },
      });
      setTasks(tlist.data.tasks || []);
      setTaskTotal(tlist.data.total || (tlist.data.tasks || []).length || 0);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to delete task");
    }
  }

  const sortedTasks = useMemo(() => {
    const list = [...tasks];
    list.sort((a, b) => {
      const ad = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bd = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bd - ad;
    });
    return list;
  }, [tasks]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !newTitle || !assignee) return;
    setLoading(true);
    try {
      const payload: any = {
        title: newTitle,
        description: newDesc,
        assignedTo: assignee,
        priority,
      };
      const h = parseFloat(estimatedHours || "");
      if (isFinite(h) && h >= 0) payload.estimatedHours = h;
      await api.post(`/projects/${id}/tasks`, payload);
      setNewTitle("");
      setNewDesc("");
      setAssignee("");
      setPriority("SECOND");
      setEstimatedHours("");
      const tlist = await api.get(`/projects/${id}/tasks`, {
        params: { page: 1, limit: 3 },
      });
      setTasks(tlist.data.tasks || []);
      setTaskTotal(tlist.data.total || (tlist.data.tasks || []).length || 0);
    } finally {
      setLoading(false);
    }
  }

  async function addComment(taskId: string) {
    const text = (commentText[taskId] || "").trim();
    if (!text) return;
    await api.post(`/projects/${id}/tasks/${taskId}/comments`, { text });
    setCommentText((s) => ({ ...s, [taskId]: "" }));
    const tlist = await api.get(`/projects/${id}/tasks`, {
      params: { page: 1, limit: 3 },
    });
    setTasks(tlist.data.tasks || []);
    setTaskTotal(tlist.data.total || (tlist.data.tasks || []).length || 0);
  }

  async function saveTime(taskId: string) {
    const entry = timeEntry[taskId];
    const hours = parseFloat(entry?.hours || "0");
    if (isNaN(hours) || hours <= 0) return;
    // Replace total time for this task
    await api.put(`/projects/${id}/tasks/${taskId}/time`, { hours });
    setTimeEntry((s) => ({ ...s, [taskId]: { hours: "" } }));
    try {
      const tlist = await api.get(`/projects/${id}/tasks`, {
        params: { page: 1, limit: 3 },
      });
      setTasks(tlist.data.tasks || []);
      setTaskTotal(tlist.data.total || (tlist.data.tasks || []).length || 0);
    } catch {}
    await refreshTimeSummary();
  }

  async function updateStatus(taskId: string, status: Task["status"]) {
    await api.put(`/projects/${id}/tasks/${taskId}`, { status });
    try {
      const tlist = await api.get(`/projects/${id}/tasks`, {
        params: { page: 1, limit: 3 },
      });
      setTasks(tlist.data.tasks || []);
      setTaskTotal(tlist.data.total || (tlist.data.tasks || []).length || 0);
    } catch {}
  }

  return (
    <div className="space-y-8">
      {project && (
        <div className="bg-surface border border-border rounded-md p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">{project.title}</div>
              {project.description && (
                <div className="text-sm text-muted mt-1">
                  {project.description}
                </div>
              )}
              {!!project.techStack?.length && (
                <div className="mt-2 text-xs text-muted">
                  Tech: {project.techStack?.join(", ")}
                </div>
              )}
              <div className="mt-2 text-xs flex items-center gap-2 flex-wrap">
                <span className="text-muted">Start:</span>
                <span className="text-muted">
                  {project.startTime
                    ? new Date(project.startTime).toLocaleString()
                    : "—"}
                </span>
                {canEditEstimate && (
                  <>
                    <input
                      type="datetime-local"
                      className="h-8 rounded border border-border bg-bg px-2 text-xs"
                      value={editStartTime}
                      onChange={(e) => setEditStartTime(e.target.value)}
                    />
                    <button
                      onClick={saveStartTime}
                      className="h-8 px-3 rounded-md border border-border text-xs hover:bg-bg disabled:opacity-50"
                      disabled={savingStartTime}
                    >
                      {savingStartTime ? "Saving…" : "Save Start"}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canAdminProject && (
                <>
                  <button
                    onClick={() => setEditOpen((v) => !v)}
                    className="h-8 px-3 rounded-md border border-border text-sm hover:bg-bg"
                  >
                    {editOpen ? "Close Edit" : "Edit Project"}
                  </button>
                  {/* <button
                    onClick={deleteProject}
                    className="h-8 px-3 rounded-md border border-error/30 text-error text-sm hover:bg-error/10"
                  >
                    Delete
                  </button> */}
                </>
              )}
              <Link
                to=".."
                relative="path"
                className="text-sm underline text-accent"
              >
                Back
              </Link>
            </div>
          </div>
          <div className="mt-3 text-sm">
            <div className="font-medium">Team</div>
            <div className="mt-2 grid sm:grid-cols-2 md:grid-cols-3 gap-2">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="px-3 py-1 rounded border border-border bg-bg"
                >
                  <div className="text-sm">{m.name}</div>
                  <div className="text-xs text-muted">
                    {m.subRoles?.[0] || "member"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {editOpen && (
            <div className="mt-4 border-t border-border pt-4">
              <div className="text-sm font-medium mb-2">Edit Project</div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1">Title</label>
                  <input
                    className="w-full h-9 rounded border border-border bg-bg px-2 text-sm"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1">Team Lead</label>
                  <select
                    className="w-full h-9 rounded border border-border bg-bg px-2 text-sm"
                    value={editTeamLead}
                    onChange={(e) => setEditTeamLead(e.target.value)}
                  >
                    <option value="">Select</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs mb-1">Description</label>
                  <textarea
                    className="w-full rounded border border-border bg-bg px-2 py-2 text-sm min-h-20"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs mb-1">
                    Tech Stack (comma separated)
                  </label>
                  <input
                    className="w-full h-9 rounded border border-border bg-bg px-2 text-sm"
                    value={editTech}
                    onChange={(e) => setEditTech(e.target.value)}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs mb-1">Members</label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-auto border border-border rounded p-2 bg-bg">
                    {employees.map((e) => (
                      <label
                        key={e.id}
                        className="inline-flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={editMembers.includes(e.id)}
                          onChange={(ev) =>
                            setEditMembers((prev) =>
                              ev.target.checked
                                ? [...prev, e.id]
                                : prev.filter((id) => id !== e.id)
                            )
                          }
                        />
                        <span>{e.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={saveProjectDetails}
                  disabled={savingProject}
                  className="h-9 px-4 rounded-md bg-primary text-white text-sm disabled:opacity-60"
                >
                  {savingProject ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          )}

          {/* Time overview */}
          <div className="mt-6 grid lg:grid-cols-2 gap-6">
            <div className="rounded-md border border-border bg-bg p-4">
              <div className="text-sm font-medium mb-3">Time Overview</div>
              <div className="flex items-center gap-6 flex-wrap">
                {(() => {
                  const est = project.estimatedTimeMinutes || 0;
                  const spent = spentMinutes;
                  const data = (() => {
                    if (spent <= est) {
                      return [
                        { label: "Spent", value: spent, color: "#2563eb" },
                        {
                          label: "Remaining",
                          value: Math.max(0, est - spent),
                          color: "#e5e7eb",
                        },
                      ];
                    }
                    // overshoot
                    return [
                      {
                        label: "Within Estimate",
                        value: est,
                        color: "#2563eb",
                      },
                      {
                        label: "Over",
                        value: Math.max(0, spent - est),
                        color: "#ef4444",
                      },
                    ];
                  })();
                  return <Donut data={data} />;
                })()}
                <div className="space-y-2 text-sm min-w-[180px]">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Estimated</span>
                    <span className="font-medium">
                      {minutesToHours(project.estimatedTimeMinutes || 0)} h
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Spent</span>
                    <span className="font-medium">
                      {minutesToHours(spentMinutes)} h
                    </span>
                  </div>
                  {(project.estimatedTimeMinutes || 0) >= spentMinutes ? (
                    <div className="flex items-center justify-between">
                      <span className="text-muted">Remaining</span>
                      <span className="font-medium">
                        {minutesToHours(
                          Math.max(
                            0,
                            (project.estimatedTimeMinutes || 0) - spentMinutes
                          )
                        )}{" "}
                        h
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-error">
                      <span>Over by</span>
                      <span className="font-medium">
                        {minutesToHours(
                          spentMinutes - (project.estimatedTimeMinutes || 0)
                        )}{" "}
                        h
                      </span>
                    </div>
                  )}
                  <div className="h-2 w-full bg-surface border border-border rounded overflow-hidden">
                    {(() => {
                      const est = project.estimatedTimeMinutes || 0;
                      const spent = spentMinutes;
                      if (spent <= est) {
                        const pct = Math.min(
                          100,
                          (spent / Math.max(1, est)) * 100
                        );
                        return (
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        );
                      }
                      // overshoot: show full bar for estimate, with small red cap indicator for overshoot
                      const overPct = Math.min(
                        100,
                        ((spent - est) / Math.max(1, spent)) * 100
                      );
                      return (
                        <div className="h-full w-full relative">
                          <div className="absolute inset-0 bg-primary" />
                          <div
                            className="absolute top-0 right-0 h-full"
                            style={{
                              width: `${overPct}%`,
                              background: "#ef4444",
                            }}
                          />
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border bg-bg p-4">
              <div className="text-sm font-medium mb-3">Edit Estimate</div>
              {canEditEstimate ? (
                <div className="flex items-center gap-2">
                  <input
                    className="h-10 rounded border border-border bg-surface px-3"
                    type="number"
                    min={0}
                    step={0.1}
                    placeholder="Estimated hours"
                    value={editEstimatedHours}
                    onChange={(e) => setEditEstimatedHours(e.target.value)}
                  />
                  <button
                    onClick={saveEstimate}
                    disabled={savingEstimate}
                    className="h-10 px-4 rounded-md border border-border hover:bg-surface disabled:opacity-50"
                  >
                    {savingEstimate ? "Saving…" : "Save"}
                  </button>
                </div>
              ) : (
                <div className="text-sm text-muted">
                  Only admins can update the estimate.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Task */}
      {canCreateTask && (
        <form
          onSubmit={addTask}
          className="space-y-3 bg-surface border border-border rounded-md p-4"
        >
          <div className="font-medium">Add Task</div>
          <div className="grid md:grid-cols-2 gap-3">
            <input
              className="h-10 rounded border border-border bg-bg px-3"
              placeholder="Task title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              required
            />
            <select
              className="h-10 rounded border border-border bg-bg px-3"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              required
            >
              <option value="">Assign to...</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded border border-border bg-bg px-3"
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
            >
              <option value="URGENT">Urgent</option>
              <option value="FIRST">First Priority</option>
              <option value="SECOND">Second Priority</option>
              <option value="LEAST">Least Priority</option>
            </select>
            <input
              className="h-10 rounded border border-border bg-bg px-3"
              type="number"
              min={0}
              step={0.1}
              placeholder="Estimated hours (optional)"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
            />
            <div className="md:col-span-2">
              <textarea
                className="w-full rounded border border-border bg-bg px-3 py-2 min-h-20"
                placeholder="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
          </div>
          <div>
            <button
              className="h-10 px-4 rounded-md bg-primary text-white disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "Adding…" : "Add Task"}
            </button>
          </div>
        </form>
      )}

      {/* Tasks list (recent 3) */}
      <div className="space-y-3">
        {sortedTasks.slice(0, 3).map((t) => {
          const assigneeName = employees.find(
            (e) => e.id === String(t.assignedTo)
          )?.name;
          const statusLabel =
            t.status === "PENDING"
              ? "Pending"
              : t.status === "INPROGRESS"
              ? "In Progress"
              : "Done";
          const totalHours =
            Math.round(((t.timeSpentMinutes || 0) / 60) * 100) / 100;
          return (
            <div
              key={t._id}
              className="border border-border bg-surface rounded-md p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold flex items-center gap-2">
                    <span>{t.title}</span>
                    {t.priority && (
                      <span className="text-xs px-2 py-0.5 rounded border border-border bg-bg">
                        {t.priority === "URGENT"
                          ? "Urgent"
                          : t.priority === "FIRST"
                          ? "First Priority"
                          : t.priority === "SECOND"
                          ? "Second Priority"
                          : "Least Priority"}
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <div className="text-sm text-muted mt-1">
                      {t.description}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-muted flex gap-4">
                    <span>Assigned to: {assigneeName || "Member"}</span>
                    <span>Status: {statusLabel}</span>
                    <span>Time spent: {totalHours} h</span>
                    {!!t.estimatedTimeMinutes && (
                      <span>
                        Est:{" "}
                        {Math.round(((t.estimatedTimeMinutes || 0) / 60) * 10) /
                          10}{" "}
                        h
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOpenCommentsFor(t._id)}
                    className="h-9 rounded-md border border-border px-3 text-sm hover:bg-bg"
                  >
                    Comments ({(t.comments || []).length || 0})
                  </button>
                  {canCollaborate && (
                    <>
                      <button
                        onClick={() => openEditTask(t)}
                        className="h-9 rounded-md border border-border px-3 text-sm hover:bg-bg"
                      >
                        Edit
                      </button>
                      {/* <button
                        onClick={() => deleteTask(t._id)}
                        className="h-9 rounded-md border border-error/30 text-error px-3 text-sm hover:bg-error/10"
                      >
                        Delete
                      </button> */}
                    </>
                  )}
                </div>
              </div>

              {/* Manual time entry (add hours) */}
              {canCollaborate && (
                <div className="mt-3 grid sm:grid-cols-[140px_120px] gap-2 items-center">
                  <input
                    className="h-9 rounded border border-border bg-bg px-3 text-sm"
                    type="number"
                    min={0}
                    step={0.1}
                    placeholder="Set hours"
                    value={timeEntry[t._id]?.hours || ""}
                    onChange={(e) =>
                      setTimeEntry((s) => ({
                        ...s,
                        [t._id]: { hours: e.target.value },
                      }))
                    }
                  />
                  <button
                    onClick={() => saveTime(t._id)}
                    className="h-9 rounded-md border border-border px-3 text-sm hover:bg-bg disabled:opacity-50"
                    disabled={
                      timeEntry[t._id]?.hours === undefined ||
                      timeEntry[t._id]?.hours === "" ||
                      parseFloat(timeEntry[t._id]?.hours || "0") <= 0
                    }
                  >
                    Save Time
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {tasks.length === 0 && (
          <div className="text-sm text-muted">No tasks yet.</div>
        )}
        {taskTotal > 3 && (
          <div>
            <Link
              to="tasks"
              relative="path"
              className="h-10 px-4 rounded-md border border-border hover:bg-bg text-sm inline-flex items-center"
            >
              View All Tasks
            </Link>
          </div>
        )}
      </div>

      {/* Comments modal */}
      {openCommentsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpenCommentsFor(null)}
          />
          <div className="relative z-10 w-[min(640px,92vw)] max-h-[80vh] overflow-hidden rounded-md border border-border bg-surface">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="font-semibold text-sm">Comments</div>
              <button
                className="h-8 px-3 rounded-md border border-border text-sm hover:bg-bg"
                onClick={() => setOpenCommentsFor(null)}
              >
                Close
              </button>
            </div>
            {(() => {
              const task = tasks.find((x) => x._id === openCommentsFor);
              if (!task) return null;
              return (
                <div className="p-4">
                  <div className="text-sm font-medium mb-2">{task.title}</div>
                  <div className="max-h-[48vh] overflow-y-auto space-y-2 pr-1">
                    {(task.comments || []).length === 0 && (
                      <div className="text-xs text-muted">No comments yet.</div>
                    )}
                    {(task.comments || []).slice(-100).map((c, idx) => {
                      const isMe = String(me?.id) === String(c.author);
                      const authorName = isMe
                        ? "You"
                        : employees.find((e) => e.id === String(c.author))
                            ?.name || "Member";
                      return (
                        <div
                          key={idx}
                          className={[
                            "flex",
                            isMe ? "justify-end" : "justify-start",
                          ].join(" ")}
                        >
                          <div
                            className={[
                              "rounded-lg px-3 py-2 max-w-[80%] text-sm",
                              isMe
                                ? "bg-primary text-white"
                                : "bg-bg border border-border",
                            ].join(" ")}
                          >
                            <div className="text-[11px] opacity-80 mb-0.5">
                              {authorName} •{" "}
                              {new Date((c as any).createdAt).toLocaleString()}
                            </div>
                            <div>{(c as any).text}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      className="flex-1 h-9 rounded border border-border bg-bg px-3 text-sm"
                      placeholder="Write a comment…"
                      value={commentText[task._id] || ""}
                      onChange={(e) =>
                        setCommentText((s) => ({
                          ...s,
                          [task._id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          addComment(task._id);
                        }
                      }}
                    />
                    <button
                      onClick={() => addComment(task._id)}
                      className="h-9 rounded-md border border-border px-3 text-sm hover:bg-bg"
                      disabled={
                        !commentText[task._id] || !commentText[task._id].trim()
                      }
                    >
                      Send
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Edit task modal */}
      {editTask && taskEditForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setEditTask(null);
              setTaskEditForm(null);
            }}
          />
          <div className="relative z-10 w-[min(700px,92vw)] max-h-[85vh] overflow-auto rounded-md border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Edit Task</div>
              <button
                className="h-8 px-3 rounded-md border border-border text-sm"
                onClick={() => {
                  setEditTask(null);
                  setTaskEditForm(null);
                }}
              >
                Close
              </button>
            </div>
            <div className="mt-3 grid md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs mb-1">Title</label>
                <input
                  className="w-full h-9 rounded border border-border bg-bg px-2 text-sm"
                  value={taskEditForm.title}
                  onChange={(e) =>
                    setTaskEditForm((f) =>
                      f ? { ...f, title: e.target.value } : f
                    )
                  }
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs mb-1">Description</label>
                <textarea
                  className="w-full rounded border border-border bg-bg px-2 py-2 text-sm min-h-24"
                  value={taskEditForm.description}
                  onChange={(e) =>
                    setTaskEditForm((f) =>
                      f ? { ...f, description: e.target.value } : f
                    )
                  }
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Assignee</label>
                <select
                  className="w-full h-9 rounded border border-border bg-bg px-2 text-sm"
                  value={taskEditForm.assignedTo}
                  onChange={(e) =>
                    setTaskEditForm((f) =>
                      f ? { ...f, assignedTo: e.target.value } : f
                    )
                  }
                >
                  <option value="">Select</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Priority</label>
                <select
                  className="w-full h-9 rounded border border-border bg-bg px-2 text-sm"
                  value={taskEditForm.priority}
                  onChange={(e) =>
                    setTaskEditForm((f) =>
                      f ? { ...f, priority: e.target.value as any } : f
                    )
                  }
                >
                  <option value="">None</option>
                  <option value="URGENT">Urgent</option>
                  <option value="FIRST">First</option>
                  <option value="SECOND">Second</option>
                  <option value="LEAST">Least</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Estimated Hours</label>
                <input
                  className="w-full h-9 rounded border border-border bg-bg px-2 text-sm"
                  type="number"
                  min={0}
                  step={0.1}
                  value={taskEditForm.estimatedHours}
                  onChange={(e) =>
                    setTaskEditForm((f) =>
                      f ? { ...f, estimatedHours: e.target.value } : f
                    )
                  }
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Status</label>
                <select
                  className="w-full h-9 rounded border border-border bg-bg px-2 text-sm"
                  value={taskEditForm.status}
                  onChange={(e) =>
                    setTaskEditForm((f) =>
                      f ? { ...f, status: e.target.value as any } : f
                    )
                  }
                >
                  <option value="PENDING">Pending</option>
                  <option value="INPROGRESS">In Progress</option>
                  <option value="DONE">Done</option>
                </select>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={saveTaskEdit}
                disabled={savingTaskEdit}
                className="h-9 px-4 rounded-md bg-primary text-white text-sm disabled:opacity-60"
              >
                {savingTaskEdit ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
