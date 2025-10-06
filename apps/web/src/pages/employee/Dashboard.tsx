import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { api } from "../../lib/api";
import { formatMinutesLabel } from "../../lib/time";
import { resolveLocationLabel } from "../../lib/location";
import RoleGuard from "../../components/RoleGuard";
import { getEmployee } from "../../lib/auth";

type Attendance = {
  firstPunchIn?: string;
  lastPunchOut?: string;
  lastPunchIn?: string;
  firstPunchInLocation?: string | null;
  lastPunchInLocation?: string | null;
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
  type MissingIssue = {
    date: string;
    type: "missingPunchOut" | "autoPunch" | "noAttendance";
    autoPunchOutAt?: string;
  };

  // Missing attendance issues (this month)
  const [missingIssues, setMissingIssues] = useState<MissingIssue[]>([]);
  const [missingLoading, setMissingLoading] = useState(false);
  const [missingErr, setMissingErr] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [requestingManual, setRequestingManual] = useState<string | null>(null);
  const [leaveModal, setLeaveModal] = useState({
    open: false,
    date: null as string | null,
    startDate: "",
    endDate: "",
    type: "PAID",
    reason: "",
    saving: false,
    error: null as string | null,
  });
  const timerRef = useRef<number | null>(null);
  const refreshRef = useRef<number | null>(null);
  const midnightRef = useRef<number | null>(null);
  const me = getEmployee();

  function fmtDateKey(key: string) {
    const [y, m, d] = key.split("-").map((x) => parseInt(x, 10));
    const local = new Date(y, (m || 1) - 1, d || 1);
    return local.toLocaleDateString();
  }

  function describeIssue(issue: MissingIssue) {
    switch (issue.type) {
      case "autoPunch":
        return "Auto punch-out pending";
      case "noAttendance":
        return "No punches recorded";
      default:
        return "Punch-out missing";
    }
  }

  function fmtShortTime(iso?: string) {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function renderIssueHint(issue: MissingIssue) {
    if (issue.type === "autoPunch") {
      const time = fmtShortTime(issue.autoPunchOutAt);
      return (
        <div className="text-xs text-muted">
          {time
            ? `System closed the day at ${time}. Confirm the actual punch-out time.`
            : "System closed the day automatically. Confirm the actual punch-out time."}
        </div>
      );
    }
    if (issue.type === "noAttendance") {
      return (
        <div className="text-xs text-muted">
          Apply leave or notify an admin to record the punches for that day.
        </div>
      );
    }
    return (
      <div className="text-xs text-muted">
        Set the punch-out time and log the tasks you worked on.
      </div>
    );
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
    minutes?: string; // user input minutes, e.g. 30
  };
  function statusBadge(status: Task["status"]) {
    if (status === "DONE") {
      return {
        label: "Done",
        className: "bg-green-500/10 text-green-600 border-green-500/20",
      };
    }
    if (status === "INPROGRESS") {
      return {
        label: "In Progress",
        className: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      };
    }
    return {
      label: "Pending",
      className: "bg-muted/20 text-muted border-border/60",
    };
  }
  const [assigned, setAssigned] = useState<Assigned[]>([]);
  const [assignedLoading, setAssignedLoading] = useState(false);
  const [assignedErr, setAssignedErr] = useState<string | null>(null);
  const [assignedStatusView, setAssignedStatusView] = useState<
    "ACTIVE" | "DONE"
  >("ACTIVE");
  const filteredAssigned = useMemo(
    () =>
      assigned.filter((t) =>
        assignedStatusView === "DONE"
          ? t.status === "DONE"
          : t.status !== "DONE"
      ),
    [assigned, assignedStatusView]
  );
  function computeMinutes(entry: { hours?: string; minutes?: string }) {
    const hours = parseFloat(entry.hours || "0");
    const extraMinutes = parseInt(entry.minutes || "0", 10);
    const fromHours = Number.isFinite(hours) ? Math.round(hours * 60) : 0;
    const fromMinutes = Number.isFinite(extraMinutes) ? extraMinutes : 0;
    return Math.max(0, fromHours + fromMinutes);
  }
  const [workedToday, setWorkedToday] = useState<{
    minutes: number;
    dateKey: string;
  } | null>(null);
  const [workedTasksToday, setWorkedTasksToday] = useState<
    { taskId: string; minutes: number }[]
  >([]);
  type WorkedLog = {
    logId: string;
    taskId: string;
    taskTitle: string;
    projectId: string;
    projectTitle: string;
    minutes: number;
    note?: string;
    createdAt?: string;
    isEditing?: boolean;
    editingMinutes?: string;
    editingNote?: string;
    saving?: boolean;
    error?: string | null;
  };
  const [todayLogs, setTodayLogs] = useState<WorkedLog[]>([]);
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
  const [backfillLogs, setBackfillLogs] = useState<WorkedLog[]>([]);

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
    if (pending) return false;
    let success = false;
    try {
      setPending(action);
      let locationLabel: string | null = null;
      if (action === "in") {
        locationLabel = await resolveLocationLabel();
      }
      await api.post("/attendance/punch", {
        action,
        ...(locationLabel ? { location: locationLabel } : {}),
      });
      await load();
      success = true;
    } catch (e: any) {
      const conflictIssues = e?.response?.data?.issues;
      if (
        action === "in" &&
        e?.response?.status === 409 &&
        Array.isArray(conflictIssues)
      ) {
        const issues = conflictIssues as MissingIssue[];
        const count = issues.length || e?.response?.data?.issueCount || 0;
        setErr(
          `You still have ${count || "some"} pending attendance ${
            count === 1 ? "issue" : "issues"
          }. Select Resolve Attendance Issues to continue.`
        );
        try {
          await loadMissingOut();
        } catch (err) {
          console.warn("Failed to refresh missing issues", err);
        }
        setShowMissing(true);
      } else {
        setErr(e?.response?.data?.error || `Failed to punch ${action}`);
      }
    } finally {
      setPending(null);
    }
    return success;
  }

  async function loadMissingOut() {
    try {
      setMissingErr(null);
      setMissingLoading(true);
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
        2,
        "0"
      )}`;
      const res = await api.get("/attendance/missing-out", {
        params: { scope: "all", month: ym },
      });
      const payload = res.data || {};
      let issues: MissingIssue[] = [];
      if (Array.isArray(payload.issues)) {
        issues = (payload.issues as any[])
          .map((issue) => {
            const date = typeof issue?.date === "string" ? issue.date : null;
            if (!date) return null;
            const type: MissingIssue["type"] =
              issue?.type === "autoPunch" || issue?.type === "noAttendance"
                ? issue.type
                : "missingPunchOut";
            const normalized: MissingIssue = {
              date,
              type,
              autoPunchOutAt:
                typeof issue?.autoPunchOutAt === "string"
                  ? issue.autoPunchOutAt
                  : undefined,
            };
            return normalized;
          })
          .filter(Boolean) as MissingIssue[];
      } else if (Array.isArray(payload.days)) {
        issues = (payload.days as string[]).map((date) => ({
          date,
          type: "missingPunchOut",
        }));
      }
      setMissingIssues(issues);
    } catch (e: any) {
      setMissingErr(
        e?.response?.data?.error || "Failed to load attendance issues"
      );
    } finally {
      setMissingLoading(false);
    }
  }

  async function requestManualAttendance(dateKey: string) {
    if (requestingManual) return;
    try {
      setMissingErr(null);
      setRequestingManual(dateKey);
      await api.post("/attendance/manual-request", { date: dateKey });
      await loadMissingOut();
      setShowMissing(false);
    } catch (e: any) {
      setMissingErr(
        e?.response?.data?.error ||
          "Failed to notify admin for manual attendance entry"
      );
    } finally {
      setRequestingManual(null);
    }
  }

  const todayKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);
  const blockingIssues = useMemo(
    () => missingIssues.filter((issue) => issue.date !== todayKey),
    [missingIssues, todayKey]
  );
  const hasBlockingIssues = blockingIssues.length > 0;

  function updateLogState(
    context: "today" | "backfill",
    logId: string,
    patch: Partial<WorkedLog>
  ) {
    const setter = context === "today" ? setTodayLogs : setBackfillLogs;
    setter((prev) =>
      prev.map((log) =>
        log.logId === logId
          ? {
              ...log,
              ...patch,
            }
          : log
      )
    );
  }

  async function loadTodayTaskData() {
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
        minutes: "",
      }));
      setAssigned(normalized);
      setAssignedStatusView("ACTIVE");

      const tasksToday: {
        tasks: {
          _id: string;
          title: string;
          minutes: number;
          project?: { _id: string; title: string } | null;
          logs?: {
            _id: string;
            minutes: number;
            note?: string;
            createdAt?: string;
          }[];
        }[];
      } = workedRes.data || { tasks: [] };

      setWorkedTasksToday(
        (tasksToday.tasks || []).map((t) => ({
          taskId: t._id,
          minutes: t.minutes || 0,
        }))
      );

      setTodayLogs(
        (tasksToday.tasks || []).flatMap((t) => {
          const projectId = t.project?._id || "";
          const projectTitle = t.project?.title || "";
          return (t.logs || []).map((log) => ({
            logId: log._id,
            taskId: t._id,
            taskTitle: t.title,
            projectId,
            projectTitle,
            minutes: log.minutes || 0,
            note: log.note || "",
            createdAt: log.createdAt,
            isEditing: false,
            editingMinutes: String(log.minutes || 0),
            editingNote: log.note || "",
            saving: false,
            error: null,
          }));
        })
      );

      const now = new Date();
      setWorkedToday({
        minutes: Math.round(elapsed / 60000),
        dateKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(now.getDate()).padStart(2, "0")}`,
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

  async function loadBackfillData(dateKey: string) {
    try {
      setBackfillErr(null);
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
        minutes: "",
      }));
      setAssigned(normalized);
      setAssignedStatusView("ACTIVE");

      const tasksDay: {
        tasks: {
          _id: string;
          title: string;
          minutes: number;
          project?: { _id: string; title: string } | null;
          logs?: {
            _id: string;
            minutes: number;
            note?: string;
            createdAt?: string;
          }[];
        }[];
      } = workedRes.data || { tasks: [] };

      setWorkedTasksForDay(
        (tasksDay.tasks || []).map((t) => ({
          taskId: t._id,
          minutes: t.minutes || 0,
        }))
      );

      setBackfillLogs(
        (tasksDay.tasks || []).flatMap((t) => {
          const projectId = t.project?._id || "";
          const projectTitle = t.project?.title || "";
          return (t.logs || []).map((log) => ({
            logId: log._id,
            taskId: t._id,
            taskTitle: t.title,
            projectId,
            projectTitle,
            minutes: log.minutes || 0,
            note: log.note || "",
            createdAt: log.createdAt,
            isEditing: false,
            editingMinutes: String(log.minutes || 0),
            editingNote: log.note || "",
            saving: false,
            error: null,
          }));
        })
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

  async function openPunchOutModal() {
    if (pending) return;
    setPunchOutErr(null);
    setShowPunchOut(true);
    await loadTodayTaskData();
  }

  async function openBackfillModal(dateKey: string) {
    if (pending) return;
    setBackfillErr(null);
    setBackfillDate(dateKey);
    setShowBackfill(true);
    setBackfillOutTime("");
    setBackfillAttendance(null);
    await loadBackfillData(dateKey);
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
      setAssigned((prev) => {
        if (prev.some((x) => x._id === a._id)) {
          return prev.map((x) => (x._id === a._id ? { ...x, ...a } : x));
        }
        return [a, ...prev];
      });
      if (t.status === "DONE") {
        setAssignedStatusView("DONE");
      }
      setNewTaskTitle("");
      setNewTaskStatus("PENDING");
    } catch (e: any) {
      setPunchOutErr(e?.response?.data?.error || "Failed to add task");
    } finally {
      setAddingTask(false);
    }
  }

  function startLogEdit(context: "today" | "backfill", logId: string) {
    updateLogState(context, logId, {
      isEditing: true,
      editingMinutes: undefined,
      editingNote: undefined,
      error: null,
    });
    const logs = context === "today" ? todayLogs : backfillLogs;
    const current = logs.find((l) => l.logId === logId);
    if (current) {
      updateLogState(context, logId, {
        editingMinutes: String(current.minutes || 0),
        editingNote: current.note || "",
      });
    }
  }

  function cancelLogEdit(context: "today" | "backfill", logId: string) {
    const logs = context === "today" ? todayLogs : backfillLogs;
    const current = logs.find((l) => l.logId === logId);
    updateLogState(context, logId, {
      isEditing: false,
      editingMinutes: current ? String(current.minutes || 0) : "",
      editingNote: current?.note || "",
      error: null,
      saving: false,
    });
  }

  function onLogFieldChange(
    context: "today" | "backfill",
    logId: string,
    field: "minutes" | "note",
    value: string
  ) {
    updateLogState(context, logId, {
      [field === "minutes" ? "editingMinutes" : "editingNote"]: value,
    });
  }

  async function saveLog(context: "today" | "backfill", logId: string) {
    const logs = context === "today" ? todayLogs : backfillLogs;
    const log = logs.find((l) => l.logId === logId);
    if (!log) return;
    const minutes = parseInt(log.editingMinutes || "0", 10);
    if (!minutes || !Number.isFinite(minutes) || minutes <= 0) {
      updateLogState(context, logId, {
        error: "Minutes must be greater than zero",
      });
      return;
    }
    updateLogState(context, logId, { saving: true, error: null });
    try {
      await api.put(
        `/projects/${log.projectId}/tasks/${log.taskId}/time-log/${log.logId}`,
        {
          minutes,
          note: log.editingNote?.trim() ? log.editingNote : undefined,
        }
      );
      toast.success("Time log updated");
      if (context === "today") {
        await loadTodayTaskData();
      } else if (backfillDate) {
        await loadBackfillData(backfillDate);
      }
      await loadMissingOut();
    } catch (e: any) {
      updateLogState(context, logId, {
        saving: false,
        error: e?.response?.data?.error || "Failed to update time log",
      });
    }
  }

  async function deleteLog(context: "today" | "backfill", logId: string) {
    const logs = context === "today" ? todayLogs : backfillLogs;
    const log = logs.find((l) => l.logId === logId);
    if (!log) return;
    updateLogState(context, logId, { saving: true, error: null });
    try {
      await api.delete(
        `/projects/${log.projectId}/tasks/${log.taskId}/time-log/${log.logId}`
      );
      toast.success("Time log removed");
      if (context === "today") {
        await loadTodayTaskData();
      } else if (backfillDate) {
        await loadBackfillData(backfillDate);
      }
      await loadMissingOut();
    } catch (e: any) {
      updateLogState(context, logId, {
        saving: false,
        error: e?.response?.data?.error || "Failed to delete time log",
      });
    }
  }

  function renderLogList(context: "today" | "backfill") {
    const logs = context === "today" ? todayLogs : backfillLogs;
    if (!logs.length) return null;
    return (
      <div className="rounded border border-border p-3 bg-white">
        <div className="mb-2 text-sm font-medium">Existing logs</div>
        <ul className="space-y-2 max-h-64 overflow-auto pr-1">
          {logs.map((log) => (
            <li
              key={log.logId}
              className="border border-border rounded px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{log.taskTitle}</div>
                  <div className="text-xs text-muted">
                    {log.projectTitle || ""}
                  </div>
                </div>
                {log.createdAt && (
                  <span className="text-xs text-muted">
                    {new Date(log.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
              {log.isEditing ? (
                <div className="mt-2 space-y-2">
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-muted">Minutes</span>
                    <input
                      type="number"
                      min={1}
                      className="h-8 w-24 rounded-md border border-border bg-surface px-2"
                      value={log.editingMinutes || ""}
                      onChange={(e) =>
                        onLogFieldChange(
                          context,
                          log.logId,
                          "minutes",
                          e.target.value
                        )
                      }
                      disabled={log.saving}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted">Note (optional)</span>
                    <textarea
                      className="min-h-[60px] rounded-md border border-border bg-surface px-2 py-1"
                      value={log.editingNote || ""}
                      onChange={(e) =>
                        onLogFieldChange(
                          context,
                          log.logId,
                          "note",
                          e.target.value
                        )
                      }
                      disabled={log.saving}
                    />
                  </label>
                </div>
              ) : (
                <div className="mt-2 text-sm">
                  <span className="font-medium">
                    {formatMinutesLabel(log.minutes)}
                  </span>
                  {log.note && (
                    <div className="mt-1 text-xs text-muted">{log.note}</div>
                  )}
                </div>
              )}
              {log.error && (
                <div className="mt-2 text-xs text-error">{log.error}</div>
              )}
              <div className="mt-3 flex items-center gap-2 text-xs">
                {log.isEditing ? (
                  <>
                    <button
                      className="rounded-md bg-secondary px-3 py-1 text-white disabled:opacity-60"
                      onClick={() => saveLog(context, log.logId)}
                      disabled={log.saving}
                    >
                      {log.saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      className="rounded-md border border-border px-3 py-1"
                      onClick={() => cancelLogEdit(context, log.logId)}
                      disabled={log.saving}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="rounded-md border border-border px-3 py-1"
                      onClick={() => startLogEdit(context, log.logId)}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-md border border-error/40 bg-error/10 px-3 py-1 text-error disabled:opacity-60"
                      onClick={() => deleteLog(context, log.logId)}
                      disabled={log.saving}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  function openLeaveModal(dateKey: string) {
    setLeaveModal({
      open: true,
      date: dateKey,
      startDate: dateKey,
      endDate: dateKey,
      type: "PAID",
      reason: "",
      saving: false,
      error: null,
    });
  }

  function closeLeaveModal() {
    setLeaveModal((prev) => ({
      ...prev,
      open: false,
      saving: false,
      error: null,
    }));
  }

  async function submitLeave() {
    if (!leaveModal.date || !leaveModal.startDate) return;
    const startDate = leaveModal.startDate;
    const endDate = leaveModal.endDate || leaveModal.startDate;
    if (new Date(startDate) > new Date(endDate)) {
      setLeaveModal((prev) => ({
        ...prev,
        error: "End date must be on or after start date",
      }));
      return;
    }
    try {
      setLeaveModal((prev) => ({ ...prev, saving: true, error: null }));
      await api.post("/attendance/resolve/leave", {
        date: startDate,
        endDate,
        type: leaveModal.type,
        reason: leaveModal.reason?.trim() || undefined,
      });
      toast.success("Leave applied successfully");
      closeLeaveModal();
      setShowMissing(false);
      await loadMissingOut();
    } catch (e: any) {
      setLeaveModal((prev) => ({
        ...prev,
        saving: false,
        error: e?.response?.data?.error || "Failed to apply leave",
      }));
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
        (acc, t) => acc + computeMinutes({ hours: t.hours, minutes: t.minutes }),
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
      // For each selected task, log time if any minutes > 0
      for (const t of selected) {
        const minutes = computeMinutes({ hours: t.hours, minutes: t.minutes });
        if (!minutes || minutes <= 0) continue; // skip empty entries
        await api.post(`/projects/${t.projectId}/tasks/${t._id}/time`, {
          minutes,
        });
      }
      // Finally punch out
      const ok = await punch("out");
      if (ok) {
        setShowPunchOut(false);
      } else {
        setPunchOutErr("Failed to punch out. Please try again.");
      }
    } catch (e: any) {
      setPunchOutErr(
        e?.response?.data?.error || "Failed to punch out with tasks"
      );
    } finally {
      setSubmittingPunchOut(false);
    }
  }

  async function skipPunchOutWithoutTasks() {
    if (submittingPunchOut) return;
    setPunchOutErr(null);
    try {
      setSubmittingPunchOut(true);
      const ok = await punch("out");
      if (ok) {
        setShowPunchOut(false);
      } else {
        setPunchOutErr("Failed to punch out. Please try again.");
      }
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
        (acc, t) => acc + computeMinutes({ hours: t.hours, minutes: t.minutes }),
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
        const minutes = computeMinutes({ hours: t.hours, minutes: t.minutes });
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

  // While punched-in, periodically refresh attendance so UI stops the timer
  // when backend auto punch-out (or manual punch-out elsewhere) occurs.
  useEffect(() => {
    // clear any previous interval
    if (refreshRef.current) {
      clearInterval(refreshRef.current);
      refreshRef.current = null;
    }
    const isPunchedIn = Boolean(
      attendance?.lastPunchIn && !attendance?.lastPunchOut
    );
    if (isPunchedIn) {
      refreshRef.current = window.setInterval(() => {
        // fire-and-forget; errors handled inside load()
        load();
      }, 30_000); // 30s
    }
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [attendance?.lastPunchIn, attendance?.lastPunchOut]);

  // On day rollover, refresh once shortly after midnight to pick up new day.
  useEffect(() => {
    if (midnightRef.current) {
      clearTimeout(midnightRef.current);
      midnightRef.current = null;
    }
    const now = new Date();
    const next = new Date(now);
    next.setDate(now.getDate() + 1);
    next.setHours(0, 0, 10, 0); // 00:00:10 local time
    const delay = Math.max(1000, next.getTime() - now.getTime());
    midnightRef.current = window.setTimeout(() => {
      load();
      // also refresh missing punch-outs list
      loadMissingOut();
    }, delay);
    return () => {
      if (midnightRef.current) clearTimeout(midnightRef.current);
    };
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
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
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
            {(() => {
              const location =
                attendance?.lastPunchInLocation ||
                attendance?.firstPunchInLocation;
              if (!location) return null;
              return (
                <div className="mt-2 text-xs text-muted">
                  Last punched in from {location}
                </div>
              );
            })()}
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
                {hasBlockingIssues && (
                  <button
                    className="rounded-md border border-border px-3 py-2 text-sm"
                    onClick={() => setShowMissing(true)}
                    title="Resolve attendance issues to enable Punch In"
                  >
                    {`Resolve Attendance Issues (${blockingIssues.length})`}
                  </button>
                )}
                <button
                  className="rounded-md bg-secondary px-4 py-2 text-white disabled:opacity-60"
                  onClick={() => punch("in")}
                  disabled={pending === "in" || hasBlockingIssues}
                  title={
                    hasBlockingIssues
                      ? "Resolve pending attendance issues before punching in."
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
          <div className="mt-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
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
            <div className="mb-2 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
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
              <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                {punchOutErr}
              </div>
            )}
            <div className="text-xs text-muted mb-3">
              {workedToday ? (
                <>
                  Total today: {formatMinutesLabel(Math.round(elapsed / 60000))}{" "}
                  • Logged:{" "}
                  {formatMinutesLabel(
                    workedTasksToday.reduce((a, b) => a + b.minutes, 0)
                  )}{" "}
                  • Remaining: {formatMinutesLabel(remainingMinutes)}
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

            {renderLogList("today")}

            {/* Assigned tasks list */}
            {assignedErr && (
              <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                {assignedErr}
              </div>
            )}
            {assignedLoading ? (
              <div className="text-sm text-muted">Loading tasks…</div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">Assigned tasks</div>
                  <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
                    <button
                      type="button"
                      className={`px-3 py-1 font-medium transition-colors ${
                        assignedStatusView === "ACTIVE"
                          ? "bg-secondary text-white"
                          : "bg-surface text-muted"
                      }`}
                      onClick={() => setAssignedStatusView("ACTIVE")}
                      aria-pressed={assignedStatusView === "ACTIVE"}
                    >
                      Active
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-1 font-medium border-l border-border transition-colors ${
                        assignedStatusView === "DONE"
                          ? "bg-secondary text-white"
                          : "bg-surface text-muted"
                      }`}
                      onClick={() => setAssignedStatusView("DONE")}
                      aria-pressed={assignedStatusView === "DONE"}
                    >
                      Done
                    </button>
                  </div>
                </div>
                <div className="max-h-80 overflow-auto pr-1">
                  {assigned.length === 0 ? (
                    <div className="text-sm text-muted">No assigned tasks.</div>
                  ) : filteredAssigned.length === 0 ? (
                    <div className="text-sm text-muted">
                      {assignedStatusView === "DONE"
                        ? "No tasks marked done."
                        : "No active tasks."}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {Array.from(
                        filteredAssigned.reduce(
                          (map, t) => {
                            const key = t.projectId || "misc";
                            if (!map.has(key))
                              map.set(key, {
                                title: t.projectTitle || "(No project)",
                                items: [] as Assigned[],
                              });
                            map.get(key)!.items.push(t);
                            return map;
                          },
                          new Map<string, { title: string; items: Assigned[] }>()
                        )
                      ).map(([pid, group]) => (
                        <div key={pid}>
                          <div className="text-sm font-medium mb-1">
                            {group.title}
                          </div>
                          <ul className="space-y-2">
                            {group.items.map((t) => {
                              const badge = statusBadge(t.status);
                              const hoursVal = parseFloat(t.hours || "0");
                              const canAdd =
                                Number.isFinite(hoursVal) && hoursVal > 0;
                              const isSelected = !!t.checked;
                              const addDisabled = !isSelected && !canAdd;
                              const addTitle = addDisabled
                                ? "Enter hours before adding"
                                : isSelected
                                ? "Remove from submission"
                                : "Add to submission";
                              return (
                                <li
                                  key={t._id}
                                  className="border border-border rounded px-3 py-2"
                                >
                                  <div className="flex flex-wrap items-center gap-3">
                                    <div className="flex-1 min-w-[200px]">
                                      <div className="text-sm font-medium">
                                        {t.title}
                                      </div>
                                      {t.projectTitle && (
                                        <div className="text-xs text-muted">
                                          {t.projectTitle}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="number"
                                        step="0.25"
                                        min="0"
                                        className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-sm"
                                        placeholder="Hours"
                                        value={t.hours || ""}
                                        onChange={(e) =>
                                          setAssigned((prev) =>
                                            prev.map((x) =>
                                              x._id === t._id
                                                ? {
                                                    ...x,
                                                    hours: e.target.value,
                                                    minutes: "",
                                                  }
                                                : x
                                            )
                                          )
                                        }
                                      />
                                    </div>
                                    <span
                                      className={`text-xs px-2 py-0.5 rounded border ${badge.className}`}
                                    >
                                      {badge.label}
                                    </span>
                                    <button
                                      type="button"
                                      className={`h-8 px-3 rounded-md text-xs font-medium transition-colors ${
                                        isSelected
                                          ? "bg-green-600 text-white hover:bg-green-700"
                                          : "bg-secondary text-white hover:opacity-90"
                                      } disabled:opacity-50`}
                                      onClick={() =>
                                        setAssigned((prev) =>
                                          prev.map((x) =>
                                            x._id === t._id
                                              ? {
                                                  ...x,
                                                  checked: !isSelected,
                                                }
                                              : x
                                          )
                                        )
                                      }
                                      disabled={addDisabled}
                                      title={addTitle}
                                    >
                                      {isSelected ? "Added" : "Add"}
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
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
                  className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-60"
                  onClick={skipPunchOutWithoutTasks}
                  disabled={submittingPunchOut}
                  title="Punch out without logging tasks"
                >
                  {submittingPunchOut ? "Processing…" : "Skip & Punch Out"}
                </button>
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
              <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
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
                  {(() => {
                    const worked = Math.max(
                      0,
                      Math.floor((backfillAttendance.workedMs || 0) / 60000)
                    );
                    const already = workedTasksForDay.reduce(
                      (acc, t) => acc + (t.minutes || 0),
                      0
                    );
                    const cap = Math.max(0, worked - 60);
                    const remaining = Math.max(0, cap - already);
                    return (
                      <>
                        Total worked: {formatMinutesLabel(worked)} • Logged:{" "}
                        {formatMinutesLabel(already)} • Remaining:{" "}
                        {formatMinutesLabel(remaining)}
                      </>
                    );
                  })()}
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
                {renderLogList("backfill")}

                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">Assigned tasks</div>
                  <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
                    <button
                      type="button"
                      className={`px-3 py-1 font-medium transition-colors ${
                        assignedStatusView === "ACTIVE"
                          ? "bg-secondary text-white"
                          : "bg-surface text-muted"
                      }`}
                      onClick={() => setAssignedStatusView("ACTIVE")}
                      aria-pressed={assignedStatusView === "ACTIVE"}
                    >
                      Active
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-1 font-medium border-l border-border transition-colors ${
                        assignedStatusView === "DONE"
                          ? "bg-secondary text-white"
                          : "bg-surface text-muted"
                      }`}
                      onClick={() => setAssignedStatusView("DONE")}
                      aria-pressed={assignedStatusView === "DONE"}
                    >
                      Done
                    </button>
                  </div>
                </div>
                {assigned.length === 0 ? (
                  <div className="text-sm text-muted">No assigned tasks.</div>
                ) : filteredAssigned.length === 0 ? (
                  <div className="text-sm text-muted">
                    {assignedStatusView === "DONE"
                      ? "No tasks marked done."
                      : "No active tasks."}
                  </div>
                ) : (
                  <ul className="space-y-2 max-h-72 overflow-auto pr-1">
                    {filteredAssigned.map((t) => {
                      const badge = statusBadge(t.status);
                      const hoursVal = parseFloat(t.hours || "0");
                      const canAdd = Number.isFinite(hoursVal) && hoursVal > 0;
                      const isSelected = !!t.checked;
                      const addDisabled =
                        !backfillAttendance || (!isSelected && !canAdd);
                      const addTitle = !backfillAttendance
                        ? "Set punch-out time first"
                        : addDisabled
                        ? "Enter hours before adding"
                        : isSelected
                        ? "Remove from submission"
                        : "Add to submission";
                      return (
                        <li
                          key={t._id}
                          className="border border-border rounded px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="flex-1 min-w-[200px]">
                              <div className="text-sm font-medium">{t.title}</div>
                              {t.projectTitle && (
                                <div className="text-xs text-muted">
                                  {t.projectTitle}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                step="0.25"
                                min="0"
                                className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-sm"
                                placeholder="Hours"
                                value={t.hours || ""}
                                onChange={(e) =>
                                  setAssigned((prev) =>
                                    prev.map((x) =>
                                      x._id === t._id
                                        ? {
                                            ...x,
                                            hours: e.target.value,
                                            minutes: "",
                                          }
                                        : x
                                    )
                                  )
                                }
                                disabled={!backfillAttendance}
                              />
                            </div>
                            <span
                              className={`text-xs px-2 py-0.5 rounded border ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            <button
                              type="button"
                              className={`h-8 px-3 rounded-md text-xs font-medium transition-colors ${
                                isSelected
                                  ? "bg-green-600 text-white hover:bg-green-700"
                                  : "bg-secondary text-white hover:opacity-90"
                              } disabled:opacity-50`}
                              onClick={() =>
                                setAssigned((prev) =>
                                  prev.map((x) =>
                                    x._id === t._id
                                      ? { ...x, checked: !isSelected }
                                      : x
                                  )
                                )
                              }
                              disabled={addDisabled}
                              title={addTitle}
                            >
                              {isSelected ? "Added" : "Add"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
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
              <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
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
                Resolve Attendance Issues
              </h4>
              <button
                className="text-sm underline"
                onClick={() => setShowMissing(false)}
              >
                Close
              </button>
            </div>
            <div className="text-sm text-muted mb-3">
              You must resolve past working days with incomplete attendance
              before punching in again.
            </div>
            {missingLoading ? (
              <div className="text-sm text-muted">Loading…</div>
            ) : missingErr ? (
              <div className="text-sm text-error">{missingErr}</div>
            ) : blockingIssues.length === 0 ? (
              <div className="text-sm">No unresolved days. You're all set!</div>
            ) : (
              <ul className="space-y-2 max-h-80 overflow-auto pr-1">
                {blockingIssues.map((issue) => (
                  <li
                    key={issue.date}
                    className="flex flex-col gap-2 border border-border rounded px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col gap-1 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full border border-border text-xs">
                            {fmtDateKey(issue.date)}
                          </span>
                          <span className="font-medium">
                            {describeIssue(issue)}
                          </span>
                        </div>
                        {renderIssueHint(issue)}
                      </div>
                      <div className="flex items-center gap-2">
                        {issue.type === "noAttendance" ? (
                          <>
                            <button
                              className="rounded-md border border-border px-3 py-1 text-sm"
                              onClick={() => openLeaveModal(issue.date)}
                            >
                              Apply Leave
                            </button>
                            <button
                              className="rounded-md bg-secondary px-3 py-1 text-sm text-white disabled:opacity-60"
                              onClick={() =>
                                requestManualAttendance(issue.date)
                              }
                              disabled={requestingManual === issue.date}
                            >
                              {requestingManual === issue.date
                                ? "Requesting…"
                                : "Notify Admin"}
                            </button>
                          </>
                        ) : (
                          <button
                            className="rounded-md border border-border px-3 py-1 text-sm"
                            onClick={() => {
                              setShowMissing(false);
                              openBackfillModal(issue.date);
                            }}
                          >
                            {issue.type === "autoPunch"
                              ? "Fix punch-out"
                              : "Log tasks"}
                          </button>
                        )}
                      </div>
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

      {leaveModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => (!leaveModal.saving ? closeLeaveModal() : null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">Apply Leave</h4>
              <button
                className="text-sm underline"
                onClick={() => (!leaveModal.saving ? closeLeaveModal() : null)}
                disabled={leaveModal.saving}
              >
                Close
              </button>
            </div>
            <div className="text-sm text-muted mb-3">
              Mark the selected day as leave. This will bypass approval and
              close the attendance issue.
            </div>
            {leaveModal.error && (
              <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                {leaveModal.error}
              </div>
            )}
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="w-28 text-muted">Start date</span>
                <input
                  type="date"
                  className="h-9 rounded-md border border-border bg-surface px-2"
                  value={leaveModal.startDate}
                  onChange={(e) =>
                    setLeaveModal((prev) => ({
                      ...prev,
                      startDate: e.target.value,
                    }))
                  }
                  disabled={leaveModal.saving}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="w-28 text-muted">End date</span>
                <input
                  type="date"
                  className="h-9 rounded-md border border-border bg-surface px-2"
                  value={leaveModal.endDate}
                  onChange={(e) =>
                    setLeaveModal((prev) => ({
                      ...prev,
                      endDate: e.target.value,
                    }))
                  }
                  disabled={leaveModal.saving}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="w-28 text-muted">Type</span>
                <select
                  className="h-9 rounded-md border border-border bg-surface px-2"
                  value={leaveModal.type}
                  onChange={(e) =>
                    setLeaveModal((prev) => ({
                      ...prev,
                      type: e.target.value,
                    }))
                  }
                  disabled={leaveModal.saving}
                >
                  <option value="PAID">Paid</option>
                  <option value="CASUAL">Casual</option>
                  <option value="SICK">Sick</option>
                  <option value="UNPAID">Unpaid</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Reason (optional)</span>
                <textarea
                  className="min-h-[80px] rounded-md border border-border bg-surface px-2 py-1"
                  value={leaveModal.reason}
                  onChange={(e) =>
                    setLeaveModal((prev) => ({
                      ...prev,
                      reason: e.target.value,
                    }))
                  }
                  disabled={leaveModal.saving}
                />
              </label>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={closeLeaveModal}
                disabled={leaveModal.saving}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-secondary px-4 py-2 text-white disabled:opacity-60"
                onClick={submitLeave}
                disabled={leaveModal.saving}
              >
                {leaveModal.saving ? "Applying…" : "Apply Leave"}
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
  const [runLoading, setRunLoading] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{
    candidates: number;
    closed: number;
  } | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
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
    console.log("djsgh", leaveMap);
  }, []);

  return (
    <div className="p-4 rounded-lg border border-border bg-surface shadow-sm">
      <div className="mb-4 font-semibold">HR Panel</div>
      {err && (
        <div className="mb-4 rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}
      {runErr && (
        <div className="mb-4 rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {runErr}
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
