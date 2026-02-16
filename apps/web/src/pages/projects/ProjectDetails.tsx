import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BackButton } from "../../components/utils/BackButton";
import { toast } from "react-hot-toast";
import { api } from "../../lib/api";
import { getEmployee, hasPermission } from "../../lib/auth";
import type { PrimaryRole } from "../../lib/auth";
import ReportingPersonMultiSelect from "../../components/ReportingPersonMultiSelect";
import { confirmToast } from "../../lib/confirmToast";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Pencil, Trash } from "lucide-react";

type EmployeeLite = {
  id: string;
  name: string;
  email: string;
  subRoles: string[];
  primaryRole: PrimaryRole;
};
type ClientLite = { _id: string; name: string; email?: string };
type Project = {
  _id: string;
  title: string;
  description?: string;
  techStack?: string[];
  teamLead: string;
  members: string[];
  estimatedTimeMinutes?: number;
  monthlyEstimateMinutes?: number;
  startTime?: string;
  isPersonal?: boolean;
  active?: boolean;
  isActive?: boolean;
  isDeleted?: boolean;
};

type Task = {
  _id: string;
  title: string;
  description?: string;
  assignedTo: string | string[];
  createdBy: string;
  status: "PENDING" | "INPROGRESS" | "DONE";
  priority?: "URGENT" | "FIRST" | "SECOND" | "LEAST";
  comments?: { author: string; text: string; createdAt: string }[];
  timeSpentMinutes?: number;
  estimatedTimeMinutes?: number;
  createdAt?: string;
  updatedAt?: string;
  isMeetingDefault?: boolean;
};

export default function ProjectDetails() {
  const { id } = useParams();
  const nav = useNavigate();
  const me = getEmployee();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeTotalMinutes, setTimeTotalMinutes] = useState<number>(0);
  const [selfTimeMinutes, setSelfTimeMinutes] = useState<number>(0);
  const [taskTotal, setTaskTotal] = useState<number>(0);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);

  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [timeEntry, setTimeEntry] = useState<Record<string, { hours: string }>>(
    {},
  );
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null);
  const [editEstimatedHours, setEditEstimatedHours] = useState<string>("");
  const [editMonthlyHours, setEditMonthlyHours] = useState<string>("");
  const [savingEstimate, setSavingEstimate] = useState(false);
  const [editStartTime, setEditStartTime] = useState<string>("");
  const [savingStartTime, setSavingStartTime] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editTech, setEditTech] = useState("");
  const [editTeamLead, setEditTeamLead] = useState("");
  const [editMembers, setEditMembers] = useState<string[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [editClientId, setEditClientId] = useState<string>("");
  const [savingProject, setSavingProject] = useState(false);

  const NO_CLIENT_VALUE = "__no_client__";

  const memberIds = useMemo(() => {
    if (!project) return [] as string[];
    return [project.teamLead, ...(project.members || [])].map(String);
  }, [project]);

  const members = useMemo(
    () => employees.filter((e) => memberIds.includes(e.id)),
    [employees, memberIds],
  );

  const employeeOptions = useMemo(
    () => employees.map((e) => ({ value: e.id, label: e.name })),
    [employees],
  );

  const taskAssigneeIds = (t: Task) => {
    if (!t) return [];
    return (Array.isArray(t.assignedTo) ? t.assignedTo : [t.assignedTo]).filter(
      Boolean,
    );
  };

  const formatAssignees = (t: Task) => {
    const ids = taskAssigneeIds(t);
    if (!ids.length) return "Member";
    const names = ids
      .map((id) => employees.find((e) => e.id === String(id))?.name || "Member")
      .filter(Boolean);
    return names.join(", ");
  };

  function roleLabel(e: EmployeeLite) {
    return (
      e.subRoles?.[0] ||
      (e.primaryRole === "ADMIN"
        ? "admin"
        : e.primaryRole === "SUPERADMIN"
          ? "superadmin"
          : "member")
    );
  }

  const canCreateTask = useMemo(() => {
    if (!project || !me) return false;
    const live = project.active !== false && project.isActive !== false;
    if (!live) return false;

    const isAdmin =
      me.primaryRole === "ADMIN" || me.primaryRole === "SUPERADMIN";
    if (isAdmin) return true;

    const allowedByRole = hasPermission(me, "tasks", "write");
    if (!allowedByRole) return false;

    const isMember = memberIds.includes(String(me.id));
    return isMember;
  }, [project, me, memberIds]);

  const canCollaborate = canCreateTask; // placeholder; will check per-task for assignee only

  const canDeleteTask = useMemo(() => {
    if (!me || !project) return false;
    const live = project.active !== false && project.isActive !== false;
    if (!live) return false;
    const isAdmin =
      me.primaryRole === "ADMIN" || me.primaryRole === "SUPERADMIN";
    const isTeamLead = String(project.teamLead) === String(me.id);
    return isAdmin || isTeamLead;
  }, [me, project]);

  async function loadAll() {
    if (!id) return;
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
      setSelfTimeMinutes(tsum.data.userTimeSpentMinutes || 0);
      const est = proj?.data?.project?.estimatedTimeMinutes || 0;
      setEditEstimatedHours(
        est ? String(Math.round((est / 60) * 10) / 10) : "",
      );
      const monthly = proj?.data?.project?.monthlyEstimateMinutes || 0;
      setEditMonthlyHours(
        monthly ? String(Math.round((monthly / 60) * 10) / 10) : "",
      );
      const st = proj?.data?.project?.startTime;
      setEditStartTime(st ? toInputDate(st) : "");
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
        setEditClientId(P.client ? String(P.client) : "");
      }
      try {
        const cli = await api.get("/clients");
        setClients(cli.data.clients || []);
      } catch {}
    } catch (e: any) {
      toast.error(
        e?.response?.data?.error || "Failed to load project information",
      );
    }
  }

  useEffect(() => {
    loadAll();
  }, [id]);

  function minutesToHours(min: number) {
    return Math.round((min / 60) * 10) / 10;
  }

  function toInputDate(s?: string) {
    if (!s) return "";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    return `${yyyy}-${mm}-${dd}`;
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

  async function toggleActive(next: boolean) {
    if (!id) return;
    try {
      const resp = await api.put(`/projects/${id}`, { active: next });
      setProject(resp.data.project);
      toast.success(next ? "Project marked Active" : "Project marked Inactive");
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to update project");
    }
  }

  async function saveEstimates() {
    if (!id) return;
    const totalHours = parseFloat(editEstimatedHours || "0");
    const monthlyHours = parseFloat(editMonthlyHours || "0");
    if (!isFinite(totalHours) || totalHours < 0) return;
    if (!isFinite(monthlyHours) || monthlyHours < 0) return;
    setSavingEstimate(true);
    try {
      const payload: any = {
        estimatedTimeMinutes: Math.round(totalHours * 60),
        monthlyEstimateMinutes: Math.round(monthlyHours * 60),
      };
      const resp = await api.put(`/projects/${id}`, payload);
      setProject(resp.data.project);
      const nextMonthly = resp?.data?.project?.monthlyEstimateMinutes;
      const nextTotal = resp?.data?.project?.estimatedTimeMinutes;
      if (Number.isFinite(nextMonthly)) {
        setEditMonthlyHours(
          nextMonthly ? String(Math.round((nextMonthly / 60) * 10) / 10) : "",
        );
      }
      if (Number.isFinite(nextTotal)) {
        setEditEstimatedHours(
          nextTotal ? String(Math.round((nextTotal / 60) * 10) / 10) : "",
        );
      }
    } finally {
      setSavingEstimate(false);
    }
  }

  async function saveStartTime() {
    if (!id) return;
    setSavingStartTime(true);
    try {
      const start = editStartTime
        ? (() => {
            const d = new Date(editStartTime);
            if (isNaN(d.getTime())) return null;
            d.setHours(0, 0, 0, 0);
            return d.toISOString();
          })()
        : null;
      const payload: any = { startTime: start };
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
        client: editClientId || null,
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
    if (!canAdminProject) {
      toast.error("Only admins can delete projects.");
      return;
    }
    const yes = await confirmToast({
      title: "Delete this project?",
      message:
        "This is a soft delete: the project will be removed from listings, but past logs/history remain.",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!yes) return;
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

  async function deleteTask(taskId: string) {
    if (!id) return;
    if (project && (project.active === false || project.isActive === false)) {
      toast.error("Project is inactive. You cannot delete tasks.");
      return;
    }
    if (!canDeleteTask) {
      toast.error("Only project lead or admin can delete tasks.");
      return;
    }
    const yes = await confirmToast({
      title: "Delete this task?",
      message:
        "This is a soft delete: the task will be removed from listings, but past logs/history remain.",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!yes) return;
    try {
      await api.delete(`/projects/${id}/tasks/${taskId}`);
      const tlist = await api.get(`/projects/${id}/tasks`, {
        params: { page: 1, limit: 3 },
      });
      setTasks(tlist.data.tasks || []);
      setTaskTotal(tlist.data.total || (tlist.data.tasks || []).length || 0);
      toast.success("Task deleted");
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

  async function addComment(taskId: string) {
    if (project && (project.active === false || project.isActive === false)) {
      toast.error("Project is inactive. You cannot add comments.");
      return;
    }
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
    if (project && (project.active === false || project.isActive === false)) {
      toast.error("Project is inactive. You cannot update time.");
      return;
    }
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
    if (project && (project.active === false || project.isActive === false)) {
      toast.error("Project is inactive. You cannot update status.");
      return;
    }
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
                <div className="text-sm text-muted-foreground mt-1">
                  {project.description}
                </div>
              )}
              {!!project.techStack?.length && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Tech: {project.techStack?.join(", ")}
                </div>
              )}
              <div className="mt-2 text-xs flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground">Start:</span>
                <span className="text-muted-foreground">
                  {project.startTime
                    ? new Intl.DateTimeFormat("en-GB").format(
                        new Date(project.startTime),
                      )
                    : "—"}
                </span>
                {canEditEstimate && (
                  <>
                    <input
                      type="date"
                      className="h-8 rounded border border-border bg-bg px-2 text-xs"
                      value={editStartTime}
                      onChange={(e) => setEditStartTime(e.target.value)}
                    />
                    <Button
                      onClick={saveStartTime}
                      variant="outline"
                      size="sm"
                      disabled={savingStartTime}
                    >
                      {savingStartTime ? "Saving…" : "Save Start"}
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canAdminProject && (
                <>
                  <Button
                    onClick={() => setEditOpen((v) => !v)}
                    variant="outline"
                    size="sm"
                  >
                    {editOpen ? "Close Edit" : "Edit Project"}
                  </Button>
                  <Button
                    onClick={deleteProject}
                    variant="destructive"
                    size="sm"
                  >
                    <Trash size={12} />
                  </Button>
                </>
              )}
              <BackButton to=".." />
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
                  <div className="text-xs text-muted-foreground">
                    {roleLabel(m)}
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
                  <Select value={editTeamLead} onValueChange={setEditTeamLead}>
                    <SelectTrigger className="w-full h-9">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs mb-1">Client</label>
                  <Select
                    value={editClientId || NO_CLIENT_VALUE}
                    onValueChange={(v) =>
                      setEditClientId(v === NO_CLIENT_VALUE ? "" : v)
                    }
                  >
                    <SelectTrigger className="w-full h-9">
                      <SelectValue placeholder="No client" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CLIENT_VALUE}>No client</SelectItem>
                      {clients.map((c) => (
                        <SelectItem key={c._id} value={c._id}>
                          {c.name} {c.email ? `(${c.email})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                  <ReportingPersonMultiSelect
                    options={employeeOptions}
                    value={editMembers}
                    onChange={setEditMembers}
                    placeholder="Search employees and press Enter to add"
                    emptyMessage="No employees available"
                  />
                  <div className="text-xs text-muted-foreground mt-1">
                    Add members one by one; selections show as pills.
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button onClick={saveProjectDetails} disabled={savingProject}>
                  {savingProject ? "Saving…" : "Save Changes"}
                </Button>
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
                    <span className="text-muted-foreground">Estimated</span>
                    <span className="font-medium">
                      {minutesToHours(project.estimatedTimeMinutes || 0)} h
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Monthly cap</span>
                    <span className="font-medium">
                      {project.monthlyEstimateMinutes
                        ? `${minutesToHours(
                            project.monthlyEstimateMinutes || 0,
                          )} h/mo`
                        : "No cap"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Spent</span>
                    <span className="font-medium">
                      {minutesToHours(spentMinutes)} h
                    </span>
                  </div>
                  {(project.estimatedTimeMinutes || 0) >= spentMinutes ? (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Remaining</span>
                      <span className="font-medium">
                        {minutesToHours(
                          Math.max(
                            0,
                            (project.estimatedTimeMinutes || 0) - spentMinutes,
                          ),
                        )}{" "}
                        h
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-error">
                      <span>Over by</span>
                      <span className="font-medium">
                        {minutesToHours(
                          spentMinutes - (project.estimatedTimeMinutes || 0),
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
                          (spent / Math.max(1, est)) * 100,
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
                        ((spent - est) / Math.max(1, spent)) * 100,
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

            {canEditEstimate ? (
              <div className="rounded-md border border-border bg-bg p-4">
                <div className="text-sm font-medium mb-3">Edit Estimates</div>
                <div className="space-y-3">
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs mb-1">
                        Total estimate (hours)
                      </label>
                      <input
                        className="h-10 w-full rounded border border-border bg-surface px-3"
                        type="number"
                        min={0}
                        step={0.1}
                        placeholder="Estimated hours"
                        value={editEstimatedHours}
                        onChange={(e) => setEditEstimatedHours(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1">
                        Monthly cap (hours/month)
                      </label>
                      <input
                        className="h-10 w-full rounded border border-border bg-surface px-3"
                        type="number"
                        min={0}
                        step={0.1}
                        placeholder="e.g. 90"
                        value={editMonthlyHours}
                        onChange={(e) => setEditMonthlyHours(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <Button onClick={saveEstimates} disabled={savingEstimate}>
                      {savingEstimate ? "Saving…" : "Save estimates"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-border bg-bg p-4">
                <div className="text-sm font-medium mb-2">
                  Your time on this project
                </div>
                <div className="text-2xl font-semibold">
                  {minutesToHours(selfTimeMinutes)} h
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Total minutes logged by you on tasks in this project.
                </div>
              </div>
            )}

            {/* Active/Inactive toggle for admins (non-personal projects) */}
            {canAdminProject && project && !project.isPersonal && (
              <div className="rounded-md border border-border bg-bg p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Project Status</div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded border ${
                        project.active !== false
                          ? "border-secondary/30 text-secondary bg-secondary/10"
                          : "border-muted/40 text-muted-foreground"
                      }`}
                    >
                      {project.active !== false ? "Active" : "Inactive"}
                    </span>
                    <Button
                      onClick={() => toggleActive(!(project.active !== false))}
                      variant="outline"
                      size="sm"
                    >
                      {project.active !== false
                        ? "Mark Inactive"
                        : "Mark Active"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {canCreateTask && id && (
        <div className="flex items-center justify-end">
          <Link
            to="tasks/new"
            relative="path"
            className="h-10 px-4 rounded-md bg-primary text-white text-sm inline-flex items-center justify-center"
          >
            Add Task
          </Link>
        </div>
      )}

      {/* Tasks list (recent 3) */}
      <div className="space-y-3">
        {sortedTasks.slice(0, 3).map((t) => {
          const assigneeNames = formatAssignees(t);
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
                    <div className="text-sm text-muted-foreground mt-1">
                      {t.description}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-muted-foreground flex gap-4">
                    <span>Assigned to: {assigneeNames || "Member"}</span>
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
                      {!t.isMeetingDefault && (
                        <button
                          onClick={() =>
                            nav(`tasks/new?taskId=${t._id}`, { replace: false })
                          }
                          className="h-9 rounded-md border border-border px-3 text-sm hover:bg-bg"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                      {canDeleteTask &&
                        (t.isMeetingDefault ? (
                          <span className="text-[11px] text-muted-foreground">
                            Default meeting task
                          </span>
                        ) : (
                          <button
                            onClick={() => deleteTask(t._id)}
                            className="h-9 rounded-md border border-error/30 text-error px-3 text-sm hover:bg-error/10"
                          >
                            <Trash size={12} />
                          </button>
                        ))}
                    </>
                  )}
                </div>
              </div>

              {/* Manual time entry (add hours) */}
              {/* {canCollaborate && (
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
                  <Button
                    onClick={() => saveTime(t._id)}
                    variant="outline"
                    disabled={
                      timeEntry[t._id]?.hours === undefined ||
                      timeEntry[t._id]?.hours === "" ||
                      parseFloat(timeEntry[t._id]?.hours || "0") <= 0
                    }
                  >
                    Save Time
                  </Button>
                </div>
              )} */}
            </div>
          );
        })}
        {tasks.length === 0 && (
          <div className="text-sm text-muted-foreground">No tasks yet.</div>
        )}
        {taskTotal > 0 && (
          <div>
            <Button asChild variant="outline" className="h-10">
              <Link to="tasks" relative="path">
                View All Tasks
              </Link>
            </Button>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpenCommentsFor(null)}
              >
                Close
              </Button>
            </div>
            {(() => {
              const task = tasks.find((x) => x._id === openCommentsFor);
              if (!task) return null;
              return (
                <div className="p-4">
                  <div className="text-sm font-medium mb-2">{task.title}</div>
                  <div className="max-h-[48vh] overflow-y-auto space-y-2 pr-1">
                    {(task.comments || []).length === 0 && (
                      <div className="text-xs text-muted-foreground">
                        No comments yet.
                      </div>
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
                      disabled={
                        project?.active === false || project?.isActive === false
                      }
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
                        project?.active === false ||
                        project?.isActive === false ||
                        !commentText[task._id] ||
                        !commentText[task._id].trim()
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
    </div>
  );
}
