import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { formatDateDisplay } from "../../lib/utils";

type Task = {
  _id: string;
  title: string;
  description?: string;
  parentTask?: string | null;
  status: "PENDING" | "INPROGRESS" | "DONE";
  priority?: "URGENT" | "FIRST" | "SECOND" | "LEAST";
  timeSpentMinutes?: number;
  estimatedTimeMinutes?: number;
  project?: { _id: string; title: string } | string;
  timeLogs?: {
    _id?: string;
    minutes: number;
    note?: string;
    createdAt: string;
  }[];
  children?: Task[];
  updatedAt?: string;
  createdAt?: string;
};

function TaskStatusBadge({ status }: { status: Task["status"] }) {
  const map: Record<Task["status"], { label: string; className: string }> = {
    PENDING: {
      label: "Pending",
      className: "bg-muted/30 text-muted-foreground",
    },
    INPROGRESS: {
      label: "In Progress",
      className: "bg-blue-500/10 text-blue-600",
    },
    DONE: { label: "Done", className: "bg-green-500/10 text-green-700" },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${info.className}`}
    >
      {info.label}
    </span>
  );
}

function minutesToHours(m: number) {
  if (!Number.isFinite(m)) return "0.00";
  const totalMinutes = Math.max(0, Math.round(m || 0));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  // Present minutes in base-60 so decimals never exceed .59
  return `${hours}.${minutes.toString().padStart(2, "0")}`;
}

function getProjectId(task?: Task | null) {
  if (!task) return "";
  const proj = task.project;
  return typeof proj === "string" ? proj : proj?._id || "";
}

export default function TaskDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const stateTask = (location.state as { task?: Task } | undefined)?.task;
  const [task, setTask] = useState<Task | null>(stateTask || null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState<Record<string, boolean>>({});
  const [logFilter, setLogFilter] = useState<string>("all");

  const projectId = getProjectId(task);

  const logs = useMemo(
    () => (task?.timeLogs || []).slice().reverse(),
    [task?.timeLogs],
  );
  const children = useMemo(() => task?.children || [], [task?.children]);
  const combinedLogs = useMemo(() => {
    if (!task) return [];
    const own =
      (task.timeLogs || []).map((log) => ({
        ...log,
        taskId: task._id,
        taskTitle: task.title,
      })) || [];
    const childLogs = (task.children || []).flatMap((c) =>
      (c.timeLogs || []).map((log) => ({
        ...log,
        taskId: c._id,
        taskTitle: c.title || "Subtask",
      })),
    );
    return [...own, ...childLogs].sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return Number.isFinite(tb) && Number.isFinite(ta) ? tb - ta : 0;
    });
  }, [task]);

  const filteredLogs = useMemo(() => {
    if (logFilter === "all") return combinedLogs;
    return combinedLogs.filter((log) => log.taskId === logFilter);
  }, [combinedLogs, logFilter]);

  const totalChildMinutes = useMemo(
    () => children.reduce((sum, c) => sum + (c.timeSpentMinutes || 0), 0),
    [children],
  );
  const totalMinutes = (task?.timeSpentMinutes || 0) + totalChildMinutes;

  async function fetchTask() {
    if (!id) return;
    try {
      setErr(null);
      setLoading(true);
      const res = await api.get(`/projects/tasks/${id}`, {
        params: { includeLogs: true, includeChildren: true },
      });
      setTask(res.data.task || null);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load task");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function updateSubtaskStatus(childId: string, status: Task["status"]) {
    if (!projectId) return;
    setStatusSaving((s) => ({ ...s, [childId]: true }));
    try {
      await api.put(`/projects/${projectId}/tasks/${childId}`, { status });
      await fetchTask();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to update subtask");
    } finally {
      setStatusSaving((s) => ({ ...s, [childId]: false }));
    }
  }

  if (!id) {
    return (
      <div className="p-6">
        <p className="text-sm text-error">Missing task id.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading task…</div>
    );
  }

  if (!task) {
    return (
      <div className="p-6 text-sm text-error">{err || "Task not found."}</div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6 relative">
      {err && (
        <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs uppercase text-muted-foreground tracking-wide">
            Task
          </div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold">{task.title}</h2>
            <TaskStatusBadge status={task.status} />
          </div>
          <div className="text-sm text-muted-foreground">
            {typeof task.project === "string"
              ? task.project
              : task.project?.title || "-"}{" "}
            · Updated{" "}
            {task?.updatedAt ? formatDateDisplay(task.updatedAt as any) : "-"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => navigate(-1)}
          >
            Back
          </Button>
        </div>
      </div>

      {task.description && (
        <section className="rounded-lg border border-border bg-surface shadow-sm p-4">
          <h3 className="text-sm font-semibold mb-1">Description</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {task.description}
          </p>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
          <div className="text-xs text-muted-foreground">Priority</div>
          <div className="mt-1 font-medium">{task.priority || "-"}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
          <div className="text-xs text-muted-foreground">
            Estimated (parent)
          </div>
          <div className="mt-1 font-medium">
            {task.estimatedTimeMinutes
              ? `${minutesToHours(task.estimatedTimeMinutes)} h`
              : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
          <div className="text-xs text-muted-foreground">
            Time Spent (incl. subtasks)
          </div>
          <div className="mt-1 font-semibold">
            {minutesToHours(totalMinutes)} h
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
          <div className="text-xs text-muted-foreground">Created</div>
          <div className="mt-1 font-medium">
            {task?.createdAt ? formatDateDisplay(task.createdAt as any) : "-"}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-lg border border-border bg-surface shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Subtasks</h3>
            <div className="text-xs text-muted-foreground">
              {children.length} item{children.length === 1 ? "" : "s"}
            </div>
          </div>
          {children.length === 0 ? (
            <div className="text-xs text-muted-foreground">No subtasks.</div>
          ) : (
            <div className="border border-border/60 rounded-lg overflow-hidden">
              <div className="hidden md:grid grid-cols-[1fr_120px_110px_110px] text-xs bg-bg text-muted-foreground">
                <div className="px-3 py-2">Title</div>
                <div className="px-3 py-2">Status</div>
                <div className="px-3 py-2">Time</div>
                <div className="px-3 py-2 text-right">Logs</div>
              </div>
              <div className="divide-y divide-border/70">
                {children.map((c) => {
                  return (
                    <div
                      key={c._id}
                      className="grid grid-cols-1 md:grid-cols-[1fr_120px_110px_110px] items-start text-sm"
                    >
                      <div className="px-3 py-3 space-y-1">
                        <div className="font-medium">{c.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.description || ""}
                        </div>
                      </div>
                      <div className="px-3 py-3">
                        <select
                          className="h-9 w-full rounded border border-border bg-bg px-2 text-xs"
                          value={c.status}
                          onChange={(e) =>
                            updateSubtaskStatus(
                              c._id,
                              e.target.value as Task["status"],
                            )
                          }
                          disabled={statusSaving[c._id]}
                        >
                          <option value="PENDING">Pending</option>
                          <option value="INPROGRESS">In Progress</option>
                          <option value="DONE">Done</option>
                        </select>
                      </div>
                      <div className="px-3 py-3 text-sm text-muted-foreground">
                        {minutesToHours(c.timeSpentMinutes || 0)} h
                      </div>
                      <div className="px-3 py-3 text-right">
                        <button
                          className={`text-xs underline ${logFilter === c._id ? "text-primary font-semibold" : "text-primary"}`}
                          onClick={() => setLogFilter(c._id)}
                        >
                          View logs
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">Time Logs (all)</h3>
            <div className="text-xs text-muted-foreground">
              {filteredLogs.length} entry
              {filteredLogs.length === 1 ? "" : "ies"}
            </div>
          </div>
          {logFilter !== "all" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                Viewing logs for:{" "}
                {children.find((c) => c._id === logFilter)?.title || "Subtask"}
              </span>
              <button
                className="h-7 px-3 rounded border border-border bg-bg text-foreground hover:bg-surface"
                onClick={() => setLogFilter("all")}
              >
                All logs
              </button>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Showing all logs (parent + subtasks)
            </div>
          )}
          {combinedLogs.length === 0 ? (
            <div className="text-xs text-muted-foreground">No logs yet.</div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              No logs for this subtask yet.
            </div>
          ) : (
            <div className="space-y-2 text-sm max-h-80 overflow-y-auto pr-1">
              {filteredLogs.map((log, idx) => (
                <div
                  key={log._id || `${log.taskId}-log-${idx}`}
                  className="flex items-start justify-between gap-3 border border-border/50 rounded px-3 py-2"
                >
                  <div className="space-y-1">
                    <div className="font-medium">{log.note || "Log entry"}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateDisplay(log.createdAt)}
                      {log.taskTitle ? ` · ${log.taskTitle}` : ""}
                    </div>
                  </div>
                  <div className="text-sm font-semibold">
                    {minutesToHours(log.minutes || 0)} h
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
