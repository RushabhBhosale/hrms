import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { Th, Td } from "../../components/utils/Table";
import { getEmployee, hasPermission } from "../../lib/auth";
import { MessageSquare, Pencil } from "lucide-react";
import { Button } from "../../components/ui/button";

type EmployeeLite = { id: string; name: string };
type ProjectLite = { id: string; title: string };

type Task = {
  _id: string;
  title: string;
  description?: string;
  parentTask?: string | null;
  assignedTo: string | string[];
  status: "PENDING" | "INPROGRESS" | "DONE";
  timeSpentMinutes?: number;
  estimatedTimeMinutes?: number;
  project: { _id: string; title: string } | string;
  updatedAt?: string;
  priority?: "URGENT" | "FIRST" | "SECOND" | "LEAST";
  isMeetingDefault?: boolean;
  children?: Task[];
  timeLogs?: {
    _id?: string;
    minutes: number;
    note?: string;
    createdAt: string;
    addedBy?: string | { _id: string; name?: string };
    addedByName?: string;
  }[];
};

type MyTasksProps = {
  initialProjectId?: string | null;
  heading?: string;
};

export default function MyTasks({ initialProjectId, heading }: MyTasksProps) {
  const me = getEmployee();
  const isEmp = me?.subRoles.includes("hr") || me?.subRoles.includes("manager");
  console.log("fhf", me);
  const myId = String(me?.id || "");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Track hours to add to a task (adds a log entry; does not replace total)
  const [timeEntry, setTimeEntry] = useState<
    Record<string, { hours?: string; minutes?: string; note?: string }>
  >({});
  const [statusFilter, setStatusFilter] = useState<"ALL" | Task["status"]>(
    "ALL",
  );
  const [projectFilter, setProjectFilter] = useState<"ALL" | string>(
    initialProjectId || "ALL",
  );
  const [assigneeFilter, setAssigneeFilter] = useState<"ALL" | string>("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [view, setView] = useState<"CARD" | "TABLE">("TABLE");
  const [msg, setMsg] = useState<Record<string, { ok?: string; err?: string }>>(
    {},
  );
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [openLogs, setOpenLogs] = useState<Record<string, boolean>>({});
  const canChangeStatus = hasPermission(me, "tasks", "status");
  const canCreateTasks = hasPermission(me, "tasks", "write");
  const canEditTasks = hasPermission(me, "tasks", "write");
  const canChangeTask = canChangeStatus || canEditTasks;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const basePath = pathname.startsWith("/admin") ? "/admin" : "/app";

  function projectDetailsPath(projectId: string) {
    return `${basePath}/projects/${projectId}/tasks`;
  }

  function taskEditPath(projectId: string, taskId: string) {
    return `${basePath}/projects/${projectId}/tasks/new?taskId=${taskId}`;
  }

  function taskDetailsPath(taskId: string) {
    return `${basePath}/tasks/${taskId}`;
  }

  function assigneeIds(t: Task) {
    return (Array.isArray(t.assignedTo) ? t.assignedTo : [t.assignedTo])
      .map((x) => String(x))
      .filter(Boolean);
  }

  const empMap = useMemo(() => {
    return new Map(employees.map((e) => [String(e.id), e.name]));
  }, [employees]);

  function formatAssignees(t: Task) {
    const ids = assigneeIds(t);
    if (!ids.length) return "—";
    const names = ids.map((id) => empMap.get(String(id)) || "Member");
    return names.join(", ");
  }

  function isMine(t: Task) {
    if (!myId) return false;
    return assigneeIds(t).includes(String(myId));
  }

  function minutesToHours(m: number) {
    if (!Number.isFinite(m)) return "0.00";
    const totalMinutes = Math.max(0, Math.round(m || 0));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    // Return as H.MM where minutes are base-60 (00-59)
    return `${hours}.${minutes.toString().padStart(2, "0")}`;
  }

  async function loadTasks(
    targetPage = page,
    targetLimit = limit,
    projectIdOverride?: "ALL" | string,
  ) {
    try {
      setErr(null);
      setLoading(true);
      const res = await api.get("/projects/tasks", {
        params: {
          page: targetPage,
          limit: targetLimit,
          employeeId: assigneeFilter === "ALL" ? undefined : assigneeFilter,
          projectId:
            (projectIdOverride ?? projectFilter) === "ALL"
              ? undefined
              : projectIdOverride ?? projectFilter,
          status: statusFilter === "ALL" ? undefined : statusFilter,
          search: debouncedSearch ? debouncedSearch : undefined,
          includeLogs: true,
          includeChildren: true,
        },
      });
      setTasks(res.data.tasks || []);
      setTotal(res.data.total || 0);
      setPages(res.data.pages || 1);
      if (res.data.page && res.data.page !== page) {
        setPage(res.data.page);
      }
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const [empRes, projRes] = await Promise.all([
          api.get("/companies/employees"),
          api.get("/projects"),
        ]);
        setEmployees(
          (empRes.data.employees || []).map((e: any) => ({
            id: e.id,
            name: e.name,
          })),
        );
        setProjects(
          (projRes.data.projects || []).map((p: any) => ({
            id: p._id || p.id,
            title: p.title || "Untitled",
          })),
        );
      } catch {
        // ignore
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (initialProjectId) {
      setProjectFilter(initialProjectId);
      setPage(1);
      loadTasks(1, limit, initialProjectId);
    }
  }, [initialProjectId]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 400);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
    loadTasks(1, limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, projectFilter, assigneeFilter, debouncedSearch]);

  function changePage(next: number) {
    const clamped = Math.max(1, Math.min(pages, next || 1));
    setPage(clamped);
    loadTasks(clamped, limit);
  }

  function changeLimit(next: number) {
    const n = Math.max(1, next || 10);
    setLimit(n);
    setPage(1);
    loadTasks(1, n);
  }

  const projectOptions = useMemo(
    () => projects.map((p) => ({ id: String(p.id), title: p.title })),
    [projects],
  );

  const childMap = useMemo(() => {
    const m = new Map<string, Task[]>();
    const seenByParent = new Map<string, Set<string>>();
    const addChild = (parentId: string, child: Task) => {
      const key = String(parentId);
      const seen = seenByParent.get(key) || new Set<string>();
      const cid = String(child._id);
      if (seen.has(cid)) return;
      seen.add(cid);
      seenByParent.set(key, seen);
      const list = m.get(key) || [];
      list.push(child);
      m.set(key, list);
    };
    // Children returned as separate rows with parentTask
    tasks.forEach((t) => {
      if (!t.parentTask) return;
      addChild(String(t.parentTask), t);
    });
    // Children returned nested on the parent
    tasks.forEach((t) => {
      if (!t.children?.length) return;
      t.children.forEach((child) => addChild(String(t._id), child));
    });
    return m;
  }, [tasks]);

  const childMinutesMap = useMemo(() => {
    const m = new Map<string, number>();
    const seenByParent = new Map<string, Set<string>>();

    // Children returned as separate rows with parentTask
    tasks.forEach((t) => {
      if (!t.parentTask) return;
      const key = String(t.parentTask);
      m.set(key, (m.get(key) || 0) + (t.timeSpentMinutes || 0));
      const seen = seenByParent.get(key) || new Set<string>();
      seen.add(String(t._id));
      seenByParent.set(key, seen);
    });

    // Children returned nested on the parent
    tasks.forEach((t) => {
      if (!t.children?.length) return;
      const key = String(t._id);
      const seen = seenByParent.get(key) || new Set<string>();
      let add = 0;
      t.children.forEach((child) => {
        const cid = String(child._id);
        if (seen.has(cid)) return;
        add += child.timeSpentMinutes || 0;
        seen.add(cid);
      });
      if (add > 0) {
        m.set(key, (m.get(key) || 0) + add);
      }
      seenByParent.set(key, seen);
    });

    return m;
  }, [tasks]);

  const pageRows = useMemo(() => tasks.filter((t) => !t.parentTask), [tasks]);
  const childCountMap = useMemo(() => {
    const m = new Map<string, number>();
    tasks.forEach((t) => {
      if (t.parentTask) {
        const key = String(t.parentTask);
        m.set(key, (m.get(key) || 0) + 1);
      }
    });
    return m;
  }, [tasks]);
  const pagedRows = useMemo(
    () => pageRows.slice((page - 1) * limit, page * limit),
    [pageRows, page, limit],
  );
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = total === 0 ? 0 : Math.min(total, page * limit);

  const projectIdFor = (t: Task) =>
    typeof t.project === "string" ? t.project : t.project?._id || "";

  function toggleLogs(taskId: string) {
    setOpenLogs((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  }

  async function updateStatus(t: Task, status: Task["status"]) {
    if (!canChangeTask) return;
    try {
      const projectId =
        typeof t.project === "string" ? t.project : t.project._id;
      await api.put(`/projects/${projectId}/tasks/${t._id}`, { status });
      await loadTasks();
    } catch (e) {
      // ignore, load will reflect errors if any
    }
  }

  async function saveTime(t: Task) {
    if (!isMine(t)) return;
    const entry = timeEntry[t._id];
    const hours = parseFloat(entry?.hours || "0");
    const minsOnly = parseInt(entry?.minutes || "0", 10);
    const note = (entry?.note || "").trim();
    const addMinutes = Math.max(
      0,
      Math.round((isNaN(hours) ? 0 : hours) * 60) +
        (Number.isFinite(minsOnly) ? minsOnly : 0),
    );
    if (!addMinutes || addMinutes <= 0) {
      setMsg((m) => ({
        ...m,
        [t._id]: { err: "Enter time to add (hours and/or minutes)" },
      }));
      return;
    }
    if (!note) {
      setMsg((m) => ({
        ...m,
        [t._id]: { err: "Add a short description of what you did" },
      }));
      return;
    }
    const projectId = typeof t.project === "string" ? t.project : t.project._id;
    try {
      // Add time to this task for today (validated against attendance cap server-side)
      await api.post(`/projects/${projectId}/tasks/${t._id}/time`, {
        minutes: addMinutes,
        note,
      });
      setTimeEntry((s) => ({
        ...s,
        [t._id]: { hours: "", minutes: "", note: "" },
      }));
      setMsg((m) => ({ ...m, [t._id]: { ok: "Time added" } }));
      await loadTasks();
    } catch (e: any) {
      const apiErr = e?.response?.data?.error;
      const txt =
        apiErr ||
        "Failed to add time. Ensure you have remaining time today and are a member of this project.";
      setMsg((m) => ({ ...m, [t._id]: { err: txt } }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">
            {heading || "Tasks"}
          </h2>
          {canCreateTasks && (
            <Link
              to={`${basePath}/projects`}
              className="h-9 px-3 rounded-md bg-primary text-white text-sm inline-flex items-center justify-center"
              title="Pick a project to add a task"
            >
              Add Task
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            aria-label="Search tasks"
            placeholder="Search tasks"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 min-w-[200px] max-w-[320px] rounded border border-border bg-bg px-3 text-sm"
          />
          {isEmp && (
            <select
              className="h-9 rounded border border-border bg-bg px-2 text-sm"
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value as any)}
            >
              <option value="ALL">All Assignees</option>
              {myId && <option value={myId}>Me</option>}
              {employees
                .filter((e) => String(e.id) !== String(myId))
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          )}
          <select
            className="h-9 rounded border border-border bg-bg px-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="ALL">All Status</option>
            <option value="PENDING">Pending</option>
            <option value="INPROGRESS">In Progress</option>
            <option value="DONE">Done</option>
          </select>
          <select
            className="h-9 rounded border border-border bg-bg px-2 text-sm"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value as any)}
          >
            <option value="ALL">All Projects</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          {/* <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              className={`h-9 px-3 text-sm ${
                view === "CARD" ? "bg-primary text-white" : "bg-surface"
              }`}
              onClick={() => setView("CARD")}
            >
              Cards
            </button>
            <button
              className={`h-9 px-3 text-sm border-l border-border ${
                view === "TABLE" ? "bg-primary text-white" : "bg-surface"
              }`}
              onClick={() => setView("TABLE")}
            >
              Table
            </button>
          </div> */}
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      {view === "CARD" ? (
        <div className="space-y-3">
          {loading && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}
          {!loading && total === 0 && (
            <div className="text-sm text-muted-foreground">No tasks found.</div>
          )}
          {pagedRows.map((t) => (
            <div
              key={t._id}
              className="border border-border bg-surface rounded-md p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {typeof t.project === "string"
                      ? t.project
                      : t.project?.title}
                  </div>
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
                  <div className="mt-2 text-xs text-muted-foreground">
                    Assigned to: {formatAssignees(t)}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Estimated:{" "}
                    {t.estimatedTimeMinutes
                      ? `${minutesToHours(t.estimatedTimeMinutes)} h`
                      : "—"}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Time spent:{" "}
                    {minutesToHours(
                      (t.timeSpentMinutes || 0) +
                        (childMinutesMap.get(String(t._id)) || 0),
                    )}{" "}
                    h
                  </div>
                  {projectIdFor(t) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to={`${projectDetailsPath(projectIdFor(t))}?view=${t._id}`}
                        className="h-8 px-3 rounded-md border border-border text-xs flex items-center"
                      >
                        View Details
                      </Link>
                      {canEditTasks && !t.isMeetingDefault && (
                        <Link
                          to={taskEditPath(projectIdFor(t), t._id)}
                          className="h-8 px-3 rounded-md bg-primary text-white text-xs flex items-center"
                        >
                          Edit
                        </Link>
                      )}
                    </div>
                  )}
                </div>
                <select
                  className="h-9 rounded border border-border bg-bg px-2 text-sm"
                  value={t.status}
                  disabled={!isMine(t)}
                  onChange={(e) =>
                    updateStatus(t, e.target.value as Task["status"])
                  }
                >
                  <option value="PENDING">Pending</option>
                  <option value="INPROGRESS">In Progress</option>
                  <option value="DONE">Done</option>
                </select>
              </div>

              <div className="mt-3 space-y-2">
                <input
                  className="w-full h-10 rounded border border-border bg-bg px-3 text-sm"
                  placeholder="What did you work on?"
                  value={timeEntry[t._id]?.note || ""}
                  disabled={!isMine(t)}
                  onChange={(e) =>
                    setTimeEntry((s) => ({
                      ...s,
                      [t._id]: { ...s[t._id], note: e.target.value },
                    }))
                  }
                />
                <div className="grid sm:grid-cols-[160px_120px_120px] gap-2 items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Hours</span>
                    <input
                      className="h-9 w-24 rounded border border-border bg-bg px-3 text-sm"
                      type="number"
                      min={0}
                      step={0.25}
                      placeholder="0"
                      value={timeEntry[t._id]?.hours || ""}
                      disabled={!isMine(t)}
                      onChange={(e) =>
                        setTimeEntry((s) => ({
                          ...s,
                          [t._id]: { ...s[t._id], hours: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Minutes
                    </span>
                    <input
                      className="h-9 w-24 rounded border border-border bg-bg px-3 text-sm"
                      type="number"
                      min={0}
                      step={5}
                      placeholder="0"
                      value={timeEntry[t._id]?.minutes || ""}
                      disabled={!isMine(t)}
                      onChange={(e) =>
                        setTimeEntry((s) => ({
                          ...s,
                          [t._id]: { ...s[t._id], minutes: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <button
                    onClick={() => saveTime(t)}
                    className="h-9 rounded-md border border-border px-3 text-sm hover:bg-bg disabled:opacity-50"
                    disabled={
                      !isMine(t) ||
                      !timeEntry[t._id]?.note?.trim() ||
                      (!timeEntry[t._id]?.hours &&
                        !timeEntry[t._id]?.minutes) ||
                      (parseFloat(timeEntry[t._id]?.hours || "0") <= 0 &&
                        parseInt(timeEntry[t._id]?.minutes || "0", 10) <= 0)
                    }
                  >
                    Add Time
                  </button>
                </div>
              </div>
              {msg[t._id]?.err && (
                <div className="mt-2 text-xs text-error">{msg[t._id]?.err}</div>
              )}
              {msg[t._id]?.ok && (
                <div className="mt-2 text-xs text-success">
                  {msg[t._id]?.ok}
                </div>
              )}
              {t.timeLogs && t.timeLogs.length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Recent logs
                  </div>
                  {t.timeLogs
                    .slice(-3)
                    .reverse()
                    .map((log, idx) => (
                      <div
                        key={idx}
                        className="text-xs text-muted-foreground flex items-center gap-2"
                      >
                        <span>
                          {new Date(log.createdAt).toLocaleDateString()}
                        </span>
                        <span>•</span>
                        <span>{minutesToHours(log.minutes)} h</span>
                        {log.note && (
                          <>
                            <span>•</span>
                            <span className="line-clamp-1">{log.note}</span>
                          </>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg">
                <tr className="text-left">
                  <Th>Project</Th>
                  <Th className="w-[35%]">Title</Th>
                  {/* <Th>Assignees</Th> */}
                  <Th>Status</Th>
                  <Th>Priority</Th>
                  <Th>Estimated</Th>
                  <Th>Time Spent</Th>
                  <Th>Actions</Th>
                  {/* <Th className="min-w-[260px]">Log Progress</Th> */}
                  {/* <Th>Update</Th> */}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-6 py-10 text-center text-muted-foreground"
                    >
                      Loading…
                    </td>
                  </tr>
                ) : pagedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-6 py-10 text-center text-muted-foreground"
                    >
                      No tasks found.
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((t) => {
                    const projectTitle =
                      typeof t.project === "string"
                        ? t.project
                        : t.project?.title;
                    const totalHours = minutesToHours(
                      (t.timeSpentMinutes || 0) +
                        (childMinutesMap.get(String(t._id)) || 0),
                    );
                    const estHours = minutesToHours(
                      t.estimatedTimeMinutes || 0,
                    );
                    return (
                      <tr
                        key={t._id}
                        className="border-t border-border/70 hover:bg-bg/60 transition-colors"
                      >
                        <Td className="whitespace-nowrap text-muted-foreground">
                          {projectTitle}
                        </Td>
                        <Td>
                          <button
                            className="max-w-[22rem] truncate font-medium text-left hover:underline flex items-center gap-2"
                            title={t.title}
                            onClick={() =>
                              navigate(taskDetailsPath(t._id), {
                                state: { task: t },
                              })
                            }
                          >
                            <span>{t.title}</span>
                            {!!childCountMap.get(String(t._id)) && (
                              <span className="text-[11px] rounded-full px-2 py-0.5 border border-border text-muted-foreground">
                                {childCountMap.get(String(t._id))} subtask
                                {childCountMap.get(String(t._id))! > 1 ? "s" : ""}
                              </span>
                            )}
                          </button>
                        </Td>
                        <Td>
                          <select
                            className="h-8 rounded border border-border bg-bg px-2 text-xs"
                            value={t.status}
                            disabled={!canChangeTask}
                            onChange={(e) =>
                              updateStatus(t, e.target.value as Task["status"])
                            }
                          >
                            <option value="PENDING">Pending</option>
                            <option value="INPROGRESS">In Progress</option>
                            <option value="DONE">Done</option>
                          </select>
                        </Td>
                        <Td>
                          {t.priority ? (
                            <span className="text-xs px-2 py-0.5 rounded border border-border bg-bg">
                              {t.priority === "URGENT"
                                ? "Urgent"
                                : t.priority === "FIRST"
                                  ? "First"
                                  : t.priority === "SECOND"
                                    ? "Second"
                                    : "Least"}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              -
                            </span>
                          )}
                        </Td>
                        <Td className="text-muted-foreground">
                          {t.estimatedTimeMinutes ? `${estHours} h` : "—"}
                        </Td>
                        <Td>{totalHours} h</Td>
                        <Td>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              className="h-8 px-2 py-2 rounded border border-border text-xs"
                              onClick={() =>
                                navigate(taskDetailsPath(t._id), {
                                  state: { task: t },
                                })
                              }
                              title="Comments & details"
                            >
                              <MessageSquare size={12} />
                            </button>
                            {canEditTasks && projectIdFor(t) && !t.isMeetingDefault && (
                              <Link
                                to={taskEditPath(projectIdFor(t), t._id)}
                                className="h-8 px-2 py-2 rounded bg-primary text-white text-xs"
                              >
                                <Pencil size={12} />
                              </Link>
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Showing {start}-{end} of {total} tasks
            </div>
            <div className="flex items-center gap-2">
              <select
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                value={limit}
                onChange={(e) => {
                  changeLimit(parseInt(e.target.value, 10));
                }}
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
              <div className="inline-flex items-center gap-1">
                <button
                  className="h-9 rounded-md border border-border bg-surface px-3 text-sm disabled:opacity-50"
                  onClick={() => changePage(1)}
                  disabled={page === 1}
                >
                  First
                </button>
                <button
                  className="h-9 rounded-md border border-border bg-surface px-3 text-sm disabled:opacity-50"
                  onClick={() => changePage(page - 1)}
                  disabled={page === 1}
                >
                  Prev
                </button>
                <button
                  className="h-9 rounded-md border border-border bg-surface px-3 text-sm disabled:opacity-50"
                  onClick={() => changePage(page + 1)}
                  disabled={page >= pages}
                >
                  Next
                </button>
                <button
                  className="h-9 rounded-md border border-border bg-surface px-3 text-sm disabled:opacity-50"
                  onClick={() => changePage(pages)}
                  disabled={page >= pages}
                >
                  Last
                </button>
              </div>
            </div>
          </div>
          {/* Mobile stacked list */}
          <div className="md:hidden divide-y divide-border">
            {loading ? (
              <div className="px-4 py-10 text-center text-muted-foreground">
                Loading…
              </div>
            ) : total === 0 ? (
              <div className="px-4 py-10 text-center text-muted-foreground">
                No tasks found.
              </div>
            ) : (
              pagedRows.map((t) => {
                const projectTitle =
                  typeof t.project === "string" ? t.project : t.project?.title;
                const totalHours = minutesToHours(
                  (t.timeSpentMinutes || 0) +
                    (childMinutesMap.get(String(t._id)) || 0),
                );
                const children = childMap.get(String(t._id)) || [];
                const isOpen = !!openLogs[t._id];
                const taskLogs = (t.timeLogs || []).slice().reverse();
                return (
                  <div key={t._id} className="p-4 space-y-3">
                    <div className="text-xs text-muted-foreground">
                      {projectTitle}
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <button
                          type="button"
                          className="text-left"
                          onClick={() =>
                            setOpenLogs((prev) => ({
                              ...prev,
                              [t._id]: !prev[t._id],
                            }))
                          }
                        >
                          <div className="font-medium flex items-center gap-2">
                            <span>{t.title}</span>
                            {(taskLogs.length > 0 || children.length > 0) && (
                              <span className="text-[10px] text-muted-foreground">
                                {isOpen ? "▲" : "▼"}
                              </span>
                            )}
                          </div>
                        </button>
                        <div className="text-xs text-muted-foreground">
                          Assigned to: {formatAssignees(t)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          className="h-8 rounded border border-border bg-bg px-2 text-xs"
                          value={t.status}
                          disabled={!canChangeTask}
                          onChange={(e) =>
                            updateStatus(t, e.target.value as Task["status"])
                          }
                        >
                          <option value="PENDING">Pending</option>
                          <option value="INPROGRESS">In Progress</option>
                          <option value="DONE">Done</option>
                        </select>
                        <span className="text-xs text-muted-foreground">
                          {totalHours} h
                        </span>
                      </div>
                    </div>
                    {projectIdFor(t) && (
                      <div className="flex flex-wrap gap-2">
                        <Link
                          to={`${projectDetailsPath(projectIdFor(t))}?view=${t._id}`}
                          className="h-8 px-3 rounded border border-border text-xs inline-flex items-center"
                        >
                          View
                        </Link>
                        {canEditTasks && !t.isMeetingDefault && (
                          <Link
                            to={taskEditPath(projectIdFor(t), t._id)}
                            className="h-8 px-3 rounded bg-primary text-white text-xs inline-flex items-center"
                          >
                            Edit
                          </Link>
                        )}
                      </div>
                    )}

                    {isOpen && taskLogs.length > 0 && (
                      <div className="text-[11px] text-muted-foreground space-y-1 border border-border rounded p-2 bg-bg/60">
                        {taskLogs.map((log) => (
                          <div key={log._id}>
                            {new Date(log.createdAt).toLocaleDateString()}:{" "}
                            {minutesToHours(log.minutes)} h
                            {log.addedByName ? ` • ${log.addedByName}` : ""}
                            {log.note ? ` — ${log.note}` : ""}
                          </div>
                        ))}
                      </div>
                    )}

                    {isOpen &&
                      children.map((child) => {
                        const childLogs = (child.timeLogs || [])
                          .slice()
                          .reverse();
                        const childOpen = !!openLogs[child._id];
                        const childHours = minutesToHours(
                          child.timeSpentMinutes || 0,
                        );
                        return (
                          <div
                            key={child._id}
                            className="rounded border border-border bg-white p-3 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase text-muted-foreground">
                                  Subtask
                                </span>
                                <span className="font-medium">
                                  {child.title}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  className="h-8 rounded border border-border bg-bg px-2 text-xs"
                                  value={child.status}
                                  disabled={!canChangeStatus}
                                  onChange={(e) =>
                                    updateStatus(
                                      child,
                                      e.target.value as Task["status"],
                                    )
                                  }
                                >
                                  <option value="PENDING">Pending</option>
                                  <option value="INPROGRESS">
                                    In Progress
                                  </option>
                                  <option value="DONE">Done</option>
                                </select>
                                <span className="text-xs text-muted-foreground">
                                  {childHours} h
                                </span>
                                {childLogs.length > 0 && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-[11px] px-1 h-auto"
                                    onClick={() =>
                                      setOpenLogs((prev) => ({
                                        ...prev,
                                        [child._id]: !prev[child._id],
                                      }))
                                    }
                                  >
                                    {childOpen ? "Hide logs" : "View logs"}
                                  </Button>
                                )}
                              </div>
                            </div>
                            {childOpen && childLogs.length > 0 && (
                              <div className="text-[11px] text-muted-foreground space-y-1 border border-border rounded p-2 bg-bg/50">
                                {childLogs.map((log) => (
                                  <div key={log._id}>
                                    {new Date(
                                      log.createdAt,
                                    ).toLocaleDateString()}
                                    : {minutesToHours(log.minutes)} h
                                    {log.addedByName
                                      ? ` • ${log.addedByName}`
                                      : ""}
                                    {log.note ? ` — ${log.note}` : ""}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}

                    <div className="flex flex-col gap-2">
                      <input
                        className="h-8 w-full rounded border border-border bg-bg px-2 text-xs"
                        placeholder="What did you work on?"
                        value={timeEntry[t._id]?.note || ""}
                        disabled={!isMine(t)}
                        onChange={(e) =>
                          setTimeEntry((s) => ({
                            ...s,
                            [t._id]: { ...s[t._id], note: e.target.value },
                          }))
                        }
                      />
                      <input
                        className="h-8 w-28 rounded border border-border bg-bg px-2 text-xs"
                        type="number"
                        min={0}
                        step={0.1}
                        placeholder="Add hours (today)"
                        value={timeEntry[t._id]?.hours || ""}
                        disabled={!isMine(t)}
                        onChange={(e) =>
                          setTimeEntry((s) => ({
                            ...s,
                            [t._id]: { hours: e.target.value },
                          }))
                        }
                      />
                      <button
                        onClick={() => saveTime(t)}
                        className="h-8 rounded-md border border-border px-2 text-xs hover:bg-bg disabled:opacity-50"
                        disabled={
                          !isMine(t) ||
                          !timeEntry[t._id]?.note?.trim() ||
                          timeEntry[t._id]?.hours === undefined ||
                          timeEntry[t._id]?.hours === "" ||
                          parseFloat(timeEntry[t._id]?.hours || "0") <= 0
                        }
                      >
                        Add
                      </button>
                    </div>
                    {msg[t._id]?.err && (
                      <div className="mt-1 text-[11px] text-error">
                        {msg[t._id]?.err}
                      </div>
                    )}
                    {msg[t._id]?.ok && (
                      <div className="mt-1 text-[11px] text-success">
                        {msg[t._id]?.ok}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}
    </div>
  );
}
