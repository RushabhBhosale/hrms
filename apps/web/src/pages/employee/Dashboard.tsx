import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import RoleGuard from "../../components/RoleGuard";
import { getEmployee } from "../../lib/auth";

type Attendance = {
  firstPunchIn?: string;
  lastPunchOut?: string;
  lastPunchIn?: string;
  workedMs?: number; // accumulated up to the last punch/out
};

function format(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(total % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export default function EmployeeDash() {
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"in" | "out" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Missing punch-out days (this month)
  const [missingDays, setMissingDays] = useState<string[]>([]);
  const [missingLoading, setMissingLoading] = useState(false);
  const [missingErr, setMissingErr] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const timerRef = useRef<number | null>(null);
  const me = getEmployee();

  function fmtDateKey(key: string) {
    const [y, m, d] = key.split("-").map((x) => parseInt(x, 10));
    const local = new Date(y, (m || 1) - 1, d || 1);
    return local.toLocaleDateString();
  }

  // My projects (assigned to me as member or team lead)
  type MyProject = {
    _id: string;
    title: string;
    description?: string;
    isPersonal?: boolean;
  };
  const [myProjects, setMyProjects] = useState<MyProject[]>([]);
  const [projLoading, setProjLoading] = useState(false);
  const [projErr, setProjErr] = useState<string | null>(null);

  // Assigned tasks widget
  type Task = {
    _id: string;
    title: string;
    status: "PENDING" | "INPROGRESS" | "DONE";
    timeSpentMinutes?: number;
    project: { _id: string; title: string } | string;
    updatedAt?: string;
  };
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksErr, setTasksErr] = useState<string | null>(null);

  // Punch-out modal state
  const [showPunchOut, setShowPunchOut] = useState(false);
  type Assigned = Task & {
    projectId: string;
    projectTitle: string;
    checked?: boolean;
    hours?: string; // user input hours, e.g. 1.5
  };
  const [assigned, setAssigned] = useState<Assigned[]>([]);
  const [assignedLoading, setAssignedLoading] = useState(false);
  const [assignedErr, setAssignedErr] = useState<string | null>(null);
  const [workedToday, setWorkedToday] = useState<{
    minutes: number;
    dateKey: string;
  } | null>(null);
  const [workedTasksToday, setWorkedTasksToday] = useState<
    { taskId: string; minutes: number }[]
  >([]);
  const [projects, setProjects] = useState<{ _id: string; title: string }[]>(
    []
  );
  // Add new task form
  const [newTaskProjectId, setNewTaskProjectId] = useState<string>("");
  const [newTaskTitle, setNewTaskTitle] = useState<string>("");
  const [newTaskStatus, setNewTaskStatus] = useState<"PENDING" | "DONE">(
    "PENDING"
  );
  const [addingTask, setAddingTask] = useState(false);
  const [submittingPunchOut, setSubmittingPunchOut] = useState(false);
  const [punchOutErr, setPunchOutErr] = useState<string | null>(null);
  // Personal task support
  const [usePersonal, setUsePersonal] = useState(false);
  const [personalProjectId, setPersonalProjectId] = useState<string>("");

  // Backfill (log tasks for a past missing punch-out day)
  const [showBackfill, setShowBackfill] = useState(false);
  const [backfillDate, setBackfillDate] = useState<string | null>(null);
  const [backfillErr, setBackfillErr] = useState<string | null>(null);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillSubmitting, setBackfillSubmitting] = useState(false);
  const [workedTasksForDay, setWorkedTasksForDay] = useState<
    { taskId: string; minutes: number }[]
  >([]);
  // Backfill: require setting punch-out time first
  const [backfillOutTime, setBackfillOutTime] = useState<string>("");
  const [backfillSavingOut, setBackfillSavingOut] = useState(false);
  const [backfillAttendance, setBackfillAttendance] = useState<{
    firstPunchIn?: string;
    lastPunchOut?: string;
    workedMs?: number;
  } | null>(null);

  // Set punch-out for a past day
  const [showSetOut, setShowSetOut] = useState(false);
  const [setOutDate, setSetOutDate] = useState<string | null>(null);
  const [setOutTime, setSetOutTime] = useState<string>("");
  const [setOutErr, setSetOutErr] = useState<string | null>(null);
  const [setOutSubmitting, setSetOutSubmitting] = useState(false);

  const remainingMinutes = useMemo(() => {
    // Use elapsed as up-to-now worked time in ms
    const total = Math.round(elapsed / 60000); // minutes
    const alreadyLogged = workedTasksToday.reduce(
      (acc, t) => acc + (t.minutes || 0),
      0
    );
    // Enforce 60 min break: only allow total - 60
    const cap = Math.max(0, total - 60);
    const remain = cap - alreadyLogged;
    return remain > 0 ? remain : 0;
  }, [elapsed, workedTasksToday]);

  async function load() {
    try {
      setErr(null);
      setLoading(true);
      const res = await api.get("/attendance/today");
      setAttendance(res.data.attendance ?? null);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load attendance");
    } finally {
      setLoading(false);
    }
    // Refresh missing punch-outs in parallel
    loadMissingOut();
  }

  async function punch(action: "in" | "out") {
    if (pending) return;
    try {
      setPending(action);
      await api.post("/attendance/punch", { action });
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || `Failed to punch ${action}`);
    } finally {
      setPending(null);
    }
  }

  async function loadMissingOut() {
    try {
      setMissingErr(null);
      setMissingLoading(true);
      const ym = new Date().toISOString().slice(0, 7);
      const res = await api.get("/attendance/missing-out", {
        params: { month: ym },
      });
      setMissingDays(res.data?.days || []);
    } catch (e: any) {
      setMissingErr(
        e?.response?.data?.error || "Failed to load missing punch-outs"
      );
    } finally {
      setMissingLoading(false);
    }
  }

  const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const blockingMissingDays = useMemo(
    () => missingDays.filter((d) => d !== todayKey),
    [missingDays, todayKey]
  );
  const hasBlockingMissing = blockingMissingDays.length > 0;

  async function openPunchOutModal() {
    if (pending) return;
    setPunchOutErr(null);
    setShowPunchOut(true);
    // load assigned tasks & today logs & projects
    try {
      setAssignedErr(null);
      setAssignedLoading(true);
      const [assignedRes, workedRes, projectsRes] = await Promise.all([
        api.get("/projects/tasks/assigned"),
        api.get("/projects/tasks/worked"),
        api.get("/projects"),
      ]);
      const list: Task[] = assignedRes.data.tasks || [];
      const normalized: Assigned[] = list.map((t) => ({
        ...t,
        projectId:
          typeof t.project === "string"
            ? (t.project as string)
            : (t.project?._id as string),
        projectTitle:
          typeof t.project === "string" ? "" : t.project?.title || "",
        checked: false,
        hours: "",
      }));
      setAssigned(normalized);
      const tasksToday: {
        tasks: { _id: string; minutes: number; project?: { _id: string } }[];
      } = workedRes.data || { tasks: [] };
      setWorkedTasksToday(
        (tasksToday.tasks || []).map((t) => ({
          taskId: t._id,
          minutes: t.minutes || 0,
        }))
      );
      setWorkedToday({
        minutes: Math.round(elapsed / 60000),
        dateKey: new Date().toISOString().slice(0, 10),
      });
      setProjects(
        (projectsRes.data.projects || []).map((p: any) => ({
          _id: p._id,
          title: p.title,
        }))
      );
      if (!newTaskProjectId && (projectsRes.data.projects || []).length > 0) {
        setNewTaskProjectId(projectsRes.data.projects[0]._id);
      }
    } catch (e: any) {
      setAssignedErr(e?.response?.data?.error || "Failed to load tasks");
    } finally {
      setAssignedLoading(false);
    }
  }

  async function openBackfillModal(dateKey: string) {
    if (pending) return;
    setBackfillErr(null);
    setBackfillDate(dateKey);
    setShowBackfill(true);
    setBackfillOutTime("");
    setBackfillAttendance(null);
    try {
      setBackfillLoading(true);
      const [assignedRes, workedRes, projectsRes] = await Promise.all([
        api.get("/projects/tasks/assigned"),
        api.get("/projects/tasks/worked", { params: { date: dateKey } }),
        api.get("/projects"),
      ]);
      const list: Task[] = assignedRes.data.tasks || [];
      const normalized: Assigned[] = list.map((t) => ({
        ...t,
        projectId:
          typeof t.project === "string"
            ? (t.project as string)
            : (t.project?._id as string),
        projectTitle:
          typeof t.project === "string" ? "" : t.project?.title || "",
        checked: false,
        hours: "",
      }));
      setAssigned(normalized);
      const tasksDay: { tasks: { _id: string; minutes: number }[] } =
        workedRes.data || { tasks: [] };
      setWorkedTasksForDay(
        (tasksDay.tasks || []).map((t) => ({
          taskId: t._id,
          minutes: t.minutes || 0,
        }))
      );
      setProjects(
        (projectsRes.data.projects || []).map((p: any) => ({
          _id: p._id,
          title: p.title,
        }))
      );
      if (!newTaskProjectId && (projectsRes.data.projects || []).length > 0) {
        setNewTaskProjectId(projectsRes.data.projects[0]._id);
      }
    } catch (e: any) {
      setBackfillErr(e?.response?.data?.error || "Failed to load tasks");
    } finally {
      setBackfillLoading(false);
    }
  }

  async function addNewTask() {
    const targetProjectId = usePersonal ? personalProjectId : newTaskProjectId;
    if (!newTaskTitle.trim() || !targetProjectId || !me?.id) return;
    try {
      setAddingTask(true);
      const res = await api.post(`/projects/${targetProjectId}/tasks`, {
        title: newTaskTitle.trim(),
        description: "",
        assignedTo: me.id,
      });
      const t: Task = res.data.task;
      // If user selected DONE, immediately set status to DONE (assignee-only action)
      if (newTaskStatus === "DONE") {
        try {
          await api.put(`/projects/${targetProjectId}/tasks/${t._id}`, {
            status: "DONE",
          });
          t.status = "DONE";
        } catch (e) {
          // Ignore status update failure; keep default PENDING
        }
      }
      const a: Assigned = {
        ...t,
        projectId: targetProjectId,
        projectTitle: usePersonal
          ? "Personal"
          : projects.find((p) => p._id === targetProjectId)?.title || "",
        checked: true,
        // Prefer remaining for active modal (backfill vs today)
        hours:
          showBackfill && backfillAttendance
            ? (() => {
                const worked = Math.max(
                  0,
                  Math.floor((backfillAttendance.workedMs || 0) / 60000)
                );
                const cap = Math.max(0, worked - 60);
                const already = workedTasksForDay.reduce(
                  (acc, t) => acc + (t.minutes || 0),
                  0
                );
                const remain = Math.max(0, cap - already);
                return remain > 0 ? (remain / 60).toFixed(2) : "1";
              })()
            : remainingMinutes > 0
            ? (remainingMinutes / 60).toFixed(2)
            : "1",
      };
      setAssigned((prev) => [a, ...prev]);
      setNewTaskTitle("");
      setNewTaskStatus("PENDING");
    } catch (e: any) {
      setPunchOutErr(e?.response?.data?.error || "Failed to add task");
    } finally {
      setAddingTask(false);
    }
  }

  async function submitPunchOutWithTasks() {
    if (submittingPunchOut) return;
    setPunchOutErr(null);
    try {
      setSubmittingPunchOut(true);
      // Pre-validate total requested minutes against remaining cap
      const selected = assigned.filter((t) => t.checked);
      const requested = selected.reduce(
        (acc, t) =>
          acc + Math.max(0, Math.round(parseFloat(t.hours || "0") * 60)),
        0
      );
      if (requested > remainingMinutes) {
        const over = requested - remainingMinutes;
        setPunchOutErr(
          `Selected time exceeds allowed by ${over} minutes. Reduce to at most ${remainingMinutes} minutes.`
        );
        setSubmittingPunchOut(false);
        return;
      }
      // For each selected task, log time if hours > 0
      for (const t of selected) {
        const h = parseFloat(t.hours || "0");
        const minutes = Math.round(h * 60);
        if (!minutes || minutes <= 0) continue; // skip empty entries
        await api.post(`/projects/${t.projectId}/tasks/${t._id}/time`, {
          minutes,
        });
      }
      // Finally punch out
      await punch("out");
      setShowPunchOut(false);
    } catch (e: any) {
      setPunchOutErr(
        e?.response?.data?.error || "Failed to punch out with tasks"
      );
    } finally {
      setSubmittingPunchOut(false);
    }
  }

  async function submitBackfillTasks() {
    if (backfillSubmitting || !backfillDate) return;
    setBackfillErr(null);
    try {
      // Require punch-out time to be set first
      if (!backfillAttendance || !backfillAttendance.lastPunchOut) {
        setBackfillErr("Please set punch-out time first.");
        return;
      }

      // Compute remaining cap = worked - 60 - alreadyLogged
      const worked = Math.max(
        0,
        Math.floor((backfillAttendance.workedMs || 0) / 60000)
      );
      const cap = Math.max(0, worked - 60);
      const already = workedTasksForDay.reduce(
        (acc, t) => acc + (t.minutes || 0),
        0
      );
      const remainingForDay = Math.max(0, cap - already);

      // Pre-validate selected minutes against remaining cap
      const selected = assigned.filter((t) => t.checked);
      const requested = selected.reduce(
        (acc, t) =>
          acc + Math.max(0, Math.round(parseFloat(t.hours || "0") * 60)),
        0
      );
      if (requested > remainingForDay) {
        const over = requested - remainingForDay;
        setBackfillErr(
          `Selected time exceeds allowed by ${over} minutes. Reduce to at most ${remainingForDay} minutes.`
        );
        return;
      }

      setBackfillSubmitting(true);
      for (const t of selected) {
        const h = parseFloat(t.hours || "0");
        const minutes = Math.round(h * 60);
        if (!minutes || minutes <= 0) continue;
        await api.post(`/projects/${t.projectId}/tasks/${t._id}/time-at`, {
          minutes,
          date: backfillDate,
        });
      }
      setShowBackfill(false);
      // Refresh worked summary for that bucket and missing list
      await loadMissingOut();
    } catch (e: any) {
      setBackfillErr(
        e?.response?.data?.error || "Failed to log tasks for the day"
      );
    } finally {
      setBackfillSubmitting(false);
    }
  }

  // drive elapsed from backend fields
  useEffect(() => {
    // clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!attendance) {
      setElapsed(0);
      return;
    }

    const base = attendance.workedMs ?? 0;

    // actively punched in: base + (now - lastPunchIn)
    if (attendance.lastPunchIn && !attendance.lastPunchOut) {
      const start = new Date(attendance.lastPunchIn).getTime();

      const tick = () => setElapsed(base + (Date.now() - start));
      tick(); // immediate
      timerRef.current = window.setInterval(tick, 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }

    // not currently punched in: show base only
    setElapsed(base);
  }, [attendance]);

  // keep timer correct when tab visibility changes (prevents drift)
  useEffect(() => {
    const handleVis = () => {
      if (document.hidden) return;
      // force recompute by re-setting attendance (no extra fetch)
      setAttendance((prev) => (prev ? { ...prev } : prev));
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, []);

  useEffect(() => {
    load();
  }, []);

  // Load my visible projects (exclude personal)
  useEffect(() => {
    (async () => {
      try {
        setProjErr(null);
        setProjLoading(true);
        const res = await api.get("/projects");
        const list: MyProject[] = (res.data.projects || []).filter(
          (p: MyProject) => !p.isPersonal
        );
        setMyProjects(list);
      } catch (e: any) {
        setProjErr(e?.response?.data?.error || "Failed to load projects");
      } finally {
        setProjLoading(false);
      }
    })();
  }, []);

  // Load assigned tasks (top 5 by recent update, incomplete first)
  useEffect(() => {
    (async () => {
      try {
        setTasksErr(null);
        setTasksLoading(true);
        const res = await api.get("/projects/tasks/assigned");
        const list: Task[] = res.data.tasks || [];
        const sorted = list
          .slice()
          .sort((a, b) => {
            // Incomplete before done
            const ad = a.status === "DONE" ? 1 : 0;
            const bd = b.status === "DONE" ? 1 : 0;
            if (ad !== bd) return ad - bd;
            // Newest first
            const au = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const bu = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return bu - au;
          })
          .slice(0, 5);
        setTasks(sorted);
      } catch (e: any) {
        setTasksErr(e?.response?.data?.error || "Failed to load tasks");
      } finally {
        setTasksLoading(false);
      }
    })();
  }, []);

  const punchedIn = Boolean(
    attendance?.lastPunchIn && !attendance?.lastPunchOut
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Employee Area</h2>
        <p className="text-sm text-muted">
          Track today’s time and quick actions.
        </p>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-red-50 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-sm text-muted">Time worked today</div>
            <div className="text-4xl font-semibold tabular-nums">
              {format(elapsed)}
            </div>
            <div className="mt-2">
              <span
                className={[
                  "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium",
                  punchedIn
                    ? "bg-secondary/10 text-secondary"
                    : "bg-accent/10 text-accent",
                ].join(" ")}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    punchedIn ? "bg-secondary" : "bg-accent"
                  }`}
                />
                {punchedIn ? "Punched In" : "Punched Out"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading || !!pending}
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            {punchedIn ? (
              <button
                className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-60"
                onClick={openPunchOutModal}
                disabled={pending === "out"}
              >
                {pending === "out" ? "Punching Out…" : "Punch Out"}
              </button>
            ) : (
              <>
                {hasBlockingMissing && (
                  <button
                    className="rounded-md border border-border px-3 py-2 text-sm"
                    onClick={() => setShowMissing(true)}
                    title="Resolve missing punch-outs to enable Punch In"
                  >
                    Resolve Missing
                  </button>
                )}
                <button
                  className="rounded-md bg-secondary px-4 py-2 text-white disabled:opacity-60"
                  onClick={() => punch("in")}
                  disabled={pending === "in" || hasBlockingMissing}
                  title={
                    hasBlockingMissing
                      ? "You have missing punch-outs. Resolve them first."
                      : undefined
                  }
                >
                  {pending === "in" ? "Punching In…" : "Punch In"}
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* My Projects */}
      <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">My Projects</h3>
            <p className="text-sm text-muted">Projects you're assigned to</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
              onClick={async () => {
                try {
                  setProjLoading(true);
                  const res = await api.get("/projects");
                  const list: MyProject[] = (res.data.projects || []).filter(
                    (p: MyProject) => !p.isPersonal
                  );
                  setMyProjects(list);
                } finally {
                  setProjLoading(false);
                }
              }}
              disabled={projLoading}
            >
              {projLoading ? "Refreshing…" : "Refresh"}
            </button>
            <Link
              to="/app/projects"
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              View all
            </Link>
          </div>
        </div>

        {projErr && (
          <div className="mt-3 rounded-md border border-error/20 bg-red-50 px-3 py-2 text-sm text-error">
            {projErr}
          </div>
        )}

        <div className="mt-4">
          {projLoading ? (
            <div className="text-sm text-muted">Loading projects…</div>
          ) : myProjects.length === 0 ? (
            <div className="text-sm text-muted">No project assignments.</div>
          ) : (
            <ul className="divide-y divide-border/60">
              {myProjects.slice(0, 6).map((p) => (
                <li key={p._id} className="py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium leading-5">{p.title}</div>
                      {p.description && (
                        <div className="text-xs text-muted mt-0.5 line-clamp-2">
                          {p.description}
                        </div>
                      )}
                    </div>
                    <Link
                      to={`/app/projects/${p._id}`}
                      className="text-xs underline whitespace-nowrap self-center"
                    >
                      Open
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <div className="p-4 rounded-lg border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">My Tasks</div>
            <Link to="/app/tasks" className="text-sm underline text-accent">
              View all
            </Link>
          </div>
          {tasksErr && (
            <div className="mb-2 rounded-md border border-error/20 bg-red-50 px-3 py-2 text-xs text-error">
              {tasksErr}
            </div>
          )}
          {tasksLoading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : tasks.length === 0 ? (
            <div className="text-sm text-muted">No tasks assigned.</div>
          ) : (
            <ul className="space-y-2">
              {tasks.map((t) => (
                <li
                  key={t._id}
                  className="border border-border rounded px-3 py-2"
                >
                  <div className="text-xs text-muted">
                    {typeof t.project === "string"
                      ? t.project
                      : t.project?.title}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{t.title}</div>
                    <span className="text-xs text-muted">
                      {t.status === "PENDING"
                        ? "Pending"
                        : t.status === "INPROGRESS"
                        ? "In Progress"
                        : "Done"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <RoleGuard sub={["hr"]}>
          <HRPanel />
        </RoleGuard>
        <RoleGuard sub={["manager"]}>
          <div className="p-4 rounded-lg border border-border bg-surface shadow-sm">
            Manager Panel
          </div>
        </RoleGuard>
      </div>

      {/* Punch-out modal */}
      {showPunchOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowPunchOut(false)}
          />
          <div className="relative w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">Log today’s tasks</h4>
              <button
                className="text-sm underline"
                onClick={() => setShowPunchOut(false)}
              >
                Close
              </button>
            </div>
            {punchOutErr && (
              <div className="mb-3 rounded-md border border-error/20 bg-red-50 px-3 py-2 text-sm text-error">
                {punchOutErr}
              </div>
            )}
            <div className="text-xs text-muted mb-3">
              {workedToday ? (
                <>
                  Total today: {Math.round(elapsed / 60000)} mins • Logged:{" "}
                  {workedTasksToday.reduce((a, b) => a + b.minutes, 0)} mins •
                  Remaining: {remainingMinutes} mins
                </>
              ) : (
                <>Today: {new Date().toLocaleDateString()}</>
              )}
            </div>

            {/* Add new task */}
            <div className="mb-4 rounded border border-border p-3 bg-white">
              <div className="mb-2 text-sm font-medium">Add a task</div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={usePersonal}
                    onChange={async (e) => {
                      const v = e.target.checked;
                      setUsePersonal(v);
                      if (v && !personalProjectId) {
                        try {
                          const resp = await api.get("/projects/personal");
                          setPersonalProjectId(resp.data.project?._id || "");
                        } catch {}
                      }
                    }}
                  />
                  <span>Personal task</span>
                </label>
                <select
                  className="h-9 rounded-md border border-border bg-surface px-2 disabled:opacity-50"
                  value={newTaskProjectId}
                  onChange={(e) => setNewTaskProjectId(e.target.value)}
                  disabled={usePersonal}
                >
                  {projects.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.title}
                    </option>
                  ))}
                </select>
                <input
                  className="h-9 flex-1 min-w-[160px] rounded-md border border-border bg-surface px-2"
                  placeholder="Task title"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                />
                <select
                  className="h-9 rounded-md border border-border bg-surface px-2"
                  value={newTaskStatus}
                  onChange={(e) => setNewTaskStatus(e.target.value as any)}
                  title="Set initial status"
                >
                  <option value="PENDING">Pending</option>
                  <option value="DONE">Done</option>
                </select>
                <button
                  className="h-9 rounded-md bg-secondary px-3 text-white disabled:opacity-60"
                  onClick={addNewTask}
                  disabled={
                    addingTask ||
                    !newTaskTitle.trim() ||
                    (!usePersonal && !newTaskProjectId) ||
                    (usePersonal && !personalProjectId)
                  }
                >
                  {addingTask ? "Adding…" : "Add"}
                </button>
              </div>
            </div>

            {/* Assigned tasks list */}
            {assignedErr && (
              <div className="mb-3 rounded-md border border-error/20 bg-red-50 px-3 py-2 text-sm text-error">
                {assignedErr}
              </div>
            )}
            {assignedLoading ? (
              <div className="text-sm text-muted">Loading tasks…</div>
            ) : (
              <div className="max-h-80 overflow-auto pr-1">
                {assigned.length === 0 ? (
                  <div className="text-sm text-muted">No assigned tasks.</div>
                ) : (
                  <div className="space-y-4">
                    {Array.from(
                      assigned.reduce((map, t) => {
                        const key = t.projectId || "misc";
                        if (!map.has(key))
                          map.set(key, {
                            title: t.projectTitle || "(No project)",
                            items: [] as Assigned[],
                          });
                        map.get(key)!.items.push(t);
                        return map;
                      }, new Map<string, { title: string; items: Assigned[] }>())
                    ).map(([pid, group]) => (
                      <div key={pid} className="">
                        <div className="text-sm font-medium mb-1">
                          {group.title}
                        </div>
                        <ul className="space-y-2">
                          {group.items.map((t) => (
                            <li
                              key={t._id}
                              className="flex items-center gap-3 border border-border rounded px-3 py-2"
                            >
                              <label className="inline-flex items-center gap-2 flex-1">
                                <input
                                  type="checkbox"
                                  checked={!!t.checked}
                                  onChange={(e) =>
                                    setAssigned((prev) =>
                                      prev.map((x) =>
                                        x._id === t._id
                                          ? { ...x, checked: e.target.checked }
                                          : x
                                      )
                                    )
                                  }
                                />
                                <span className="text-sm">{t.title}</span>
                              </label>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted">
                                  Hours
                                </span>
                                <input
                                  type="number"
                                  step="0.25"
                                  min="0"
                                  className="w-20 h-8 rounded-md border border-border bg-surface px-2 text-sm"
                                  value={t.hours || ""}
                                  onChange={(e) =>
                                    setAssigned((prev) =>
                                      prev.map((x) =>
                                        x._id === t._id
                                          ? { ...x, hours: e.target.value }
                                          : x
                                      )
                                    )
                                  }
                                  placeholder="0"
                                  disabled={!t.checked}
                                />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={() => setShowPunchOut(false)}
                disabled={submittingPunchOut}
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-60"
                  onClick={submitPunchOutWithTasks}
                  disabled={submittingPunchOut}
                >
                  {submittingPunchOut ? "Submitting…" : "Submit & Punch Out"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Backfill tasks modal (integrated with punch-out and add-task like today) */}
      {showBackfill && backfillDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowBackfill(false)}
          />
          <div className="relative w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">
                Resolve {fmtDateKey(backfillDate)}
              </h4>
              <button
                className="text-sm underline"
                onClick={() => setShowBackfill(false)}
              >
                Close
              </button>
            </div>
            {backfillErr && (
              <div className="mb-3 rounded-md border border-error/20 bg-red-50 px-3 py-2 text-sm text-error">
                {backfillErr}
              </div>
            )}
            <div className="space-y-3 mb-4 rounded border border-border p-3 bg-white">
              <div className="text-sm font-medium">
                Step 1: Set punch-out time
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm flex items-center gap-2">
                  <span className="w-28">Punch-out time</span>
                  <input
                    type="time"
                    className="h-9 rounded-md border border-border bg-surface px-2"
                    value={backfillOutTime}
                    onChange={(e) => setBackfillOutTime(e.target.value)}
                  />
                </label>
                <button
                  className="h-9 rounded-md bg-accent px-3 text-white disabled:opacity-60"
                  onClick={async () => {
                    if (!backfillDate || !backfillOutTime) return;
                    try {
                      setBackfillErr(null);
                      setBackfillSavingOut(true);
                      const resp = await api.post("/attendance/punchout-at", {
                        date: backfillDate,
                        time: backfillOutTime,
                      });
                      setBackfillAttendance(resp.data.attendance || null);
                      await loadMissingOut();
                    } catch (e: any) {
                      setBackfillErr(
                        e?.response?.data?.error ||
                          "Failed to set punch-out time"
                      );
                    } finally {
                      setBackfillSavingOut(false);
                    }
                  }}
                  disabled={!backfillOutTime || backfillSavingOut}
                >
                  {backfillSavingOut
                    ? "Saving…"
                    : backfillAttendance
                    ? "Saved"
                    : "Save"}
                </button>
              </div>
              <div className="text-xs text-muted">
                Example: 18:00. Total available after break will be calculated
                from your first punch-in to this time minus 60 minutes.
              </div>
            </div>

            <div className="text-xs text-muted mb-3">
              {backfillAttendance ? (
                <>
                  Total worked:{" "}
                  {Math.max(
                    0,
                    Math.floor((backfillAttendance.workedMs || 0) / 60000)
                  )}{" "}
                  mins • Logged:{" "}
                  {workedTasksForDay.reduce((a, b) => a + b.minutes, 0)} mins •
                  Remaining:{" "}
                  {(() => {
                    const worked = Math.max(
                      0,
                      Math.floor((backfillAttendance.workedMs || 0) / 60000)
                    );
                    const cap = Math.max(0, worked - 60);
                    const already = workedTasksForDay.reduce(
                      (acc, t) => acc + (t.minutes || 0),
                      0
                    );
                    return Math.max(0, cap - already);
                  })()}{" "}
                  mins
                </>
              ) : (
                <>Set punch-out time first to unlock task logging.</>
              )}
            </div>
            {backfillLoading ? (
              <div className="text-sm text-muted">Loading…</div>
            ) : (
              <div className="space-y-3">
                {/* Add new task (same as punch-out modal) */}
                <div className="mb-2 rounded border border-border p-3 bg-white">
                  <div className="mb-2 text-sm font-medium">Add a task</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={usePersonal}
                        onChange={async (e) => {
                          const v = e.target.checked;
                          setUsePersonal(v);
                          if (v && !personalProjectId) {
                            try {
                              const resp = await api.get("/projects/personal");
                              setPersonalProjectId(
                                resp.data.project?._id || ""
                              );
                            } catch {}
                          }
                        }}
                        disabled={!backfillAttendance}
                        title={
                          !backfillAttendance
                            ? "Set punch-out time first"
                            : undefined
                        }
                      />
                      <span>Personal task</span>
                    </label>
                    <select
                      className="h-9 rounded-md border border-border bg-surface px-2 disabled:opacity-50"
                      value={newTaskProjectId}
                      onChange={(e) => setNewTaskProjectId(e.target.value)}
                      disabled={usePersonal || !backfillAttendance}
                      title={
                        !backfillAttendance
                          ? "Set punch-out time first"
                          : undefined
                      }
                    >
                      {projects.map((p) => (
                        <option key={p._id} value={p._id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                    <input
                      className="h-9 flex-1 min-w-[160px] rounded-md border border-border bg-surface px-2"
                      placeholder="Task title"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      disabled={!backfillAttendance}
                    />
                    <select
                      className="h-9 rounded-md border border-border bg-surface px-2"
                      value={newTaskStatus}
                      onChange={(e) => setNewTaskStatus(e.target.value as any)}
                      title="Set initial status"
                      disabled={!backfillAttendance}
                    >
                      <option value="PENDING">Pending</option>
                      <option value="DONE">Done</option>
                    </select>
                    <button
                      className="h-9 rounded-md bg-secondary px-3 text-white disabled:opacity-60"
                      onClick={addNewTask}
                      disabled={
                        addingTask ||
                        !newTaskTitle.trim() ||
                        (!usePersonal && !newTaskProjectId) ||
                        (usePersonal && !personalProjectId) ||
                        !backfillAttendance
                      }
                      title={
                        !backfillAttendance
                          ? "Set punch-out time first"
                          : undefined
                      }
                    >
                      {addingTask ? "Adding…" : "Add"}
                    </button>
                  </div>
                </div>

                {/* Assigned tasks (grouped) */}
                <div className="text-sm font-medium">Assigned tasks</div>
                <ul className="space-y-2 max-h-72 overflow-auto pr-1">
                  {assigned.map((t) => (
                    <li
                      key={t._id}
                      className="border border-border rounded px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="mr-2">
                          <input
                            type="checkbox"
                            className="mr-2"
                            checked={!!t.checked}
                            onChange={(e) =>
                              setAssigned((prev) =>
                                prev.map((x) =>
                                  x._id === t._id
                                    ? { ...x, checked: e.target.checked }
                                    : x
                                )
                              )
                            }
                            disabled={!backfillAttendance}
                            title={
                              !backfillAttendance
                                ? "Set punch-out time first"
                                : undefined
                            }
                          />
                          <span className="font-medium text-sm">{t.title}</span>
                          <span className="ml-2 text-xs text-muted">
                            {t.projectTitle}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted">Hours</span>
                          <input
                            type="number"
                            step="0.25"
                            min="0"
                            className="w-20 h-8 rounded-md border border-border bg-surface px-2 text-sm"
                            value={t.hours || ""}
                            onChange={(e) =>
                              setAssigned((prev) =>
                                prev.map((x) =>
                                  x._id === t._id
                                    ? { ...x, hours: e.target.value }
                                    : x
                                )
                              )
                            }
                            placeholder="0"
                            disabled={!t.checked || !backfillAttendance}
                            title={
                              !backfillAttendance && t.checked
                                ? "Set punch-out time first"
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4 flex items-center justify-between">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={() => setShowBackfill(false)}
                disabled={backfillSubmitting || backfillSavingOut}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-60"
                onClick={submitBackfillTasks}
                disabled={backfillSubmitting || !backfillAttendance}
                title={
                  !backfillAttendance ? "Set punch-out time first" : undefined
                }
              >
                {backfillSubmitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set punch-out time modal */}
      {showSetOut && setOutDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowSetOut(false)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">
                Set punch-out for {fmtDateKey(setOutDate)}
              </h4>
              <button
                className="text-sm underline"
                onClick={() => setShowSetOut(false)}
              >
                Close
              </button>
            </div>
            {setOutErr && (
              <div className="mb-3 rounded-md border border-error/20 bg-red-50 px-3 py-2 text-sm text-error">
                {setOutErr}
              </div>
            )}
            <div className="space-y-3">
              <label className="text-sm flex items-center gap-2">
                <span className="w-28">Punch-out time</span>
                <input
                  type="time"
                  className="h-9 rounded-md border border-border bg-surface px-2"
                  value={setOutTime}
                  onChange={(e) => setSetOutTime(e.target.value)}
                />
              </label>
              <div className="text-xs text-muted">Example: 18:00</div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={() => setShowSetOut(false)}
                disabled={setOutSubmitting}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-60"
                disabled={!setOutTime || setOutSubmitting}
                onClick={async () => {
                  try {
                    setSetOutErr(null);
                    setSetOutSubmitting(true);
                    await api.post("/attendance/punchout-at", {
                      date: setOutDate,
                      time: setOutTime,
                    });
                    setShowSetOut(false);
                    await loadMissingOut();
                  } catch (e: any) {
                    setSetOutErr(
                      e?.response?.data?.error || "Failed to set punch-out time"
                    );
                  } finally {
                    setSetOutSubmitting(false);
                  }
                }}
              >
                {setOutSubmitting ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Missing punch-outs modal */}
      {showMissing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowMissing(false)}
          />
          <div className="relative w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">
                Resolve Missing Punch-Outs
              </h4>
              <button
                className="text-sm underline"
                onClick={() => setShowMissing(false)}
              >
                Close
              </button>
            </div>
            <div className="text-sm text-muted mb-3">
              You must resolve past days with a punch-in but no punch-out before
              punching in again.
            </div>
            {missingLoading ? (
              <div className="text-sm text-muted">Loading…</div>
            ) : missingErr ? (
              <div className="text-sm text-error">{missingErr}</div>
            ) : blockingMissingDays.length === 0 ? (
              <div className="text-sm">No unresolved days. You're all set!</div>
            ) : (
              <ul className="space-y-2 max-h-80 overflow-auto pr-1">
                {blockingMissingDays.map((d) => (
                  <li
                    key={d}
                    className="flex items-center justify-between gap-3 border border-border rounded px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full border border-border text-xs">
                        {fmtDateKey(d)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-md border border-border px-3 py-1 text-sm"
                        onClick={() => {
                          setShowMissing(false);
                          openBackfillModal(d);
                        }}
                      >
                        Log tasks
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-center justify-between">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={() => setShowMissing(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type CompanyEmployee = { id: string; name: string };

function HRPanel() {
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [leaveMap, setLeaveMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setErr(null);
        setLoading(true);
        const [emps, leaves] = await Promise.all([
          api.get("/companies/employees"),
          api.get("/leaves/company/today"),
        ]);
        setEmployees(emps.data.employees || []);
        const map: Record<string, boolean> = {};
        (leaves.data.leaves || []).forEach((l: any) => {
          const id = l.employee.id || l.employee._id;
          map[id] = true;
        });
        setLeaveMap(map);
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load HR data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="p-4 rounded-lg border border-border bg-surface shadow-sm">
      <div className="mb-4 font-semibold">HR Panel</div>
      {err && (
        <div className="mb-4 rounded-md border border-error/20 bg-red-50 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}
      {loading ? (
        <div>Loading…</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="px-2 py-1">Employee</th>
              <th className="px-2 py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-t border-border/70">
                <td className="px-2 py-1">{e.name}</td>
                <td className="px-2 py-1">
                  {leaveMap[e.id] ? "On Leave" : "Present"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
