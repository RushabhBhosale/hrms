import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { getEmployee, hasPermission } from "../../lib/auth";
import { toast } from "react-hot-toast";

type AttRecord = {
  date: string; // ISO (00:00:00)
  firstPunchIn?: string;
  lastPunchOut?: string;
  workedMs?: number;
  autoPunchOut?: boolean;
  firstPunchInLocation?: string | null;
  lastPunchInLocation?: string | null;
};

type DayTask = {
  _id: string;
  title: string;
  status: "PENDING" | "INPROGRESS" | "DONE";
  project?: { _id: string; title: string } | null;
  minutes: number;
  logs: { minutes: number; note?: string; createdAt: string }[];
};

type TaskOption = {
  id: string;
  title: string;
  projectId: string;
  projectTitle: string;
};

function fmtDate(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "-";
  return x.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function fmtTime(t?: string) {
  if (!t) return "-";
  return new Date(t).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtDur(ms?: number) {
  if (!ms || ms <= 0) return "-";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
function parseUTC(s?: string): number | null {
  if (!s) return null;
  const withTZ = /[zZ]|[+\-]\d{2}:\d{2}$/.test(s) ? s : s + "Z";
  const ts = Date.parse(withTZ);
  return Number.isFinite(ts) ? ts : null;
}
function toTimeInputValue(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
function parseTimeInputMinutes(value: string): number | null {
  if (!value) return null;
  const [hRaw, mRaw] = value.split(":");
  if (hRaw === undefined || mRaw === undefined) return null;
  const hours = Number(hRaw);
  const minutes = Number(mRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function inferWorkedMs(r: AttRecord) {
  const MAX = 16 * 60 * 60 * 1000; // 16 hours hard cap

  // 1) Trust backend total when provided (handles multiple punch blocks)
  const backend = Number(r.workedMs);
  if (Number.isFinite(backend) && backend > 0) {
    return Math.min(Math.max(0, backend), MAX);
  }

  // 2) Fallback: derive from first/last punch window
  const start = parseUTC(r.firstPunchIn);
  const end = parseUTC(r.lastPunchOut);
  const fromPunches =
    start != null && end != null ? Math.max(0, end - start) : null;

  // 3) Define sane bounds (tweak if needed)
  const MIN = 10 * 60 * 1000; // 10 minutes

  // 4) If punches exist, clamp and use them
  if (fromPunches != null) {
    const clamped = Math.min(fromPunches, MAX);
    if (clamped >= MIN) return clamped;
  }

  return 0;
}

function computeMinutes(entry: { hours?: string; minutes?: string }) {
  const hours = parseFloat(entry.hours || "0");
  const extraMinutes = parseInt(entry.minutes || "0", 10);
  const fromHours = Number.isFinite(hours) ? Math.round(hours * 60) : 0;
  const fromMinutes = Number.isFinite(extraMinutes) ? extraMinutes : 0;
  return Math.max(0, fromHours + fromMinutes);
}

function toISODateOnly(d: Date) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default function AttendanceRecords() {
  const u = getEmployee();
  const isPrimaryAdmin =
    u?.primaryRole === "ADMIN" || u?.primaryRole === "SUPERADMIN";
  const canViewOthers = hasPermission(u, "attendance", "read");
  const canEditPunches = !!isPrimaryAdmin;

  const [employees, setEmployees] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [employeeId, setEmployeeId] = useState<string>(u?.id || "");
  const [empQuery, setEmpQuery] = useState("");

  const [rows, setRows] = useState<AttRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // yyyy-mm
  const [summary, setSummary] = useState<{
    workedDays: number;
    leaveDays: number;
    leaveDates: string[];
    bankHolidays: string[];
    bankHolidayDetails?: { date: string; name?: string }[];
    halfDayLeaves?: number;
    employmentStart?: string | null;
  } | null>(null);

  const [detail, setDetail] = useState<AttRecord | null>(null);
  const [dayTasks, setDayTasks] = useState<DayTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksErr, setTasksErr] = useState<string | null>(null);
  const detailKeyRef = useRef<string | null>(null);
  const detailEmployeeIdRef = useRef<string | null>(null);
  const detailTasksRequestId = useRef(0);
  const createEmployeeIdRef = useRef<string | null>(null);
  const [taskOptions, setTaskOptions] = useState<TaskOption[]>([]);
  const [taskOptionsLoading, setTaskOptionsLoading] = useState(false);
  const [taskOptionsErr, setTaskOptionsErr] = useState<string | null>(null);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<{
    taskId: string;
    hours: string;
    minutes: string;
  }>({
    taskId: "",
    hours: "",
    minutes: "",
  });
  const [taskFormErr, setTaskFormErr] = useState<string | null>(null);
  const [taskFormSaving, setTaskFormSaving] = useState(false);
  const [editForm, setEditForm] = useState<{
    firstIn: string;
    lastOut: string;
  }>({
    firstIn: "",
    lastOut: "",
  });
  const [editErr, setEditErr] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [createModal, setCreateModal] = useState<{
    open: boolean;
    date: string;
    firstIn: string;
    lastOut: string;
    saving: boolean;
    error: string | null;
  }>({
    open: false,
    date: "",
    firstIn: "",
    lastOut: "",
    saving: false,
    error: null,
  });
  const [notifyModal, setNotifyModal] = useState<{
    open: boolean;
    date: string;
    employeeId: string;
    type: "ADD" | "EDIT";
    firstIn: string;
    lastOut: string;
    message: string;
    saving: boolean;
    error: string | null;
  }>({
    open: false,
    date: "",
    employeeId: "",
    type: "EDIT",
    firstIn: "",
    lastOut: "",
    message: "",
    saving: false,
    error: null,
  });
  const selectedEmployeeId = employeeId || u?.id || "";

  // Report list moved to dedicated page

  // ADMIN/HR filters
  const [showWeekends, setShowWeekends] = useState(true);
  const [onlyWorked, setOnlyWorked] = useState(false);
  const [minHours, setMinHours] = useState<number>(0);
  const [showLeaves, setShowLeaves] = useState(true);

  // Load employees for admin/hr
  useEffect(() => {
    if (!canViewOthers) return;
    (async () => {
      try {
        const res = await api.get("/companies/employees");
        console.log("dj", res);
        const list = res.data.employees || [];
        setEmployees(list);
        if (!employeeId && list.length) setEmployeeId(list[0].id);
      } catch {
        /* ignore */
      }
    })();
  }, [canViewOthers]); // eslint-disable-line

  async function load(empId: string) {
    try {
      setLoading(true);
      setErr(null);
      const res = await api.get(`/attendance/history/${empId}`);
      setRows(res.data.attendance || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load attendance history");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!employeeId) return;
    load(employeeId);
  }, [employeeId]);

  useEffect(() => {
    if (taskOptions.length === 0) {
      setTaskForm((prev) =>
        prev.taskId || prev.hours || prev.minutes
          ? { ...prev, taskId: "" }
          : prev,
      );
      return;
    }
    setTaskForm((prev) => {
      if (prev.taskId && taskOptions.some((opt) => opt.id === prev.taskId)) {
        return prev;
      }
      return { ...prev, taskId: taskOptions[0].id };
    });
  }, [taskOptions]);

  useEffect(() => {
    if (!employeeId) return;
    (async () => {
      try {
        const res = await api.get(`/attendance/report/${employeeId}`, {
          params: { month },
        });
        console.log("dkdd", res);
        setSummary(res.data.report);
      } catch {
        /* ignore */
      }
    })();
  }, [month, employeeId]);

  // Monthly list removed from this page; see Report page

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const keyMonth = toISODateOnly(new Date(r.date)).slice(0, 7);
      return keyMonth === month;
    });
  }, [rows, month]);

  const byDate = useMemo(() => {
    const m = new Map<string, AttRecord>();
    for (const r of filtered) {
      const key = toISODateOnly(new Date(r.date));
      m.set(key, r);
    }
    return m;
  }, [filtered]);

  // Build calendar grid for selected month (Sunday → Saturday)
  const cursor = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }, [month]);

  const grid = useMemo(() => {
    const start = startOfMonth(cursor);
    const end = endOfMonth(cursor);
    const gridStart = addDays(start, -start.getDay()); // back to Sunday
    const gridEnd = addDays(end, 6 - end.getDay()); // forward to Saturday

    const days: { date: Date; inMonth: boolean; rec?: AttRecord }[] = [];
    for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
      const key = toISODateOnly(d);
      days.push({
        date: new Date(d),
        inMonth: d.getMonth() === cursor.getMonth(),
        rec: byDate.get(key),
      });
    }
    return days;
  }, [cursor, byDate]);

  const totalWorked = useMemo(
    () =>
      grid
        .filter((d) => d.inMonth && d.rec)
        .reduce((acc, d) => acc + inferWorkedMs(d.rec!), 0),
    [grid],
  );

  const detailWorkedMinutes = useMemo(() => {
    if (!detail) return 0;
    const ms = inferWorkedMs(detail);
    return Math.max(0, Math.floor(ms / 60000));
  }, [detail]);

  const detailLoggedMinutes = useMemo(
    () => dayTasks.reduce((acc, t) => acc + (t.minutes || 0), 0),
    [dayTasks],
  );

  const detailRemainingMinutes = useMemo(() => {
    if (!detail) return 0;
    const cap = Math.max(0, detailWorkedMinutes - 60);
    const remaining = cap - detailLoggedMinutes;
    return remaining > 0 ? remaining : 0;
  }, [detail, detailWorkedMinutes, detailLoggedMinutes]);

  const canLogTasks = Boolean(u?.id && employeeId === (u?.id || ""));

  // Computed leave set: approved leaves + days without punches (working days only, not weekends/holidays, and not in the future)
  const leaveSet = useMemo(() => {
    const s = new Set(summary?.leaveDates || []);
    const employmentStart =
      summary?.employmentStart &&
      !Number.isNaN(new Date(summary.employmentStart).getTime())
        ? startOfDay(new Date(summary.employmentStart))
        : null;
    // Drop any leaves that fall before employment started
    if (employmentStart) {
      for (const key of Array.from(s)) {
        const d = new Date(key);
        if (!Number.isNaN(d.getTime()) && startOfDay(d) < employmentStart) {
          s.delete(key);
        }
      }
    }
    // mark missing punch days as leave (for the selected month)
    const [y, m] = month.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0); // end of month
    const today = new Date();
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (employmentStart && startOfDay(d) < employmentStart) continue;
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const key = toISODateOnly(d);
      const inFuture = d > today;
      if (isWeekend || inFuture) continue;
      if ((summary?.bankHolidays || []).includes(key)) continue;
      if (!byDate.get(key)) s.add(key);
    }
    // If there is any attendance record for a day, do not mark it as leave
    for (const [key, rec] of byDate.entries()) {
      if (rec) s.delete(key);
    }
    return s;
  }, [summary, byDate, month]);

  const holidaySet = useMemo(
    () => new Set(summary?.bankHolidays || []),
    [summary],
  );

  const holidayNameMap = useMemo(() => {
    const map = new Map<string, string>();
    (summary?.bankHolidayDetails || []).forEach((h) => {
      if (!h?.date) return;
      map.set(h.date, h.name || "Holiday");
    });
    return map;
  }, [summary?.bankHolidayDetails]);

  const employmentStart = useMemo(() => {
    if (!summary?.employmentStart) return null;
    const d = new Date(summary.employmentStart);
    if (Number.isNaN(d.getTime())) return null;
    return startOfDay(d);
  }, [summary?.employmentStart]);

  // Only three colors: red (<8h), green (>=8h with 10min grace), yellow for holidays
  function colorFor(ms?: number) {
    const graceHours = 8 - 10 / 60; // 7h 50m
    const h = (ms || 0) / 3600000;
    // Red when under grace threshold
    if (h < graceHours) return "bg-error/60";
    // Green when at or above 7h50m
    return "bg-success/80";
  }

  const legend = [
    { label: "< 8h", cls: "bg-error/60" },
    { label: "≥ 8h (7h50m grace)", cls: "bg-success/80" },
    { label: "Holiday", cls: "bg-accent/30" },
  ];

  // Month navigation
  function shiftMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0",
    )}`;
    setMonth(newMonth);
  }
  function jumpToday() {
    const d = new Date();
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0",
    )}`;
    setMonth(newMonth);
  }
  async function refreshAll() {
    if (!employeeId) return;
    await load(employeeId);
    try {
      const res = await api.get(`/attendance/report/${employeeId}`, {
        params: { month },
      });
      console.log("ress", res);
      setSummary(res.data.report);
    } catch {
      /* ignore */
    }
  }

  function closeDetail() {
    detailKeyRef.current = null;
    detailEmployeeIdRef.current = null;
    setDetail(null);
    setDayTasks([]);
    setTasksLoading(false);
    setTasksErr(null);
    setTaskFormOpen(false);
    setTaskFormErr(null);
    setTaskOptionsErr(null);
    setTaskOptions([]);
    setEditForm({ firstIn: "", lastOut: "" });
    setEditErr(null);
    setEditSaving(false);
  }

  function openCreateModal(date: Date, selectedEmployeeId: string) {
    const key = toISODateOnly(date);
    createEmployeeIdRef.current = selectedEmployeeId;
    setCreateModal({
      open: true,
      date: key,
      firstIn: "",
      lastOut: "",
      saving: false,
      error: null,
    });
  }

  function closeCreateModal() {
    createEmployeeIdRef.current = null;
    setCreateModal({
      open: false,
      date: "",
      firstIn: "",
      lastOut: "",
      saving: false,
      error: null,
    });
  }

  function openNotifyModalForDate(
    dateInput: Date | string,
    targetEmployee: string,
    requestType: "ADD" | "EDIT",
  ) {
    if (!targetEmployee) {
      toast.error("Select an employee first.");
      return;
    }
    const parsedDate = new Date(dateInput);
    const key = Number.isNaN(parsedDate.getTime())
      ? typeof dateInput === "string" && dateInput.length >= 10
        ? dateInput.slice(0, 10)
        : toISODateOnly(new Date())
      : toISODateOnly(parsedDate);
    setNotifyModal({
      open: true,
      date: key,
      employeeId: targetEmployee,
      type: requestType,
      firstIn: "",
      lastOut: "",
      message: "",
      saving: false,
      error: null,
    });
  }

  function closeNotifyModal() {
    setNotifyModal({
      open: false,
      date: "",
      employeeId: "",
      type: "EDIT",
      firstIn: "",
      lastOut: "",
      message: "",
      saving: false,
      error: null,
    });
  }

  async function handleNotifyAdminRequest() {
    if (!notifyModal.open) return;
    if (!notifyModal.date || !notifyModal.employeeId) {
      setNotifyModal((prev) => ({
        ...prev,
        error: "Missing information for this request.",
      }));
      return;
    }
    const first = notifyModal.firstIn.trim();
    const last = notifyModal.lastOut.trim();
    if (!first || !last) {
      setNotifyModal((prev) => ({
        ...prev,
        error: "Enter both punch-in and punch-out times.",
      }));
      return;
    }
    const firstMinutes = parseTimeInputMinutes(first);
    const lastMinutes = parseTimeInputMinutes(last);
    if (firstMinutes === null || lastMinutes === null) {
      setNotifyModal((prev) => ({
        ...prev,
        error: "Use valid 24-hour times (HH:MM).",
      }));
      return;
    }
    if (lastMinutes <= firstMinutes) {
      setNotifyModal((prev) => ({
        ...prev,
        error: "Punch-out must be later than punch-in.",
      }));
      return;
    }
    const tzDate = new Date(`${notifyModal.date}T00:00:00`);
    const timezoneOffsetMinutes = -tzDate.getTimezoneOffset();
    try {
      setNotifyModal((prev) => ({ ...prev, saving: true, error: null }));
      await api.post("/attendance/manual-request", {
        date: notifyModal.date,
        employeeId: notifyModal.employeeId,
        message: notifyModal.message.trim(),
        type: notifyModal.type,
        punchIn: first,
        punchOut: last,
        timezoneOffsetMinutes,
      });
      toast.success("Admin notified");
      closeNotifyModal();
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to notify admin";
      setNotifyModal((prev) => ({ ...prev, saving: false, error: msg }));
      toast.error(msg);
    }
  }

  async function handleCreateAttendance() {
    if (!createModal.open) return;
    const first = createModal.firstIn.trim();
    const last = createModal.lastOut.trim();
    if (!first || !last) {
      setCreateModal((prev) => ({
        ...prev,
        error: "Enter both punch-in and punch-out times.",
      }));
      return;
    }
    const firstMinutes = parseTimeInputMinutes(first);
    const lastMinutes = parseTimeInputMinutes(last);
    if (firstMinutes === null || lastMinutes === null) {
      setCreateModal((prev) => ({
        ...prev,
        error: "Use valid 24-hour times (HH:MM).",
      }));
      return;
    }
    if (lastMinutes <= firstMinutes) {
      setCreateModal((prev) => ({
        ...prev,
        error: "Punch-out must be later than punch-in.",
      }));
      return;
    }
    const targetEmployeeId = createEmployeeIdRef.current || employeeId;
    if (!targetEmployeeId) {
      setCreateModal((prev) => ({
        ...prev,
        error: "Unable to determine selected employee.",
      }));
      return;
    }
    const tzDate = new Date(`${createModal.date}T00:00:00`);
    const timezoneOffsetMinutes = -tzDate.getTimezoneOffset();
    try {
      setCreateModal((prev) => ({ ...prev, saving: true, error: null }));
      await api.post(`/attendance/manual/${targetEmployeeId}`, {
        date: createModal.date,
        firstIn: first,
        lastOut: last,
        timezoneOffsetMinutes,
      });
      toast.success("Attendance recorded");
      closeCreateModal();
      await refreshAll();
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to record attendance";
      setCreateModal((prev) => ({
        ...prev,
        saving: false,
        error: msg,
      }));
      toast.error(msg);
    }
  }

  async function loadDayTasks(
    dateKey: string,
    targetEmployeeId: string,
    showLoader = true,
  ) {
    const requestId = (detailTasksRequestId.current += 1);
    if (showLoader) setTasksLoading(true);
    setTasksErr(null);
    const isCurrent = () =>
      detailKeyRef.current === dateKey &&
      detailTasksRequestId.current === requestId;
    try {
      const params: Record<string, string> = { date: dateKey };
      if (targetEmployeeId) params.employeeId = targetEmployeeId;
      const res = await api.get("/projects/tasks/worked", { params });
      if (!isCurrent()) return;
      setDayTasks(res.data.tasks || []);
    } catch (e: any) {
      if (!isCurrent()) return;
      setTasksErr(e?.response?.data?.error || "Failed to load tasks");
      setDayTasks([]);
    } finally {
      if (isCurrent() && showLoader) {
        setTasksLoading(false);
      }
    }
  }

  async function loadAssignedTasks(dateKey: string) {
    setTaskOptionsLoading(true);
    setTaskOptionsErr(null);
    try {
      const res = await api.get("/projects/tasks/assigned");
      if (detailKeyRef.current !== dateKey) return;
      const list: TaskOption[] = (res.data.tasks || [])
        .map((t: any) => {
          const project =
            typeof t.project === "string"
              ? { _id: String(t.project), title: "" }
              : t.project || {};
          const projectId = String(project._id || "").trim();
          if (!projectId) return null;
          return {
            id: String(t._id),
            title: t.title || "Untitled Task",
            projectId,
            projectTitle: project.title || "",
          } as TaskOption;
        })
        .filter((x: TaskOption | null): x is TaskOption => Boolean(x));
      setTaskOptions(list);
    } catch (e: any) {
      if (detailKeyRef.current !== dateKey) return;
      setTaskOptionsErr(
        e?.response?.data?.error || "Failed to load assigned tasks",
      );
      setTaskOptions([]);
    } finally {
      if (detailKeyRef.current === dateKey) {
        setTaskOptionsLoading(false);
      }
    }
  }

  function toggleTaskForm(open?: boolean) {
    const next = typeof open === "boolean" ? open : !taskFormOpen;
    setTaskFormOpen(next);
    if (next) {
      setTaskFormErr(null);
    }
  }

  async function openDetailDay(rec: AttRecord, selectedEmployeeId: string) {
    const dateKey = toISODateOnly(new Date(rec.date));
    detailKeyRef.current = dateKey;
    detailEmployeeIdRef.current = selectedEmployeeId;
    setDetail(rec);
    setTaskFormOpen(false);
    setTaskFormErr(null);
    setTaskOptionsErr(null);
    setTaskForm({
      taskId: "",
      hours: "",
      minutes: "",
    });
    setDayTasks([]);
    setTasksErr(null);
    setEditForm({
      firstIn: toTimeInputValue(rec.firstPunchIn),
      lastOut: toTimeInputValue(rec.lastPunchOut),
    });
    setEditErr(null);
    setEditSaving(false);
    const targetEmployeeId = selectedEmployeeId || u?.id || "";
    loadDayTasks(dateKey, targetEmployeeId, true);
    if (u?.id && targetEmployeeId === u.id) {
      loadAssignedTasks(dateKey);
    } else {
      setTaskOptions([]);
      setTaskOptionsLoading(false);
      setTaskOptionsErr(null);
    }
  }

  async function handleAddTaskLog() {
    if (!detail || !u?.id || employeeId !== u.id) return;
    const selectedTask = taskOptions.find((t) => t.id === taskForm.taskId);
    if (!selectedTask) {
      setTaskFormErr("Select a task to log time against.");
      return;
    }
    const minutes = computeMinutes(taskForm);
    if (!minutes) {
      setTaskFormErr("Enter the time spent (hours or minutes).");
      return;
    }
    if (minutes > detailRemainingMinutes) {
      setTaskFormErr(
        `You can log at most ${fmtMinutes(detailRemainingMinutes)} today.`,
      );
      return;
    }
    const dateKey = toISODateOnly(new Date(detail.date));
    const targetEmployeeId = employeeId || u.id || "";
    try {
      setTaskFormSaving(true);
      setTaskFormErr(null);
      await api.post(
        `/projects/${selectedTask.projectId}/tasks/${selectedTask.id}/time-at`,
        {
          minutes,
          date: dateKey,
        },
      );
      toast.success("Time logged successfully");
      setTaskForm((prev) => ({
        ...prev,
        hours: "",
        minutes: "",
      }));
      await loadDayTasks(dateKey, targetEmployeeId, true);
    } catch (e: any) {
      setTaskFormErr(
        e?.response?.data?.error || "Failed to log time for this task",
      );
    } finally {
      setTaskFormSaving(false);
    }
  }

  function resetEditForm() {
    if (!detail) return;
    setEditForm({
      firstIn: toTimeInputValue(detail.firstPunchIn),
      lastOut: toTimeInputValue(detail.lastPunchOut),
    });
    setEditErr(null);
  }

  async function handleSavePunchWindow() {
    if (!detail) return;
    const targetEmployeeId = detailEmployeeIdRef.current || employeeId;
    if (!targetEmployeeId) {
      setEditErr("Unable to determine selected employee.");
      return;
    }

    const first = editForm.firstIn.trim();
    const last = editForm.lastOut.trim();
    if (!first || !last) {
      setEditErr("Enter both punch-in and punch-out times.");
      return;
    }

    const firstMinutes = parseTimeInputMinutes(first);
    const lastMinutes = parseTimeInputMinutes(last);
    if (firstMinutes === null || lastMinutes === null) {
      setEditErr("Use valid 24-hour times (HH:MM).");
      return;
    }
    if (lastMinutes <= firstMinutes) {
      setEditErr("Punch-out must be later than punch-in.");
      return;
    }

    const dateKey = toISODateOnly(new Date(detail.date));
    const timezoneOffsetMinutes = -new Date(detail.date).getTimezoneOffset();
    try {
      setEditSaving(true);
      setEditErr(null);
      const res = await api.post(`/attendance/manual/${targetEmployeeId}`, {
        date: dateKey,
        firstIn: first,
        lastOut: last,
        timezoneOffsetMinutes,
      });
      const updated = res.data.attendance as AttRecord;
      setDetail(updated);
      setEditForm({
        firstIn: toTimeInputValue(updated.firstPunchIn),
        lastOut: toTimeInputValue(updated.lastPunchOut),
      });
      setRows((prev) =>
        prev.map((row) => {
          const key = toISODateOnly(new Date(row.date));
          return key === dateKey ? updated : row;
        }),
      );
      await refreshAll();
      toast.success("Attendance updated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update attendance";
      setEditErr(msg);
      toast.error(msg);
    } finally {
      setEditSaving(false);
    }
  }

  function fmtMinutes(mins?: number) {
    if (!mins || mins <= 0) return "-";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  }

  const weekHeaders = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();

  // Admin: employee search & filtered list
  const filteredEmployees = useMemo(() => {
    const q = empQuery.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q),
    );
  }, [empQuery, employees]);

  // Day-level filter predicate
  function passesDayFilters(date: Date, rec?: AttRecord) {
    if (!canViewOthers) return true; // only admins/hr see filters
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const key = toISODateOnly(date);
    const isLeave = leaveSet.has(key);
    const worked = rec ? inferWorkedMs(rec) : 0;
    const workedH = worked / 3600000;

    if (!showWeekends && isWeekend) return false;
    if (!showLeaves && isLeave) return false;
    if (onlyWorked && worked <= 0) return false;
    if (workedH < minHours) return false;
    return true;
  }

  return (
    <div className="space-y-8">
      {/* Monthly report */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold">Monthly Report</h3>
          <div className="hidden md:flex items-center gap-2">
            {legend.map((b, i) => (
              <div key={i} className="flex items-center gap-1 text-xs">
                <div className={`h-3 w-3 rounded ${b.cls}`} />
                <span className="text-muted-foreground">{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canViewOthers && (
            <>
              <input
                value={empQuery}
                onChange={(e) => setEmpQuery(e.target.value)}
                placeholder="Search employee…"
                className="h-10 w-48 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
              />
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="h-10 rounded-md border border-border bg-surface px-3"
              >
                {filteredEmployees.map((emp, i) => (
                  <option key={i} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>

              {/* Admin day filters */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showWeekends}
                    onChange={(e) => setShowWeekends(e.target.checked)}
                  />
                  Show weekends
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={onlyWorked}
                    onChange={(e) => setOnlyWorked(e.target.checked)}
                  />
                  Only worked days
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  Min hours
                  <select
                    className="h-8 rounded-md border border-border bg-surface px-2"
                    value={minHours}
                    onChange={(e) => setMinHours(Number(e.target.value))}
                  >
                    <option value={0}>0</option>
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                    <option value={6}>6</option>
                    <option value={8}>8</option>
                  </select>
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showLeaves}
                    onChange={(e) => setShowLeaves(e.target.checked)}
                  />
                  Show leave days
                </label>
              </div>
            </>
          )}

          <div className="inline-flex rounded-md border border-border bg-surface overflow-hidden">
            <button
              onClick={() => shiftMonth(-1)}
              className="px-3 py-2 border-r border-border"
            >
              ← Prev
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-2 outline-none"
            />
            <button
              onClick={() => shiftMonth(1)}
              className="px-3 py-2 border-l border-border"
            >
              Next →
            </button>
          </div>
          <button
            onClick={jumpToday}
            className="rounded-md border border-border px-3 py-2"
          >
            Today
          </button>

          {summary && (
            <div className="text-sm ml-auto">
              <span className="text-muted-foreground">Worked Days:</span>{" "}
              {summary.workedDays}
              <span className="mx-2">•</span>
              <span className="text-muted-foreground">Leave Days:</span>{" "}
              {summary.leaveDays}
              {typeof summary.halfDayLeaves === "number" && (
                <>
                  <span className="mx-2">•</span>
                  <span className="text-muted-foreground">Half Days:</span>{" "}
                  {summary.halfDayLeaves}
                </>
              )}
              <span className="mx-2">•</span>
              <span className="text-muted-foreground">Total:</span>{" "}
              <span className="font-medium">{fmtDur(totalWorked)}</span>
            </div>
          )}
        </div>
      </section>

      {/* Heatmap */}
      <section className="rounded-lg border border-border bg-surface shadow-sm p-4">
        {err && (
          <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
            {err}
          </div>
        )}

        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            {/* Week headers: Sun → Sat */}
            <div className="grid grid-cols-7 gap-2 px-1 pb-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div
                  key={d}
                  className="text-xs text-muted-foreground text-center"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-2">
              {loading
                ? Array.from({ length: 42 }).map((_, i) => (
                    <div key={i} className="h-20 rounded bg-bg animate-pulse" />
                  ))
                : grid.map(({ date, inMonth, rec }) => {
                    const worked = rec ? inferWorkedMs(rec) : 0;
                    const key = toISODateOnly(date);
                    const beforeEmployment =
                      employmentStart && startOfDay(date) < employmentStart;
                    const isLeave = beforeEmployment
                      ? false
                      : leaveSet.has(key);
                    const isHoliday = holidaySet.has(key);
                    const holidayName = holidayNameMap.get(key) || "Holiday";
                    const dow = date.getDay();
                    const isWeekend = dow === 0 || dow === 6;
                    const showWeekendBlank = isWeekend && !rec;
                    const inFuture = date > today;
                    const color = beforeEmployment
                      ? "bg-bg"
                      : inMonth
                        ? isHoliday
                          ? "bg-accent/30" // yellow
                          : isWeekend || inFuture
                            ? "bg-bg" // grayish for weekends and upcoming days
                            : isLeave
                              ? "bg-error/60" // red for leave (kept within 3-colors)
                              : colorFor(worked) // red/green based on hours with grace
                        : "bg-bg";
                    const isToday = isSameDay(date, today);

                    // Apply filters (dim & disable instead of removing)
                    const hidden = canViewOthers
                      ? !passesDayFilters(date, rec)
                      : false;

                    const canCreate =
                      !rec &&
                      !hidden &&
                      !beforeEmployment &&
                      canEditPunches &&
                      inMonth &&
                      !inFuture;
                    const canRequestManual =
                      !rec &&
                      !hidden &&
                      !beforeEmployment &&
                      !canEditPunches &&
                      inMonth &&
                      !inFuture &&
                      !isWeekend &&
                      Boolean(selectedEmployeeId);
                    const isDisabled =
                      hidden || (!rec && !canCreate && !canRequestManual);

                    return (
                      <button
                        key={date.toISOString()}
                        onClick={() => {
                          if (hidden) return;
                          if (rec) {
                            openDetailDay(rec, selectedEmployeeId);
                          } else if (canCreate) {
                            openCreateModal(date, selectedEmployeeId);
                          } else if (canRequestManual) {
                            openNotifyModalForDate(
                              date,
                              selectedEmployeeId,
                              "ADD",
                            );
                          }
                        }}
                        disabled={isDisabled}
                        className={[
                          "relative h-20 rounded border p-2 text-left transition",
                          "border-border/60",
                          color,
                          !inMonth ? "opacity-70" : "",
                          hidden ? "opacity-25 pointer-events-none" : "",
                          (rec || canCreate || canRequestManual) && !hidden
                            ? "hover:ring-2 hover:ring-primary"
                            : "",
                          isToday ? "outline outline-2 outline-primary/70" : "",
                        ].join(" ")}
                        title={(() => {
                          const base = beforeEmployment
                            ? `${fmtDate(date)} — Not joined yet`
                            : isHoliday
                              ? `${fmtDate(date)} — ${holidayName}`
                              : isLeave
                                ? `${fmtDate(date)} — Leave`
                                : rec
                                  ? `${fmtDate(date)} — ${fmtDur(worked)}`
                                  : showWeekendBlank
                                    ? fmtDate(date)
                                    : `${fmtDate(date)} — No attendance`;
                          if (!rec && canCreate) {
                            return `${base}. Click to record manual punches.`;
                          }
                          if (!rec && canRequestManual) {
                            return `${base}. Click to notify an admin for corrections.`;
                          }
                          return base;
                        })()}
                      >
                        {/* Day number (top-right) */}
                        <div className="absolute top-1 right-1 text-[11px] font-medium opacity-80">
                          {date.getDate()}
                        </div>

                        {/* Content */}
                        {rec && !hidden && (
                          <div className="mt-5 space-y-1 text-[11px] leading-tight">
                            <div>In: {fmtTime(rec.firstPunchIn)}</div>
                            <div>Out: {fmtTime(rec.lastPunchOut)}</div>
                            <div className="inline-flex rounded-full bg-white/70 px-2 py-[2px] text-[10px] font-medium">
                              {fmtDur(worked)}
                            </div>
                          </div>
                        )}
                        {!rec && !hidden && !showWeekendBlank && (
                          <div className="mt-5 space-y-1 text-[11px] leading-tight text-muted-foreground">
                            {beforeEmployment ? (
                              <div className="font-medium text-muted-foreground">
                                Not joined
                              </div>
                            ) : isLeave && showLeaves ? (
                              <div className="font-medium text-error">
                                Leave
                              </div>
                            ) : isHoliday ? (
                              <div className="font-medium text-accent">
                                {holidayName}
                              </div>
                            ) : null}
                            <div
                              className={
                                canCreate || canRequestManual
                                  ? "text-foreground font-medium"
                                  : "text-muted-foreground"
                              }
                            >
                              {beforeEmployment
                                ? "No attendance"
                                : canRequestManual
                                  ? "Notify admin"
                                  : ""}
                            </div>
                          </div>
                        )}
                        {rec?.autoPunchOut && (
                          <div className="absolute bottom-1 left-1 text-[10px] text-error">
                            !
                          </div>
                        )}
                      </button>
                    );
                  })}
            </div>

            {/* Legend (mobile) */}
            <div className="mt-4 flex md:hidden items-center gap-2">
              {[
                ...legend.filter((l) => l.label !== "Leave"),
                ...(showLeaves
                  ? legend.filter((l) => l.label === "Leave")
                  : []),
              ].map((b, i) => (
                <div key={i} className="flex items-center gap-1 text-xs">
                  <div className={`h-3 w-3 rounded ${b.cls}`} />
                  <span className="text-muted-foreground">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Monthly list (admin/hr/manager) */}
      {/* Report list moved to dedicated Report page */}

      {createModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 -mt-[32px]"
            onClick={() => (!createModal.saving ? closeCreateModal() : null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h4 className="text-lg font-semibold mb-1">Record Attendance</h4>
            <div className="text-sm text-muted-foreground mb-3">
              {fmtDate(createModal.date)}
            </div>
            <div className="space-y-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Punch in</span>
                <input
                  type="time"
                  className="h-9 rounded-md border border-border bg-white px-2"
                  value={createModal.firstIn}
                  onChange={(e) =>
                    setCreateModal((prev) => ({
                      ...prev,
                      firstIn: e.target.value,
                    }))
                  }
                  disabled={createModal.saving}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Punch out</span>
                <input
                  type="time"
                  className="h-9 rounded-md border border-border bg-white px-2"
                  value={createModal.lastOut}
                  onChange={(e) =>
                    setCreateModal((prev) => ({
                      ...prev,
                      lastOut: e.target.value,
                    }))
                  }
                  disabled={createModal.saving}
                />
              </label>
            </div>
            {createModal.error && (
              <div className="mt-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
                {createModal.error}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={() =>
                  !createModal.saving ? closeCreateModal() : null
                }
                disabled={createModal.saving}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary px-4 py-2 text-sm text-white disabled:opacity-60"
                onClick={handleCreateAttendance}
                disabled={createModal.saving}
              >
                {createModal.saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {notifyModal.open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 -mt-[32px]"
            onClick={() => (!notifyModal.saving ? closeNotifyModal() : null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h4 className="text-lg font-semibold mb-1">Notify Admin</h4>
            <div className="text-sm text-muted-foreground mb-3">
              {fmtDate(notifyModal.date)} •{" "}
              {notifyModal.type === "ADD" ? "Add punches" : "Edit punches"}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">Punch in</span>
                <input
                  type="time"
                  className="h-9 rounded-md border border-border bg-white px-2"
                  value={notifyModal.firstIn}
                  onChange={(e) =>
                    setNotifyModal((prev) => ({
                      ...prev,
                      firstIn: e.target.value,
                    }))
                  }
                  disabled={notifyModal.saving}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">Punch out</span>
                <input
                  type="time"
                  className="h-9 rounded-md border border-border bg-white px-2"
                  value={notifyModal.lastOut}
                  onChange={(e) =>
                    setNotifyModal((prev) => ({
                      ...prev,
                      lastOut: e.target.value,
                    }))
                  }
                  disabled={notifyModal.saving}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Add the actual punch-in and punch-out times you want the admin to
              record.
            </p>
            <label className="flex flex-col gap-2 text-sm mt-3">
              <span className="text-muted-foreground">Message</span>
              <textarea
                className="min-h-[96px] rounded-md border border-border bg-white px-3 py-2"
                placeholder="Describe what needs to be updated (e.g. actual punch-in/out times)."
                value={notifyModal.message}
                onChange={(e) =>
                  setNotifyModal((prev) => ({
                    ...prev,
                    message: e.target.value,
                  }))
                }
                disabled={notifyModal.saving}
              />
            </label>
            {notifyModal.error && (
              <div className="mt-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
                {notifyModal.error}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={() =>
                  !notifyModal.saving ? closeNotifyModal() : null
                }
                disabled={notifyModal.saving}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary px-4 py-2 text-sm text-white disabled:opacity-60"
                onClick={handleNotifyAdminRequest}
                disabled={
                  notifyModal.saving ||
                  !notifyModal.firstIn ||
                  !notifyModal.lastOut
                }
              >
                {notifyModal.saving ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 -mt-[32px]"
            onClick={closeDetail}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h4 className="text-lg font-semibold mb-1">Attendance Details</h4>
            <div className="text-sm text-muted-foreground mb-3">
              {fmtDate(detail.date)}
            </div>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <div className="text-muted-foreground">Punch in</div>
              <div>{fmtTime(detail.firstPunchIn)}</div>
              <div className="text-muted-foreground">Punch out</div>
              <div>{fmtTime(detail.lastPunchOut)}</div>
              {detail.firstPunchInLocation && (
                <>
                  <div className="text-muted-foreground">Punch-in location</div>
                  <div>{detail.firstPunchInLocation}</div>
                </>
              )}
              {detail.lastPunchInLocation && (
                <>
                  <div className="text-muted-foreground">
                    Punch-out location
                  </div>
                  <div>{detail.lastPunchInLocation}</div>
                </>
              )}
              <div className="text-muted-foreground">Worked</div>
              <div>{fmtDur(inferWorkedMs(detail))}</div>
              {detail.autoPunchOut && (
                <div className="col-span-2 mt-2 text-xs text-error">
                  Auto punched out
                </div>
              )}
            </div>
            {canEditPunches && (
              <div className="mt-4 border-t border-border/60 pt-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Edit Punch Times</div>
                  <button
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-60"
                    onClick={resetEditForm}
                    disabled={editSaving}
                  >
                    Reset
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Punch in</span>
                    <input
                      type="time"
                      value={editForm.firstIn}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          firstIn: e.target.value,
                        }))
                      }
                      className="h-9 rounded-md border border-border bg-white px-2"
                      disabled={editSaving}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Punch out</span>
                    <input
                      type="time"
                      value={editForm.lastOut}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          lastOut: e.target.value,
                        }))
                      }
                      className="h-9 rounded-md border border-border bg-white px-2"
                      disabled={editSaving}
                    />
                  </label>
                </div>
                {editErr && (
                  <div className="mt-2 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
                    {editErr}
                  </div>
                )}
                <div className="mt-3 flex justify-end">
                  <button
                    className="rounded-md bg-primary px-4 py-2 text-sm text-white disabled:opacity-60"
                    onClick={handleSavePunchWindow}
                    disabled={editSaving}
                  >
                    {editSaving ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </div>
            )}
            {!canEditPunches &&
              (() => {
                const detailDate = new Date(detail.date);
                const isWeekendDetail =
                  Number.isNaN(detailDate.getTime()) ||
                  detailDate.getDay() === 0 ||
                  detailDate.getDay() === 6;
                if (isWeekendDetail) {
                  return (
                    <div className="mt-4 border-t border-border/60 pt-4">
                      <div className="text-xs text-muted-foreground">
                        Weekend entries cannot be escalated. Reach out to your
                        admin offline if this day needs changes.
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="mt-4 border-t border-border/60 pt-4 space-y-3">
                    <div className="text-xs text-muted-foreground">
                      Only admins can change punch times. Need an update? Notify
                      an admin with the details.
                    </div>
                    <button
                      className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:border-primary"
                      onClick={() =>
                        openNotifyModalForDate(
                          detail.date,
                          detailEmployeeIdRef.current || selectedEmployeeId,
                          "EDIT",
                        )
                      }
                      disabled={notifyModal.saving}
                    >
                      Notify admin
                    </button>
                  </div>
                );
              })()}
            <div className="mt-4">
              <div className="text-sm font-medium mb-2">Tasks</div>
              {tasksLoading && (
                <div className="text-sm text-muted-foreground">
                  Loading tasks…
                </div>
              )}
              {tasksErr && (
                <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                  {tasksErr}
                </div>
              )}
              {!tasksLoading && !tasksErr && dayTasks.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No tasks logged for this day.
                </div>
              )}
              {!tasksLoading && !tasksErr && dayTasks.length > 0 && (
                <ul className="space-y-2">
                  {dayTasks.map((t) => (
                    <li
                      key={t._id}
                      className="flex items-start justify-between gap-3 text-sm"
                    >
                      <div>
                        <div className="font-medium">{t.title}</div>
                        {t.project?.title && (
                          <div className="text-muted-foreground text-xs">
                            {t.project.title}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 inline-flex rounded-full bg-white/70 px-2 py-[2px] text-[11px] font-medium">
                        {fmtMinutes(t.minutes)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {detail && canLogTasks && (
              <div className="mt-4 border-t border-border/60 pt-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Add Task Log</div>
                  <div className="text-xs text-muted-foreground">
                    Remaining:{" "}
                    {tasksLoading
                      ? "Loading…"
                      : fmtMinutes(detailRemainingMinutes)}
                  </div>
                </div>
                {!tasksLoading && detailRemainingMinutes <= 0 ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    All worked time for this day is already logged.
                  </div>
                ) : (
                  <>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        Log time against your assigned tasks.
                      </div>
                      <button
                        className="text-xs font-medium text-primary underline disabled:opacity-60"
                        onClick={() => toggleTaskForm()}
                        disabled={taskFormSaving || tasksLoading}
                      >
                        {taskFormOpen ? "Hide form" : "Log time"}
                      </button>
                    </div>
                    {taskFormOpen && (
                      <div className="mt-3 space-y-3">
                        {taskOptionsLoading && (
                          <div className="text-xs text-muted-foreground">
                            Loading task list…
                          </div>
                        )}
                        {taskOptionsErr && (
                          <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
                            {taskOptionsErr}
                          </div>
                        )}
                        {!taskOptionsLoading && taskOptions.length === 0 ? (
                          <div className="text-xs text-muted-foreground">
                            No assigned tasks available. Create one from the
                            Projects section first.
                          </div>
                        ) : (
                          <>
                            {taskFormErr && (
                              <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
                                {taskFormErr}
                              </div>
                            )}
                            <label className="block text-xs">
                              <span className="text-muted-foreground">
                                Task
                              </span>
                              <select
                                className="mt-1 h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
                                value={taskForm.taskId}
                                onChange={(e) =>
                                  setTaskForm((prev) => ({
                                    ...prev,
                                    taskId: e.target.value,
                                  }))
                                }
                                disabled={taskOptionsLoading || taskFormSaving}
                              >
                                {taskOptions.map((opt) => (
                                  <option key={opt.id} value={opt.id}>
                                    {opt.title}
                                    {opt.projectTitle
                                      ? ` — ${opt.projectTitle}`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="flex items-center gap-3">
                              <label className="flex flex-col text-xs">
                                <span className="text-muted-foreground">
                                  Hours
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.25"
                                  className="mt-1 h-9 w-24 rounded-md border border-border bg-white px-2 text-sm"
                                  value={taskForm.hours}
                                  onChange={(e) =>
                                    setTaskForm((prev) => ({
                                      ...prev,
                                      hours: e.target.value,
                                    }))
                                  }
                                  disabled={taskFormSaving}
                                />
                              </label>
                              <label className="flex flex-col text-xs">
                                <span className="text-muted-foreground">
                                  Minutes
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  max="59"
                                  className="mt-1 h-9 w-24 rounded-md border border-border bg-white px-2 text-sm"
                                  value={taskForm.minutes}
                                  onChange={(e) =>
                                    setTaskForm((prev) => ({
                                      ...prev,
                                      minutes: e.target.value,
                                    }))
                                  }
                                  disabled={taskFormSaving}
                                />
                              </label>
                            </div>
                            <div className="flex justify-end">
                              <button
                                className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
                                onClick={handleAddTaskLog}
                                disabled={
                                  taskFormSaving ||
                                  tasksLoading ||
                                  taskOptionsLoading ||
                                  taskOptions.length === 0
                                }
                              >
                                {taskFormSaving ? "Saving…" : "Add Log"}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button
                className="rounded-md border border-border px-4 py-2"
                onClick={closeDetail}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
