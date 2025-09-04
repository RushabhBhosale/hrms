import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { Th, Td, SkeletonRows, Pagination } from "../../components/ui/Table";

type EmployeeLite = {
  id: string;
  name: string;
  email: string;
  subRoles: string[];
};
type Project = { _id: string; title: string };
type Task = {
  _id: string;
  title: string;
  description?: string;
  assignedTo: string;
  createdBy: string;
  status: "PENDING" | "INPROGRESS" | "DONE";
  priority?: "URGENT" | "FIRST" | "SECOND" | "LEAST";
  timeSpentMinutes?: number;
  estimatedTimeMinutes?: number;
  createdAt?: string;
};

function minutesToHours(min: number) {
  return Math.round(((min || 0) / 60) * 100) / 100;
}

function Badge({
  tone,
  children,
}: {
  tone: "neutral" | "blue" | "amber" | "green" | "red" | "gray";
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    neutral: "bg-bg text-foreground border-border",
    blue: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    amber: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    green: "bg-green-500/10 text-green-600 border-green-500/20",
    red: "bg-red-500/10 text-red-600 border-red-500/20",
    gray: "bg-muted/20 text-muted border-border/60",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

function StatusBadge({ s }: { s: Task["status"] }) {
  if (s === "DONE") return <Badge tone="green">Done</Badge>;
  if (s === "INPROGRESS") return <Badge tone="blue">In&nbsp;Progress</Badge>;
  return <Badge tone="gray">Pending</Badge>;
}

function PriorityBadge({ p }: { p?: Task["priority"] }) {
  if (!p) return <Badge tone="neutral">-</Badge>;
  if (p === "URGENT") return <Badge tone="red">Urgent</Badge>;
  if (p === "FIRST") return <Badge tone="amber">High</Badge>;
  if (p === "SECOND") return <Badge tone="blue">Medium</Badge>;
  return <Badge tone="gray">Low</Badge>;
}

export default function ProjectTasks() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState<number>(
    parseInt(sp.get("page") || "1", 10) || 1
  );
  const [limit, setLimit] = useState<number>(
    parseInt(sp.get("limit") || "20", 10) || 20
  );
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | Task["status"]>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<
    "ALL" | NonNullable<Task["priority"]>
  >("ALL");
  const [sortKey, setSortKey] = useState<
    "title" | "assignee" | "status" | "priority" | "time" | "created"
  >("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [editing, setEditing] = useState<null | Task>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState<{ title: string; description: string; assignedTo: string; priority: NonNullable<Task['priority']> | ''; estimatedHours: string; status: Task['status'] } | null>(null);

  useEffect(() => {
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("page", String(page));
        next.set("limit", String(limit));
        return next;
      },
      { replace: true }
    );
  }, [page, limit]);

  async function load() {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [proj, tlist] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/tasks`, { params: { page, limit } }),
      ]);
      setProject(proj.data.project);
      setTasks(tlist.data.tasks || []);
      setTotal(tlist.data.total || (tlist.data.tasks || []).length || 0);
      try {
        const emps = await api.get("/companies/employees");
        setEmployees(emps.data.employees || []);
      } catch {
        const mem = await api.get(`/projects/${id}/members`);
        setEmployees(mem.data.members || []);
      }
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id, page, limit]);

  const pages = useMemo(
    () => Math.max(1, Math.ceil(total / Math.max(1, limit))),
    [total, limit]
  );
  const start = useMemo(
    () => (total === 0 ? 0 : (page - 1) * limit + 1),
    [page, limit, total]
  );
  const end = useMemo(
    () => Math.min(total, page * limit),
    [page, limit, total]
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return tasks;
    return tasks.filter((t) => {
      const assigneeName =
        employees.find((e) => e.id === String(t.assignedTo))?.name || "";
      const prio = t.priority || "";
      return (
        t.title.toLowerCase().includes(term) ||
        assigneeName.toLowerCase().includes(term) ||
        t.status.toLowerCase().includes(term) ||
        prio.toLowerCase().includes(term)
      );
    });
  }, [q, tasks, employees]);

  const filtered2 = useMemo(() => {
    return filtered.filter((t) => {
      const okStatus = statusFilter === "ALL" || t.status === statusFilter;
      const okPrio = priorityFilter === "ALL" || t.priority === priorityFilter;
      return okStatus && okPrio;
    });
  }, [filtered, statusFilter, priorityFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered2];
    const dir = sortDir === "asc" ? 1 : -1;
    const getAssignee = (t: Task) =>
      employees.find((e) => e.id === String(t.assignedTo))?.name || "";
    arr.sort((a, b) => {
      switch (sortKey) {
        case "title":
          return dir * a.title.localeCompare(b.title);
        case "assignee":
          return dir * getAssignee(a).localeCompare(getAssignee(b));
        case "status":
          return dir * a.status.localeCompare(b.status);
        case "priority":
          return dir * String(a.priority || "").localeCompare(String(b.priority || ""));
        case "time":
          return dir * ((a.timeSpentMinutes || 0) - (b.timeSpentMinutes || 0));
        case "created":
        default:
          return (
            dir *
            ((new Date(a.createdAt || 0)).getTime() -
              (new Date(b.createdAt || 0)).getTime())
          );
      }
    });
    return arr;
  }, [filtered2, sortKey, sortDir, employees]);

  function toggleSort(k: typeof sortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "created" ? "desc" : "asc");
    }
  }

  function openEdit(t: Task) {
    setEditing(t);
    setEditForm({
      title: t.title || "",
      description: t.description || "",
      assignedTo: String(t.assignedTo || ""),
      priority: (t.priority || "") as any,
      estimatedHours: t.estimatedTimeMinutes ? String(Math.round(((t.estimatedTimeMinutes || 0)/60)*10)/10) : "",
      status: t.status,
    });
  }

  async function saveEdit() {
    if (!id || !editing || !editForm) return;
    setSavingEdit(true);
    try {
      const payload: any = {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        assignedTo: editForm.assignedTo,
        priority: editForm.priority || undefined,
        status: editForm.status,
      };
      const h = parseFloat(editForm.estimatedHours || '');
      if (isFinite(h) && h >= 0) payload.estimatedHours = h;
      await api.put(`/projects/${id}/tasks/${editing._id}`, payload);
      await load();
      setEditing(null);
      setEditForm(null);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to save task');
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeTask(taskId: string) {
    if (!id) return;
    if (!confirm('Delete this task?')) return;
    try {
      await api.delete(`/projects/${id}/tasks/${taskId}`);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to delete task');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight">
            Tasks{project ? ` • ${project.title}` : ""}
          </h2>
          <p className="text-sm text-muted">
            All project tasks with filters and pagination.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, assignee, status, priority…"
            className="h-10 w-80 rounded-md border border-border bg-surface px-3 outline-none ring-offset-2 focus:ring-2 focus:ring-primary"
          />
          <select
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="ALL">All Status</option>
            <option value="PENDING">Pending</option>
            <option value="INPROGRESS">In Progress</option>
            <option value="DONE">Done</option>
          </select>
          <select
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as any)}
          >
            <option value="ALL">All Priority</option>
            <option value="URGENT">Urgent</option>
            <option value="FIRST">First</option>
            <option value="SECOND">Second</option>
            <option value="LEAST">Least</option>
          </select>
          <button
            onClick={load}
            className="h-10 rounded-md bg-primary px-4 text-white outline-none ring-offset-2 focus:ring-2 focus:ring-primary"
          >
            Refresh
          </button>
          <Link
            to=".."
            relative="path"
            className="h-10 rounded-md border border-border px-4 text-sm flex items-center hover:bg-bg"
          >
            Back
          </Link>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="text-sm text-muted">
              Showing {start}-{end} of {total} tasks
            </div>
            <div className="flex items-center gap-2">
              <select
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                value={limit}
                onChange={(e) => {
                  setPage(1);
                  setLimit(parseInt(e.target.value, 10));
                }}
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-left">
                <Th sortable onSort={() => toggleSort("title")} dir={sortKey==='title'?sortDir:null}>Title</Th>
                <Th sortable onSort={() => toggleSort("assignee")} dir={sortKey==='assignee'?sortDir:null}>Assignee</Th>
                <Th sortable onSort={() => toggleSort("status")} dir={sortKey==='status'?sortDir:null}>Status</Th>
                <Th sortable onSort={() => toggleSort("priority")} dir={sortKey==='priority'?sortDir:null}>Priority</Th>
                <Th sortable onSort={() => toggleSort("time")} dir={sortKey==='time'?sortDir:null}>Time Spent</Th>
                <Th sortable onSort={() => toggleSort("created")} dir={sortKey==='created'?sortDir:null}>Created</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={6} cols={6} />
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center">
                    <div className="mx-auto w-fit space-y-2">
                      <div className="mx-auto h-10 w-10 rounded-full bg-bg" />
                      <div className="text-sm text-muted">
                        No tasks match your filters.
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                sorted.map((t) => {
                  const assigneeName =
                    employees.find((e) => e.id === String(t.assignedTo))
                      ?.name || "Member";
                  const totalHours = minutesToHours(t.timeSpentMinutes || 0);
                  const created = t.createdAt
                    ? new Date(t.createdAt).toLocaleString()
                    : "-";
                  return (
                    <tr
                      key={t._id}
                      className="border-t border-border/70 hover:bg-bg/60 transition-colors"
                    >
                      <Td>
                        <div
                          className="max-w-[32rem] truncate font-medium"
                          title={t.title}
                        >
                          {t.title}
                        </div>
                      </Td>
                      <Td>{assigneeName}</Td>
                      <Td>
                        <StatusBadge s={t.status} />
                      </Td>
                      <Td>
                        <PriorityBadge p={t.priority} />
                      </Td>
                      <Td>{totalHours} h</Td>
                      <Td className="whitespace-nowrap text-muted">{created}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEdit(t)}
                            className="h-8 px-3 rounded-md border border-border hover:bg-bg"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => removeTask(t._id)}
                            className="h-8 px-3 rounded-md border border-error/30 text-error hover:bg-error/10"
                          >
                            Delete
                          </button>
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden divide-y divide-border">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border p-3 animate-pulse space-y-2"
                >
                  <div className="h-4 w-40 bg-bg rounded" />
                  <div className="h-3 w-56 bg-bg rounded" />
                  <div className="h-6 w-24 bg-bg rounded" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-muted">
              No tasks match your filters.
            </div>
          ) : (
            filtered.map((t) => {
              const assigneeName =
                employees.find((e) => e.id === String(t.assignedTo))?.name ||
                "Member";
              const totalHours = minutesToHours(t.timeSpentMinutes || 0);
              const created = t.createdAt
                ? new Date(t.createdAt).toLocaleDateString()
                : "-";
              return (
                <div key={t._id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium" title={t.title}>
                        {t.title}
                      </div>
                      <div className="text-sm text-muted">{assigneeName}</div>
                    </div>
                    <div className="flex gap-2">
                      <StatusBadge s={t.status} />
                      <PriorityBadge p={t.priority} />
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-muted flex flex-wrap gap-4">
                    <span>Time: {totalHours} h</span>
                    <span>Created: {created}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => openEdit(t)}
                      className="h-8 px-3 rounded-md border border-border text-sm"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removeTask(t._id)}
                      className="h-8 px-3 rounded-md border border-error/30 text-error text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <div className="flex items-center justify-end">
        <Pagination
          page={page}
          pages={pages}
          onFirst={() => setPage(1)}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(pages, p + 1))}
          onLast={() => setPage(pages)}
          disabled={loading}
        />
      </div>

      {editing && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setEditing(null); setEditForm(null); }} />
          <div className="relative z-10 w-[min(700px,92vw)] max-h-[85vh] overflow-auto rounded-md border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Edit Task</div>
              <button className="h-8 px-3 rounded-md border border-border text-sm" onClick={() => { setEditing(null); setEditForm(null); }}>Close</button>
            </div>
            <div className="mt-3 grid md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs mb-1">Title</label>
                <input className="w-full h-9 rounded border border-border bg-bg px-2 text-sm" value={editForm.title} onChange={(e)=>setEditForm((f)=>f?{...f,title:e.target.value}:f)} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs mb-1">Description</label>
                <textarea className="w-full rounded border border-border bg-bg px-2 py-2 text-sm min-h-24" value={editForm.description} onChange={(e)=>setEditForm((f)=>f?{...f,description:e.target.value}:f)} />
              </div>
              <div>
                <label className="block text-xs mb-1">Assignee</label>
                <select className="w-full h-9 rounded border border-border bg-bg px-2 text-sm" value={editForm.assignedTo} onChange={(e)=>setEditForm((f)=>f?{...f,assignedTo:e.target.value}:f)}>
                  <option value="">Select</option>
                  {employees.map((e)=>(<option key={e.id} value={e.id}>{e.name}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Priority</label>
                <select className="w-full h-9 rounded border border-border bg-bg px-2 text-sm" value={editForm.priority} onChange={(e)=>setEditForm((f)=>f?{...f,priority:e.target.value as any}:f)}>
                  <option value="">None</option>
                  <option value="URGENT">Urgent</option>
                  <option value="FIRST">First</option>
                  <option value="SECOND">Second</option>
                  <option value="LEAST">Least</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Estimated Hours</label>
                <input className="w-full h-9 rounded border border-border bg-bg px-2 text-sm" type="number" min={0} step={0.1} value={editForm.estimatedHours} onChange={(e)=>setEditForm((f)=>f?{...f,estimatedHours:e.target.value}:f)} />
              </div>
              <div>
                <label className="block text-xs mb-1">Status</label>
                <select className="w-full h-9 rounded border border-border bg-bg px-2 text-sm" value={editForm.status} onChange={(e)=>setEditForm((f)=>f?{...f,status:e.target.value as any}:f)}>
                  <option value="PENDING">Pending</option>
                  <option value="INPROGRESS">In Progress</option>
                  <option value="DONE">Done</option>
                </select>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button onClick={saveEdit} disabled={savingEdit} className="h-9 px-4 rounded-md bg-primary text-white text-sm disabled:opacity-60">{savingEdit?'Saving…':'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Using shared Th, Td, SkeletonRows, Pagination from components/ui/Table
