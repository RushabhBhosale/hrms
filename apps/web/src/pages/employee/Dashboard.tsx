import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { api } from "../../lib/api";
import { formatMinutesLabel } from "../../lib/time";
import { resolveLocationLabel } from "../../lib/location";
import RoleGuard from "../../components/RoleGuard";
import { Edit, Trash, Users, Eye } from "lucide-react";
import { Button } from "../../components/ui/button";
import ConfirmDialog from "../../components/utils/ConfirmDialog";

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
  const [locationPrompt, setLocationPrompt] = useState<{
    open: boolean;
    permission: "granted" | "denied" | "prompt" | "unavailable";
    action: "in" | "out";
  }>({ open: false, permission: "prompt", action: "in" });
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
  const punchedIn = Boolean(
    attendance?.lastPunchIn && !attendance?.lastPunchOut,
  );

  const dateKeyLocal = (d: Date | string) => {
    const x = new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const day = String(x.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

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
        <div className="text-xs text-muted-foreground">
          {time
            ? `System closed the day at ${time}. Confirm the actual punch-out time.`
            : "System closed the day automatically. Confirm the actual punch-out time."}
        </div>
      );
    }
    if (issue.type === "noAttendance") {
      return (
        <div className="text-xs text-muted-foreground">
          Apply leave or notify an admin to record the punches for that day.
        </div>
      );
    }
    return (
      <div className="text-xs text-muted-foreground">
        Set the punch-out time and log the tasks you worked on.
      </div>
    );
  }

  function renderLocationHint(permission: string) {
    if (permission === "denied") {
      return "Location access is blocked for this site. Allow location in your browser settings, then try Punch In again.";
    }
    if (permission === "unavailable") {
      return "We couldn’t read your location. Turn on device location services, allow the browser, then try Punch In again.";
    }
    return "Turn on location permission in your browser to punch in, then retry.";
  }

  function getTimezonePayload() {
    const offset = -new Date().getTimezoneOffset();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone
      ? { timezoneOffsetMinutes: offset, timezone: zone }
      : { timezoneOffsetMinutes: offset };
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
    parentTask?: string | null;
    updatedAt?: string;
    isMeetingDefault?: boolean;
  };
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksErr, setTasksErr] = useState<string | null>(null);

  // Punch-out / log modal state
  const [showPunchOut, setShowPunchOut] = useState(false);
  const [punchModalMode, setPunchModalMode] = useState<"punch" | "log">(
    "punch",
  );
  type Assigned = Task & {
    projectId: string;
    projectTitle: string;
    hours?: string; // user input hours, e.g. 1.5
    minutes?: string; // user input minutes, e.g. 30
    note?: string;
  };
  const [assigned, setAssigned] = useState<Assigned[]>([]);
  const [assignedLoading, setAssignedLoading] = useState(false);
  const [assignedErr, setAssignedErr] = useState<string | null>(null);
  const [assignedStatusView, setAssignedStatusView] = useState<
    "ACTIVE" | "DONE"
  >("ACTIVE");
  const filteredAssigned = useMemo(
    () =>
      assigned.filter((t) => {
        const statusOk =
          assignedStatusView === "DONE"
            ? t.status === "DONE"
            : t.status !== "DONE";
        return statusOk;
      }),
    [assigned, assignedStatusView],
  );
  const [logProjectId, setLogProjectId] = useState<string>("");
  const [logMainTaskId, setLogMainTaskId] = useState<string>("");
  const [logSubTaskId, setLogSubTaskId] = useState<string>("");
  const [logNote, setLogNote] = useState("");
  const [logHours, setLogHours] = useState("");
  const [logMinutesInput, setLogMinutesInput] = useState("");
  const [meetingMinutesInput, setMeetingMinutesInput] = useState("");
  const [logEntryMode, setLogEntryMode] = useState<"task" | "meeting">("task");
  const [editingLog, setEditingLog] = useState<{
    context: "today" | "backfill";
    logId: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    context: "today" | "backfill";
    logId: string | null;
    open: boolean;
  }>({ context: "today", logId: null, open: false });
  const logEligibleTasks = useMemo(
    () => assigned.filter((t) => t.status !== "DONE"),
    [assigned],
  );
  const [showTodayLogs, setShowTodayLogs] = useState(true);
  const tasksByProject = useMemo(() => {
    const map = new Map<string, Assigned[]>();
    logEligibleTasks.forEach((t) => {
      const pid = t.projectId || "";
      if (!pid) return;
      const list = map.get(pid) || [];
      list.push(t);
      map.set(pid, list);
    });
    return map;
  }, [logEligibleTasks]);
  const logProjectOptions = useMemo(
    () =>
      Array.from(tasksByProject.entries()).map(([value, tasks]) => ({
        value,
        label: tasks[0]?.projectTitle || "Project",
      })),
    [tasksByProject],
  );
  const mainTaskOptions = useMemo(() => {
    const list = tasksByProject.get(logProjectId) || [];
    const roots = list.filter((t) => !t.parentTask);
    const source = roots.length ? roots : list; // fallback: allow selecting any task if no top-level task exists
    return source.map((t) => ({ value: t._id, label: t.title || "Task" }));
  }, [tasksByProject, logProjectId]);
  const subTaskOptions = useMemo(() => {
    if (!logMainTaskId) return [];
    const list = tasksByProject.get(logProjectId) || [];
    return list
      .filter((t) => String(t.parentTask) === String(logMainTaskId))
      .map((t) => ({ value: t._id, label: t.title || "Task" }));
  }, [tasksByProject, logProjectId, logMainTaskId]);
  const meetingTaskByProject = useMemo(() => {
    const map = new Map<string, Assigned>();
    [...logEligibleTasks, ...assigned].forEach((t) => {
      if (t.isMeetingDefault) map.set(t.projectId, t);
    });
    return map;
  }, [logEligibleTasks, assigned]);
  const selectedTaskForLog = useMemo(() => {
    const targetId = logSubTaskId || logMainTaskId;
    if (!targetId) return null;
    return (
      logEligibleTasks.find((t) => String(t._id) === String(targetId)) || null
    );
  }, [logEligibleTasks, logMainTaskId, logSubTaskId]);
  const selectedMainHasSubtasks = useMemo(() => {
    if (!logMainTaskId) return false;
    const list = tasksByProject.get(logProjectId) || [];
    return list.some((t) => String(t.parentTask) === String(logMainTaskId));
  }, [tasksByProject, logProjectId, logMainTaskId]);
  const selectedMinutes = useMemo(
    () => computeMinutes({ hours: logHours, minutes: logMinutesInput }),
    [logHours, logMinutesInput],
  );
  const hasTaskMinutes = selectedMinutes > 0;
  const meetingMinutes = useMemo(() => {
    const m = parseInt(meetingMinutesInput || "0", 10);
    if (!Number.isFinite(m) || m <= 0) return 0;
    return m;
  }, [meetingMinutesInput]);
  const hasMeetingMinutes = meetingMinutes > 0;
  const hasMeetingProject =
    hasMeetingMinutes &&
    !!logProjectId &&
    meetingTaskByProject.has(logProjectId);
  const hasLogTarget = Boolean(selectedTaskForLog);
  const activeMinutes =
    logEntryMode === "task" ? selectedMinutes : meetingMinutes;
  const canSubmitLog =
    !assignedLoading &&
    (logEntryMode === "task"
      ? hasLogTarget && hasTaskMinutes
      : hasMeetingProject);
  function computeMinutes(entry: { hours?: string; minutes?: string }) {
    const hours = parseFloat(entry.hours || "0");
    const extraMinutes = parseInt(entry.minutes || "0", 10);
    const fromHours = Number.isFinite(hours) ? Math.round(hours * 60) : 0;
    const fromMinutes = Number.isFinite(extraMinutes) ? extraMinutes : 0;
    return Math.max(0, fromHours + fromMinutes);
  }
  function changeLogEntryMode(next: "task" | "meeting") {
    if (next === logEntryMode) return;
    setPunchOutErr(null);
    setEditingLog(null);
    if (next === "meeting") {
      setLogHours("");
      setLogMinutesInput("");
      setLogNote("");
      setLogMainTaskId("");
      setLogSubTaskId("");
      if (!logProjectId) {
        const first = logProjectOptions[0]?.value;
        if (first) setLogProjectId(first);
      }
    } else {
      setMeetingMinutesInput("");
    }
    setLogEntryMode(next);
  }

  function changeBackfillEntryMode(next: "task" | "meeting") {
    if (next === backfillEntryMode) return;
    setBackfillErr(null);
    if (next === "meeting") {
      setAssigned((prev) =>
        prev.map((t) => ({
          ...t,
          hours: "",
          minutes: "",
        })),
      );
      if (!backfillMeetingProjectId && meetingProjectOptions.length) {
        setBackfillMeetingProjectId(meetingProjectOptions[0].value);
      }
    } else {
      setBackfillMeetingMinutes("");
    }
    setBackfillEntryMode(next);
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
  const [logOnlySubmitting, setLogOnlySubmitting] = useState(false);
  const [submittingPunchOut, setSubmittingPunchOut] = useState(false);
  const [punchOutErr, setPunchOutErr] = useState<string | null>(null);
  const hasExistingLogsToday =
    todayLogs.length > 0 || workedTasksToday.length > 0;
  const [backfillMeetingProjectId, setBackfillMeetingProjectId] =
    useState<string>("");
  const [backfillMeetingMinutes, setBackfillMeetingMinutes] = useState("");
  const [backfillLogs, setBackfillLogs] = useState<WorkedLog[]>([]);
  const canSubmitPunchOut = canSubmitLog || hasExistingLogsToday;
  const meetingProjectOptions = useMemo(
    () =>
      Array.from(
        new Map(
          assigned
            .filter((t) => t.isMeetingDefault)
            .map((t) => [t.projectId, t.projectTitle || "Project"]),
        ).entries(),
      ).map(([value, label]) => ({ value, label })),
    [assigned],
  );
  const backfillMeetingMinutesValue = useMemo(() => {
    const m = parseInt(backfillMeetingMinutes || "0", 10);
    return Number.isFinite(m) && m > 0 ? m : 0;
  }, [backfillMeetingMinutes]);
  useEffect(() => {
    if (!backfillMeetingProjectId && meetingProjectOptions.length) {
      setBackfillMeetingProjectId(meetingProjectOptions[0].value);
    }
  }, [backfillMeetingProjectId, meetingProjectOptions]);

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
    lastPunchIn?: string;
    lastPunchOut?: string;
    workedMs?: number;
  } | null>(null);
  const [backfillEntryMode, setBackfillEntryMode] = useState<
    "task" | "meeting"
  >("task");

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
      0,
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

  async function punch(
    action: "in" | "out",
    options?: { triggerDailyStatusEmail?: boolean },
  ) {
    if (pending) return false;
    let success = false;
    try {
      setPending(action);
      let locationLabel: string | null = null;
      const loc = await resolveLocationLabel({ requestPermission: false });
      if (loc.permission === "granted" && loc.label) {
        locationLabel = loc.label;
      }
      await api.post("/attendance/punch", {
        action,
        ...(locationLabel ? { location: locationLabel } : {}),
        ...(options?.triggerDailyStatusEmail
          ? { triggerDailyStatusEmail: true }
          : {}),
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
          }. Select Resolve Attendance Issues to continue.`,
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
        "0",
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
        e?.response?.data?.error || "Failed to load attendance issues",
      );
    } finally {
      setMissingLoading(false);
    }
  }

  const todayKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);
  const blockingIssues = useMemo(
    () => missingIssues.filter((issue) => issue.date !== todayKey),
    [missingIssues, todayKey],
  );
  const hasBlockingIssues = blockingIssues.length > 0;

  function updateLogState(
    context: "today" | "backfill",
    logId: string,
    patch: Partial<WorkedLog>,
  ) {
    const setter = context === "today" ? setTodayLogs : setBackfillLogs;
    setter((prev) =>
      prev.map((log) =>
        log.logId === logId
          ? {
              ...log,
              ...patch,
            }
          : log,
      ),
    );
  }

  async function loadTodayTaskData() {
    try {
      setAssignedErr(null);
      setAssignedLoading(true);
      const [assignedRes, workedRes] = await Promise.all([
        api.get("/projects/tasks/assigned"),
        api.get("/projects/tasks/worked"),
      ]);
      const list: Task[] = assignedRes.data.tasks || [];
      const normalized: Assigned[] = list.map((t) => ({
        ...t,
        parentTask: t.parentTask ? String(t.parentTask) : null,
        projectId:
          typeof t.project === "string"
            ? (t.project as string)
            : (t.project?._id as string),
        projectTitle:
          typeof t.project === "string" ? "" : t.project?.title || "",
        hours: "",
        minutes: "",
        note: "",
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
        })),
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
        }),
      );

      const now = new Date();
      setWorkedToday({
        minutes: Math.round(elapsed / 60000),
        dateKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
          2,
          "0",
        )}-${String(now.getDate()).padStart(2, "0")}`,
      });
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
      const [assignedRes, workedRes] = await Promise.all([
        api.get("/projects/tasks/assigned"),
        api.get("/projects/tasks/worked", { params: { date: dateKey } }),
      ]);
      const list: Task[] = assignedRes.data.tasks || [];
      const normalized: Assigned[] = list.map((t) => ({
        ...t,
        parentTask: t.parentTask ? String(t.parentTask) : null,
        projectId:
          typeof t.project === "string"
            ? (t.project as string)
            : (t.project?._id as string),
        projectTitle:
          typeof t.project === "string" ? "" : t.project?.title || "",
        hours: "",
        minutes: "",
        note: "",
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
        })),
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
        }),
      );
    } catch (e: any) {
      setBackfillErr(e?.response?.data?.error || "Failed to load tasks");
    } finally {
      setBackfillLoading(false);
    }
  }

  async function loadBackfillAttendance(dateKey: string) {
    try {
      const res = await api.get("/attendance/history");
      const records: {
        date?: string;
        firstPunchIn?: string;
        lastPunchIn?: string;
        lastPunchOut?: string;
        workedMs?: number;
      }[] = res.data?.attendance || [];
      const match = records.find(
        (r) => r.date && dateKeyLocal(r.date) === dateKey,
      );
      if (match) {
        setBackfillAttendance((prev) => ({ ...prev, ...match }));
      }
    } catch {
      /* ignore */
    }
  }

  async function openPunchOutModal() {
    if (pending) return;
    setPunchOutErr(null);
    setPunchModalMode("punch");
    setLogEntryMode("task");
    setLogProjectId("");
    setLogMainTaskId("");
    setLogSubTaskId("");
    setLogNote("");
    setLogHours("");
    setLogMinutesInput("");
    setMeetingMinutesInput("");
    setShowPunchOut(true);
    await loadTodayTaskData();
  }

  async function openLogTasksModal() {
    setPunchOutErr(null);
    setPunchModalMode("log");
    setLogEntryMode("task");
    setLogProjectId("");
    setLogMainTaskId("");
    setLogSubTaskId("");
    setLogNote("");
    setLogHours("");
    setLogMinutesInput("");
    setMeetingMinutesInput("");
    setShowPunchOut(true);
    await loadTodayTaskData();
  }

  async function openBackfillModal(dateKey: string) {
    if (pending) return;
    setBackfillErr(null);
    setBackfillDate(dateKey);
    setShowBackfill(true);
    setBackfillEntryMode("task");
    setBackfillOutTime("");
    setBackfillAttendance(null);
    setBackfillMeetingMinutes("");
    setBackfillMeetingProjectId("");
    await Promise.all([loadBackfillData(dateKey), loadBackfillAttendance(dateKey)]);
  }

  function populateLogFormFromLog(log: {
    projectId?: string;
    taskId: string;
    minutes: number;
    note?: string;
  }) {
    setPunchModalMode("log");
    setLogProjectId(log.projectId || "");
    setLogMainTaskId(log.taskId || "");
    setLogSubTaskId("");
    setLogNote(log.note || "");
    const hours = Math.floor((log.minutes || 0) / 60);
    const mins = (log.minutes || 0) % 60;
    setLogHours(hours ? String(hours) : "");
    setLogMinutesInput(mins ? String(mins) : "");
    setMeetingMinutesInput("");
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
      populateLogFormFromLog(current);
      setEditingLog({ context, logId });
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
    setEditingLog((prev) =>
      prev && prev.logId === logId && prev.context === context ? null : prev,
    );
    if (
      editingLog &&
      editingLog.logId === logId &&
      editingLog.context === context
    ) {
      setLogProjectId("");
      setLogMainTaskId("");
      setLogSubTaskId("");
      setLogNote("");
      setLogHours("");
      setLogMinutesInput("");
    }
  }

  function onLogFieldChange(
    context: "today" | "backfill",
    logId: string,
    field: "minutes" | "note",
    value: string,
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
        },
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
        `/projects/${log.projectId}/tasks/${log.taskId}/time-log/${log.logId}`,
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
  function confirmDeleteLog(context: "today" | "backfill", logId: string) {
    setConfirmDelete({ context, logId, open: true });
  }
  async function handleConfirmDelete() {
    if (!confirmDelete.logId) {
      setConfirmDelete((p) => ({ ...p, open: false }));
      return;
    }
    await deleteLog(confirmDelete.context, confirmDelete.logId);
    setConfirmDelete((p) => ({ ...p, open: false, logId: null }));
  }

  function renderLogList(context: "today" | "backfill") {
    const logs = context === "today" ? todayLogs : backfillLogs;
    if (!logs.length) return null;
    return (
      <div className="rounded border border-border p-3 bg-white my-2">
        <div className="mb-2 text-sm font-medium">Existing logs</div>
        <ul className="space-y-2 max-h-64 overflow-auto pr-1">
          {logs.map((log) => (
            <li
              key={log.logId}
              className="border border-border rounded px-3 py-2 text-sm flex justify-between items-center"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{log.taskTitle}</div>
                  <div className="text-xs text-muted-foreground">
                    {log.projectTitle || ""}
                    {log.createdAt && (
                      <span className="text-xs text-muted-foreground ml-4">
                        {new Date(log.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-sm">
                <span className="font-medium">
                  {formatMinutesLabel(log.minutes)}
                </span>
                {log.note && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {log.note}
                  </div>
                )}
                {log.isEditing && (
                  <div className="mt-1 text-[11px] text-secondary font-medium">
                    Editing via form above
                  </div>
                )}
              </div>
              {log.error && (
                <div className="mt-2 text-xs text-error">{log.error}</div>
              )}
              <div className="mt-3 flex items-center gap-2 text-xs">
                <button
                  className="rounded-md border border-border px-3 py-1 disabled:opacity-60"
                  onClick={() => startLogEdit(context, log.logId)}
                  disabled={log.saving || context === "backfill"}
                  title={
                    context === "backfill"
                      ? "Editing via form is disabled in backfill"
                      : "Edit in the form above"
                  }
                >
                  <Edit size={12} />
                </button>
                {log.isEditing && (
                  <button
                    className="rounded-md border border-border px-3 py-1"
                    onClick={() => cancelLogEdit(context, log.logId)}
                    disabled={log.saving}
                  >
                    Clear
                  </button>
                )}
                <button
                  className="rounded-md border border-error/40 bg-error/10 px-3 py-1 text-error disabled:opacity-60"
                  onClick={() => confirmDeleteLog(context, log.logId)}
                  disabled={log.saving}
                >
                  <Trash size={12} color="red" />
                </button>
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

  function buildSelectedEntry() {
    if (!selectedMinutes) return null;
    if (!logEligibleTasks.length) {
      setPunchOutErr("No assigned tasks available to log time.");
      return null;
    }
    if (!logProjectId) {
      setPunchOutErr("Select a project to log time.");
      return null;
    }
    if (!logMainTaskId) {
      setPunchOutErr("Select a main task to log time.");
      return null;
    }
    if (selectedMainHasSubtasks && !logSubTaskId) {
      setPunchOutErr("Select a subtask for this main task.");
      return null;
    }
    const targetTaskId = logSubTaskId || logMainTaskId;
    const task =
      logEligibleTasks.find((t) => String(t._id) === String(targetTaskId)) ||
      null;
    if (!task) {
      setPunchOutErr("Selected task is unavailable.");
      return null;
    }
    const minutes = selectedMinutes;
    const totalMinutes = minutes + meetingMinutes;
    if (minutes <= 0) {
      setPunchOutErr("Enter a positive time value.");
      return null;
    }
    if (totalMinutes > remainingMinutes) {
      setPunchOutErr(
        `You're ${totalMinutes - remainingMinutes} minutes over the limit.`,
      );
      return null;
    }
    return {
      task,
      minutes,
      note: logNote.trim(),
    };
  }

  async function logMeetingForProject(
    projectId: string,
    minutes: number,
    date?: string,
    setError?: (msg: string) => void,
  ) {
    if (!minutes || minutes <= 0) return true;
    const meetingTask = meetingTaskByProject.get(projectId);
    if (!meetingTask) {
      const setter = setError || setPunchOutErr;
      setter("Meeting task is unavailable for the selected project.");
      return false;
    }
    const payload: { minutes: number; note: string; date?: string } = {
      minutes,
      note: "Meetings",
    };
    let url = `/projects/${projectId}/tasks/${meetingTask._id}/time`;
    if (date) {
      url = `/projects/${projectId}/tasks/${meetingTask._id}/time-at`;
      payload.date = date;
    }
    await api.post(url, payload);
    return true;
  }

  async function saveExistingLogFromForm() {
    if (!editingLog) return false;
    const logs = editingLog.context === "today" ? todayLogs : backfillLogs;
    const log = logs.find((l) => l.logId === editingLog.logId);
    if (!log) return false;
    const minutes = selectedMinutes;
    if (!minutes || minutes <= 0) {
      setPunchOutErr("Enter time to update the log.");
      return false;
    }
    const payloadNote = logNote.trim();
    updateLogState(editingLog.context, log.logId, {
      saving: true,
      error: null,
    });
    try {
      await api.put(
        `/projects/${log.projectId}/tasks/${log.taskId}/time-log/${log.logId}`,
        {
          minutes,
          note: payloadNote || undefined,
        },
      );
      toast.success("Time log updated");
      if (editingLog.context === "today") {
        await loadTodayTaskData();
      } else if (backfillDate) {
        await loadBackfillData(backfillDate);
      }
      await loadMissingOut();
      setEditingLog(null);
      setLogProjectId("");
      setLogMainTaskId("");
      setLogSubTaskId("");
      setLogNote("");
      setLogHours("");
      setLogMinutesInput("");
      return true;
    } catch (e: any) {
      updateLogState(editingLog.context, log.logId, {
        saving: false,
        error: e?.response?.data?.error || "Failed to update time log",
      });
      return false;
    }
  }

  async function logTasksOnly() {
    if (logOnlySubmitting || submittingPunchOut) return;
    setPunchOutErr(null);
    if (logEntryMode === "task") {
      if (!hasLogTarget || !hasTaskMinutes) {
        setPunchOutErr("Add time to a task to save logs.");
        return;
      }
    } else {
      if (!hasMeetingProject) {
        setPunchOutErr("Select a project and minutes for the meeting.");
        return;
      }
    }
    if (!editingLog && activeMinutes > remainingMinutes) {
      setPunchOutErr(
        `You're ${activeMinutes - remainingMinutes} minutes over the limit.`,
      );
      return;
    }
    try {
      setLogOnlySubmitting(true);
      if (logEntryMode === "task") {
        if (editingLog) {
          const ok = await saveExistingLogFromForm();
          if (!ok) return;
        } else {
          const entry = selectedMinutes > 0 ? buildSelectedEntry() : null;
          if (selectedMinutes > 0 && !entry) return;
          if (entry) {
            await api.post(
              `/projects/${entry.task.projectId}/tasks/${entry.task._id}/time`,
              {
                minutes: entry.minutes,
                note: entry.note || undefined,
              },
            );
          }
        }
      } else {
        const meetingProjectId = logProjectId || "";
        const ok = await logMeetingForProject(
          meetingProjectId,
          meetingMinutes,
          undefined,
        );
        if (!ok) return;
      }
      setLogNote("");
      setLogHours("");
      setLogMinutesInput("");
      setMeetingMinutesInput("");
      await loadTodayTaskData();
      toast.success("Task time logged");
    } catch (e: any) {
      setPunchOutErr(
        e?.response?.data?.error || "Failed to log tasks. Please try again.",
      );
    } finally {
      setLogOnlySubmitting(false);
    }
  }

  async function submitPunchOutWithTasks() {
    if (submittingPunchOut) return;
    setPunchOutErr(null);
    if (logEntryMode === "task") {
      // Only force a new task entry when nothing is logged for today yet.
      if (!editingLog && !hasExistingLogsToday && (!hasLogTarget || !hasTaskMinutes)) {
        setPunchOutErr("Add time to a task before punching out, or skip.");
        return;
      }
    } else {
      if (!hasMeetingProject) {
        setPunchOutErr("Select a project and minutes for the meeting.");
        return;
      }
    }
    if (!editingLog && activeMinutes > remainingMinutes) {
      setPunchOutErr(
        `You're ${activeMinutes - remainingMinutes} minutes over the limit.`,
      );
      return;
    }
    try {
      setSubmittingPunchOut(true);
      let entry: ReturnType<typeof buildSelectedEntry> | null = null;

      // If editing an existing log, update it first
      if (editingLog && logEntryMode === "task") {
        const ok = await saveExistingLogFromForm();
        if (!ok) {
          setSubmittingPunchOut(false);
          return;
        }
      }

      // If user entered time, create a new log; otherwise allow punch-out if logs already exist
      if (logEntryMode === "task") {
        if (selectedMinutes > 0) {
          entry = buildSelectedEntry();
          if (!entry) {
            setSubmittingPunchOut(false);
            return;
          }
          await api.post(
            `/projects/${entry.task.projectId}/tasks/${entry.task._id}/time`,
            {
              minutes: entry.minutes,
              note: entry.note || undefined,
            },
          );
        } else if (!hasExistingLogsToday) {
          // No prior logs: still require a valid entry to ensure at least one task is logged
          entry = buildSelectedEntry();
          if (!entry) {
            setSubmittingPunchOut(false);
            return;
          }
          await api.post(
            `/projects/${entry.task.projectId}/tasks/${entry.task._id}/time`,
            {
              minutes: entry.minutes,
              note: entry.note || undefined,
            },
          );
        }
      } else {
        const meetingProjectId = logProjectId || "";
        const okMeeting = await logMeetingForProject(
          meetingProjectId,
          meetingMinutes,
          undefined,
        );
        if (!okMeeting) {
          setSubmittingPunchOut(false);
          return;
        }
      }
      // Finally punch out
      const ok = await punch("out", { triggerDailyStatusEmail: true });
      if (ok) {
        setShowPunchOut(false);
        setPunchModalMode("punch");
        setMeetingMinutesInput("");
      } else {
        setPunchOutErr("Failed to punch out. Please try again.");
      }
    } catch (e: any) {
      setPunchOutErr(
        e?.response?.data?.error || "Failed to punch out with tasks",
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
      const ok = await punch("out", { triggerDailyStatusEmail: true });
      if (ok) {
        setShowPunchOut(false);
        setPunchModalMode("punch");
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
        Math.floor((backfillAttendance.workedMs || 0) / 60000),
      );
      const cap = Math.max(0, worked - 60);
      const already = workedTasksForDay.reduce(
        (acc, t) => acc + (t.minutes || 0),
        0,
      );
      const remainingForDay = Math.max(0, cap - already);

      const isMeetingMode = backfillEntryMode === "meeting";

      // Pre-validate selected minutes against remaining cap
      const entries = isMeetingMode
        ? []
        : assigned
            .map((t) => ({
              task: t,
              minutes: computeMinutes({ hours: t.hours, minutes: t.minutes }),
              note: (t.note || "").trim(),
            }))
            .filter((t) => t.minutes > 0);

      const meetingTarget =
        isMeetingMode &&
        backfillMeetingMinutesValue > 0 &&
        backfillMeetingProjectId
          ? meetingTaskByProject.get(backfillMeetingProjectId)
          : null;

      if (isMeetingMode) {
        if (backfillMeetingMinutesValue <= 0) {
          setBackfillErr("Enter meeting minutes to log.");
          return;
        }
        if (!meetingTarget) {
          setBackfillErr("Select a project to log meeting time.");
          return;
        }
      } else {
        if (entries.some((e) => !e.note)) {
          setBackfillErr("Add a short description for each logged task.");
          return;
        }
      }

      const requested = isMeetingMode
        ? backfillMeetingMinutesValue
        : entries.reduce((acc, t) => acc + t.minutes, 0);

      if (requested > remainingForDay) {
        setBackfillErr(
          `You're ${requested - remainingForDay} minutes over the limit.`,
        );
        return;
      }

      setBackfillSubmitting(true);
      if (!isMeetingMode) {
        for (const entry of entries) {
          await api.post(
            `/projects/${entry.task.projectId}/tasks/${entry.task._id}/time-at`,
            {
              minutes: entry.minutes,
              date: backfillDate,
              note: entry.note,
            },
          );
        }
      }
      if (isMeetingMode && meetingTarget) {
        const ok = await logMeetingForProject(
          backfillMeetingProjectId,
          backfillMeetingMinutesValue,
          backfillDate,
          setBackfillErr,
        );
        if (!ok) {
          setBackfillSubmitting(false);
          return;
        }
      }
      setShowBackfill(false);
      // Refresh worked summary for that bucket and missing list
      await loadMissingOut();
    } catch (e: any) {
      setBackfillErr(
        e?.response?.data?.error || "Failed to log tasks for the day",
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

  // When opening the punch/log modal, default to the first available project/task
  useEffect(() => {
    if (!showPunchOut) return;
    if (!logEligibleTasks.length || !logProjectOptions.length) {
      if (logProjectId || logMainTaskId || logSubTaskId) {
        setLogProjectId("");
        setLogMainTaskId("");
        setLogSubTaskId("");
      }
      return;
    }
    if (
      !logProjectId ||
      !logProjectOptions.some((p) => p.value === logProjectId)
    ) {
      const nextProject = logProjectOptions[0]?.value || "";
      setLogProjectId(nextProject);
      setLogMainTaskId("");
      setLogSubTaskId("");
      return;
    }
    if (
      !logMainTaskId ||
      !mainTaskOptions.some((m) => m.value === logMainTaskId)
    ) {
      const nextMain = mainTaskOptions[0]?.value || "";
      setLogMainTaskId(nextMain);
      setLogSubTaskId("");
      return;
    }
    if (!subTaskOptions.length) {
      if (logSubTaskId) setLogSubTaskId("");
      return;
    }
    if (
      !logSubTaskId ||
      !subTaskOptions.some((s) => s.value === logSubTaskId)
    ) {
      setLogSubTaskId(subTaskOptions[0]?.value || "");
    }
  }, [
    logEligibleTasks,
    logMainTaskId,
    logProjectId,
    logProjectOptions,
    logSubTaskId,
    mainTaskOptions,
    showPunchOut,
    subTaskOptions,
  ]);

  // While punched-in, periodically refresh attendance so UI stops the timer
  // when backend auto punch-out (or manual punch-out elsewhere) occurs.
  useEffect(() => {
    // clear any previous interval
    if (refreshRef.current) {
      clearInterval(refreshRef.current);
      refreshRef.current = null;
    }
    const isPunchedIn = Boolean(
      attendance?.lastPunchIn && !attendance?.lastPunchOut,
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
          (p: MyProject) => !p.isPersonal,
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

  const punchInLabel = "Punch In";
  const punchInLoadingLabel = "Punching In…";

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Employee Area</h2>
        <p className="text-sm text-muted-foreground">
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
            <div className="text-sm text-muted-foreground">
              Time worked today
            </div>
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
                <div className="mt-2 text-xs text-muted-foreground">
                  Last punched in from {location}
                </div>
              );
            })()}
          </div>

          <div className="flex items-center gap-2">
            {punchedIn ? (
              <>
                <button
                  className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-60"
                  onClick={openLogTasksModal}
                  disabled={pending === "out" || submittingPunchOut}
                >
                  Log Tasks
                </button>
                <button
                  className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-60"
                  onClick={openPunchOutModal}
                  disabled={pending === "out"}
                >
                  {pending === "out" ? "Punching Out…" : "Punch Out"}
                </button>
              </>
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
                  {pending === "in" ? punchInLoadingLabel : punchInLabel}
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        {/* My Projects */}
        <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">My Projects</h3>
              <p className="text-sm text-muted-foreground">
                Projects you're assigned to
              </p>
            </div>
            <div className="flex items-center gap-2">
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
              <div className="text-sm text-muted-foreground">
                Loading projects…
              </div>
            ) : myProjects.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No project assignments.
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {myProjects.slice(0, 6).map((p) => (
                  <li key={p._id} className="py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium leading-5">{p.title}</div>
                        {p.description && (
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
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
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : tasks.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No tasks assigned.
            </div>
          ) : (
            <ul className="space-y-2">
              {tasks.map((t) => (
                <li
                  key={t._id}
                  className="border border-border rounded px-3 py-2"
                >
                  <div className="text-xs text-muted-foreground">
                    {typeof t.project === "string"
                      ? t.project
                      : t.project?.title}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{t.title}</div>
                    <span className="text-xs text-muted-foreground">
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
        <RoleGuard permission={{ module: "presence", action: "read" }}>
          <TeamPresenceCard />
        </RoleGuard>
      </div>

      <ConfirmDialog
        open={confirmDelete.open}
        destructive
        title="Delete time log?"
        message="This will remove the log permanently."
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() =>
          setConfirmDelete((p) => ({
            ...p,
            open: false,
          }))
        }
      />

      {locationPrompt.open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center !mt-0">
          <div
            className="absolute inset-0 bg-black/40 -mt-[32px]"
            onClick={() =>
              setLocationPrompt((prev) => ({ ...prev, open: false }))
            }
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg space-y-4">
            <div className="space-y-1">
              <h4 className="text-lg font-semibold">Enable location</h4>
              <p className="text-sm text-muted-foreground">
                {renderLocationHint(locationPrompt.permission)}
              </p>
            </div>
            <div className="flex justify-end">
              <button
                className="rounded-md border border-border px-3 py-2 text-sm"
                onClick={() =>
                  setLocationPrompt((prev) => ({ ...prev, open: false }))
                }
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Punch-out modal */}
      {showPunchOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center !mt-0">
          <div
            className="absolute inset-0 bg-black/40 -mt-[32px] min-h-screen"
            onClick={() => {
              setShowPunchOut(false);
              setPunchModalMode("punch");
            }}
          />
          <div className="relative w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">
                {punchModalMode === "log"
                  ? "Log tasks"
                  : "Log today’s tasks & punch out"}
              </h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowPunchOut(false);
                  setPunchModalMode("punch");
                }}
              >
                Close
              </Button>
            </div>
            {punchOutErr && (
              <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                {punchOutErr}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-bg px-2 py-1 border border-border/60">
                Today {formatMinutesLabel(Math.round(elapsed / 60000))}
              </span>
              <span className="rounded-full bg-bg px-2 py-1 border border-border/60">
                Logged{" "}
                {formatMinutesLabel(
                  workedTasksToday.reduce((a, b) => a + b.minutes, 0),
                )}
              </span>
              <span className="rounded-full bg-bg px-2 py-1 border border-border/60">
                Left {formatMinutesLabel(remainingMinutes)}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => setShowTodayLogs((v) => !v)}
              >
                {showTodayLogs ? "Hide logs" : "View logs"}
              </Button>
            </div>

            <div className="flex items-center gap-2 mt-3">
              {/* <div className="inline-flex rounded-md border border-border overflow-hidden">
                <button
                  className={`px-3 py-2 text-xs ${
                    logEntryMode === "task"
                      ? "bg-primary text-white"
                      : "bg-surface text-foreground"
                  }`}
                  onClick={() => changeLogEntryMode("task")}
                >
                  Task log
                </button>
                <button
                  className={`px-3 py-2 text-xs border-l border-border ${
                    logEntryMode === "meeting"
                      ? "bg-primary text-white"
                      : "bg-surface text-foreground"
                  }`}
                  onClick={() => changeLogEntryMode("meeting")}
                >
                  Meeting log
                </button>
              </div> */}
            </div>

            {assignedErr && (
              <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                {assignedErr}
              </div>
            )}
            {assignedLoading ? (
              <div className="text-sm text-muted-foreground">
                Loading tasks…
              </div>
            ) : (
              <>
                {logEntryMode === "task" ? (
                  logEligibleTasks.length === 0 ? (
                    <div className="rounded-md border border-border bg-white px-3 py-2 text-sm text-muted-foreground">
                      No assigned tasks to log right now. You can punch out
                      without logging or add time later.
                    </div>
                  ) : (
                    <div className="space-y-2 rounded-md border border-border bg-white p-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        <select
                          className="h-10 rounded-md border border-border bg-surface px-2 text-sm"
                          value={logProjectId}
                          onChange={(e) => {
                            setLogProjectId(e.target.value);
                            setLogMainTaskId("");
                            setLogSubTaskId("");
                          }}
                          disabled={!logProjectOptions.length}
                        >
                          <option value="">Select project</option>
                          {logProjectOptions.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label || "Project"}
                            </option>
                          ))}
                        </select>
                        <select
                          className="h-10 rounded-md border border-border bg-surface px-2 text-sm"
                          value={logMainTaskId}
                          onChange={(e) => {
                            setLogMainTaskId(e.target.value);
                            setLogSubTaskId("");
                          }}
                          disabled={!logProjectId || !mainTaskOptions.length}
                        >
                          <option value="">Select main task</option>
                          {mainTaskOptions.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label || "Task"}
                            </option>
                          ))}
                        </select>
                      </div>
                      <select
                        className="h-10 w-full rounded-md border border-border bg-surface px-2 text-sm"
                        value={logSubTaskId}
                        onChange={(e) => setLogSubTaskId(e.target.value)}
                        disabled={!logMainTaskId || !subTaskOptions.length}
                      >
                        <option value="">
                          {subTaskOptions.length
                            ? "Select subtask"
                            : "No subtask available"}
                        </option>
                        {subTaskOptions.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label || "Task"}
                          </option>
                        ))}
                      </select>
                      <input
                        className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm"
                        placeholder="What did you work on? (optional)"
                        value={logNote}
                        onChange={(e) => setLogNote(e.target.value)}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          className="h-10 w-24 rounded-md border border-border bg-surface px-2 text-sm"
                          placeholder="Hours"
                          value={logHours}
                          onChange={(e) => setLogHours(e.target.value)}
                        />
                        <input
                          type="number"
                          step="5"
                          min="0"
                          className="h-10 w-24 rounded-md border border-border bg-surface px-2 text-sm"
                          placeholder="Min"
                          value={logMinutesInput}
                          onChange={(e) => setLogMinutesInput(e.target.value)}
                        />
                        <span className="text-[11px] text-muted-foreground">
                          {selectedMinutes
                            ? `${selectedMinutes} min`
                            : "Enter time"}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {selectedTaskForLog
                          ? `Logging to ${selectedTaskForLog.title}`
                          : "Pick a task to continue."}
                      </div>
                    </div>
                  )
                ) : (
                  <div className="rounded-md border border-border bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Meeting time</div>
                      <span className="text-[11px] text-muted-foreground">
                        Logs to the project’s Meetings task
                      </span>
                    </div>
                    {meetingTaskByProject.size === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        No meeting tasks available. Switch to task log or skip.
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                          value={logProjectId}
                          onChange={(e) => {
                            setLogProjectId(e.target.value);
                            setLogMainTaskId("");
                            setLogSubTaskId("");
                          }}
                          disabled={!logProjectOptions.length}
                        >
                          <option value="">Select project</option>
                          {logProjectOptions.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label || "Project"}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          step="5"
                          min="0"
                          className="h-9 w-28 rounded-md border border-border bg-surface px-2 text-sm"
                          placeholder="Meeting min"
                          value={meetingMinutesInput}
                          onChange={(e) =>
                            setMeetingMinutesInput(e.target.value)
                          }
                        />
                        <span className="text-[11px] text-muted-foreground">
                          {meetingMinutes
                            ? `${meetingMinutes} min`
                            : "Enter meeting minutes"}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {showTodayLogs && (
              <div className="mt-4">{renderLogList("today")}</div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={() => {
                  setShowPunchOut(false);
                  setPunchModalMode("punch");
                }}
                disabled={submittingPunchOut || logOnlySubmitting}
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                {punchModalMode === "log" ? (
                  <button
                    className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
                    onClick={logTasksOnly}
                    disabled={
                      logOnlySubmitting || submittingPunchOut || !canSubmitLog
                    }
                  >
                    {logOnlySubmitting ? "Saving…" : "Save Logs"}
                  </button>
                ) : (
                  <>
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
                      disabled={submittingPunchOut || !canSubmitPunchOut}
                    >
                      {submittingPunchOut
                        ? "Submitting…"
                        : "Submit & Punch Out"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Backfill tasks modal (integrated with punch-out and add-task like today) */}
      {showBackfill && backfillDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 -mt-[32px]"
            onClick={() => setShowBackfill(false)}
          />
          <div className="relative w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">
                Resolve {fmtDateKey(backfillDate)}
              </h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBackfill(false)}
              >
                Close
              </Button>
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
                        ...getTimezonePayload(),
                      });
                      setBackfillAttendance(resp.data.attendance || null);
                      await loadMissingOut();
                    } catch (e: any) {
                      setBackfillErr(
                        e?.response?.data?.error ||
                          "Failed to set punch-out time",
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
              <div className="text-xs text-muted-foreground">
                {backfillAttendance?.firstPunchIn ||
                backfillAttendance?.lastPunchIn ? (
                  <>
                    Punch-in:{" "}
                    {fmtShortTime(
                      backfillAttendance.lastPunchIn ||
                        backfillAttendance.firstPunchIn,
                    )}
                  </>
                ) : (
                  <>Punch-in time not available.</>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Example: 18:00. Total available after break will be calculated
                from your first punch-in to this time minus 60 minutes.
              </div>
            </div>

            <div className="text-xs text-muted-foreground mb-3">
              {backfillAttendance ? (
                <>
                  {(() => {
                    const worked = Math.max(
                      0,
                      Math.floor((backfillAttendance.workedMs || 0) / 60000),
                    );
                    const already = workedTasksForDay.reduce(
                      (acc, t) => acc + (t.minutes || 0),
                      0,
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
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (
              <div className="space-y-3">
                {/* <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">Step 2: Log work</div>
                  <div className="inline-flex rounded-md border border-border overflow-hidden">
                    <button
                      className={`px-3 py-1 text-xs ${
                        backfillEntryMode === "task"
                          ? "bg-primary text-white"
                          : "bg-surface text-foreground"
                      }`}
                      onClick={() => changeBackfillEntryMode("task")}
                    >
                      Task log
                    </button>
                    <button
                      className={`px-3 py-1 text-xs border-l border-border ${
                        backfillEntryMode === "meeting"
                          ? "bg-primary text-white"
                          : "bg-surface text-foreground"
                      }`}
                      onClick={() => changeBackfillEntryMode("meeting")}
                    >
                      Meeting log
                    </button>
                  </div>
                </div> */}

                {backfillEntryMode === "task" ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium">Assigned tasks</div>
                      <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
                        <button
                          type="button"
                          className={`px-3 py-1 font-medium transition-colors ${
                            assignedStatusView === "ACTIVE"
                              ? "bg-secondary text-white"
                              : "bg-surface text-muted-foreground"
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
                              : "bg-surface text-muted-foreground"
                          }`}
                          onClick={() => setAssignedStatusView("DONE")}
                          aria-pressed={assignedStatusView === "DONE"}
                        >
                          Done
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Add a brief description and time for tasks you worked on.
                      Only entries with time will be logged when you submit.
                    </div>
                    {assigned.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        No assigned tasks.
                      </div>
                    ) : filteredAssigned.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        {assignedStatusView === "DONE"
                          ? "No tasks marked done."
                          : "No active tasks."}
                      </div>
                    ) : (
                      <ul className="space-y-2 max-h-72 overflow-auto pr-1">
                        {filteredAssigned.map((t) => {
                          const minutesVal = computeMinutes({
                            hours: t.hours,
                            minutes: t.minutes,
                          });
                          return (
                            <li
                              key={t._id}
                              className="border border-border rounded px-3 py-2"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium">
                                    {t.title}
                                  </div>
                                  {t.projectTitle && (
                                    <div className="text-xs text-muted-foreground">
                                      {t.projectTitle}
                                    </div>
                                  )}
                                </div>
                                <span className="text-[11px] text-muted-foreground uppercase">
                                  {t.status === "DONE"
                                    ? "Done"
                                    : t.status === "INPROGRESS"
                                      ? "In progress"
                                      : "Pending"}
                                </span>
                              </div>
                              <div className="mt-2 space-y-2">
                                <input
                                  className="w-full h-10 rounded-md border border-border bg-bg px-3 text-sm"
                                  placeholder="What did you work on?"
                                  value={t.note || ""}
                                  disabled={!backfillAttendance}
                                  onChange={(e) =>
                                    setAssigned((prev) =>
                                      prev.map((x) =>
                                        x._id === t._id
                                          ? { ...x, note: e.target.value }
                                          : x,
                                      ),
                                    )
                                  }
                                />
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    type="number"
                                    step="0.25"
                                    min="0"
                                    className="h-8 w-24 rounded-md border border-border bg-surface px-2 text-sm"
                                    placeholder="Hours"
                                    value={t.hours || ""}
                                    disabled={!backfillAttendance}
                                    onChange={(e) =>
                                      setAssigned((prev) =>
                                        prev.map((x) =>
                                          x._id === t._id
                                            ? { ...x, hours: e.target.value }
                                            : x,
                                        ),
                                      )
                                    }
                                  />
                                  <input
                                    type="number"
                                    step="5"
                                    min="0"
                                    className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-sm"
                                    placeholder="Min"
                                    value={t.minutes || ""}
                                    disabled={!backfillAttendance}
                                    onChange={(e) =>
                                      setAssigned((prev) =>
                                        prev.map((x) =>
                                          x._id === t._id
                                            ? { ...x, minutes: e.target.value }
                                            : x,
                                        ),
                                      )
                                    }
                                  />
                                  <span className="text-[11px] text-muted-foreground">
                                    {minutesVal
                                      ? `${minutesVal} min to log`
                                      : "Fill time to log"}
                                  </span>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                ) : (
                  <div className="rounded border border-border bg-white p-3">
                    <div className="text-sm font-medium">Meetings</div>
                    {meetingProjectOptions.length === 0 ? (
                      <div className="text-xs text-muted-foreground mt-1">
                        No meeting tasks available to log.
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select
                          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                          value={backfillMeetingProjectId}
                          onChange={(e) =>
                            setBackfillMeetingProjectId(e.target.value)
                          }
                        >
                          {meetingProjectOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="5"
                          className="h-9 w-28 rounded-md border border-border bg-surface px-2 text-sm"
                          placeholder="Meeting min"
                          value={backfillMeetingMinutes}
                          onChange={(e) =>
                            setBackfillMeetingMinutes(e.target.value)
                          }
                        />
                        <span className="text-[11px] text-muted-foreground">
                          Quick meeting time log
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {!backfillLoading && renderLogList("backfill")}
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
            className="absolute inset-0 bg-black/40 -mt-[32px]"
            onClick={() => setShowSetOut(false)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">
                Set punch-out for {fmtDateKey(setOutDate)}
              </h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSetOut(false)}
              >
                Close
              </Button>
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
              <div className="text-xs text-muted-foreground">
                Example: 18:00
              </div>
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
                      ...getTimezonePayload(),
                    });
                    setShowSetOut(false);
                    await loadMissingOut();
                  } catch (e: any) {
                    setSetOutErr(
                      e?.response?.data?.error ||
                        "Failed to set punch-out time",
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
            className="absolute inset-0 bg-black/40 -mt-[32px]"
            onClick={() => setShowMissing(false)}
          />
          <div className="relative w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">
                Resolve Attendance Issues
              </h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMissing(false)}
              >
                Close
              </Button>
            </div>
            <div className="text-sm text-muted-foreground mb-3">
              You must resolve past working days with incomplete attendance
              before punching in again.
            </div>
            {missingLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
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
                          <button
                            className="rounded-md border border-border px-3 py-1 text-sm"
                            onClick={() => openLeaveModal(issue.date)}
                          >
                            Apply Leave
                          </button>
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
            className="absolute inset-0 bg-black/40 -mt-[32px]"
            onClick={() => (!leaveModal.saving ? closeLeaveModal() : null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">Apply Leave</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => (!leaveModal.saving ? closeLeaveModal() : null)}
                disabled={leaveModal.saving}
              >
                Close
              </Button>
            </div>
            <div className="text-sm text-muted-foreground mb-3">
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
                <span className="w-28 text-muted-foreground">Start date</span>
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
                <span className="w-28 text-muted-foreground">End date</span>
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
                <span className="w-28 text-muted-foreground">Type</span>
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
                <span className="text-muted-foreground">Reason (optional)</span>
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

type PresenceRow = {
  employee: { id: string; name: string };
  firstPunchIn?: string;
  lastPunchOut?: string;
  onLeaveToday?: boolean;
  startingLeaveTomorrow?: boolean;
  leaveTomorrowStatus?: "APPROVED" | "PENDING" | string | null;
  nextLeaveInDays?: number | null;
  nextLeaveStatus?: "APPROVED" | "PENDING" | string | null;
  leaveTodayReason?: string | null;
  leaveTodayType?: string | null;
  leaveTomorrowReason?: string | null;
  leaveTomorrowType?: string | null;
  nextLeaveReason?: string | null;
  nextLeaveType?: string | null;
};

function fmtTime(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function presenceStatus(row: PresenceRow) {
  if (row.firstPunchIn && row.lastPunchOut) return "Punched out";
  if (row.firstPunchIn) return "Punched in";
  return "Not punched in";
}

function TeamPresenceCard() {
  const [rows, setRows] = useState<PresenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [leaveDetail, setLeaveDetail] = useState<PresenceRow | null>(null);

  async function load() {
    try {
      setLoading(true);
      setErr(null);
      const res = await api.get("/attendance/company/presence");
      setRows(res.data.rows || []);
      setRefreshedAt(new Date());
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load team presence");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-4 rounded-lg border border-border bg-surface shadow-sm md:col-span-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Users size={18} />
          <div className="font-semibold leading-none">Team Presence</div>
        </div>
      </div>
      {err && (
        <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
          {err}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-2 py-1">Member</th>
              <th className="px-2 py-1">Punch In</th>
              <th className="px-2 py-1">Punch Out</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1">Notes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-2 py-6 text-center text-muted-foreground text-sm"
                >
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-2 py-6 text-center text-muted-foreground text-sm"
                >
                  No employees found.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const status = presenceStatus(row);
                const notes: string[] = [];
                if (row.onLeaveToday) notes.push("On approved leave");
                if (row.startingLeaveTomorrow) {
                  notes.push(
                    row.leaveTomorrowStatus === "APPROVED"
                      ? "On leave tomorrow"
                      : "On leave tomorrow (pending)",
                  );
                }
                if (
                  row.nextLeaveInDays !== null &&
                  row.nextLeaveInDays !== undefined
                ) {
                  const days = row.nextLeaveInDays;
                  const statusLabel =
                    row.nextLeaveStatus === "APPROVED"
                      ? "approved"
                      : row.nextLeaveStatus === "PENDING"
                        ? "pending"
                        : "pending";
                  if (days === 1) {
                    if (!row.startingLeaveTomorrow) {
                      notes.push(`On leave tomorrow (${statusLabel})`);
                    }
                  } else if (days > 1) {
                    notes.push(`On leave in ${days} days (${statusLabel})`);
                  }
                }
                return (
                  <tr
                    key={row.employee.id}
                    className="border-t border-border/70 text-sm"
                  >
                    <td className="px-2 py-1">{row.employee.name}</td>
                    <td className="px-2 py-1">{fmtTime(row.firstPunchIn)}</td>
                    <td className="px-2 py-1">{fmtTime(row.lastPunchOut)}</td>
                    <td className="px-2 py-1">
                      <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px]">
                        {status}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span className="truncate">
                          {notes.length ? notes.join(" • ") : "—"}
                        </span>
                        {notes.length > 0 && (
                          <button
                            className="h-7 w-7 inline-flex items-center justify-center rounded border border-border hover:bg-bg"
                            title="View leave details"
                            onClick={() => setLeaveDetail(row)}
                          >
                            <Eye size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        {refreshedAt
          ? `Updated ${refreshedAt.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : "—"}
      </div>

      {leaveDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setLeaveDetail(null)}
          />
          <div className="relative z-10 w-[min(380px,92vw)] rounded-lg border border-border bg-surface p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Leave details</div>
                <div className="text-xs text-muted-foreground">
                  {leaveDetail.employee.name}
                </div>
              </div>
              <button
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setLeaveDetail(null)}
              >
                Close
              </button>
            </div>
            <div className="text-sm space-y-1">
              {leaveDetail.leaveTodayReason && (
                <div>
                  <span className="text-muted-foreground">Today: </span>
                  {leaveDetail.leaveTodayReason}
                  {leaveDetail.leaveTodayType
                    ? ` (${leaveDetail.leaveTodayType})`
                    : ""}
                </div>
              )}
              {leaveDetail.leaveTomorrowReason && (
                <div>
                  <span className="text-muted-foreground">Tomorrow: </span>
                  {leaveDetail.leaveTomorrowReason}
                  {leaveDetail.leaveTomorrowType
                    ? ` (${leaveDetail.leaveTomorrowType})`
                    : ""}
                </div>
              )}
              {leaveDetail.nextLeaveReason && (
                <div>
                  <span className="text-muted-foreground">Next leave: </span>
                  {leaveDetail.nextLeaveReason}
                  {leaveDetail.nextLeaveType
                    ? ` (${leaveDetail.nextLeaveType})`
                    : ""}
                  {leaveDetail.nextLeaveInDays !== null &&
                  leaveDetail.nextLeaveInDays !== undefined
                    ? ` in ${leaveDetail.nextLeaveInDays} day(s)`
                    : ""}
                </div>
              )}
              {!leaveDetail.leaveTodayReason &&
                !leaveDetail.leaveTomorrowReason &&
                !leaveDetail.nextLeaveReason && (
                  <div className="text-muted-foreground text-sm">
                    No leave reason available.
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
