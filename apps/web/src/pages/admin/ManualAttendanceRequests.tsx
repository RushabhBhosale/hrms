import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { formatMinutesLabel } from "../../lib/time";
import { getEmployee } from "../../lib/auth";
import { toast } from "react-hot-toast";

type ManualRequest = {
  id: string | null;
  employee: {
    id: string | null;
    name: string;
    email: string;
  } | null;
  date: string | null;
  note: string;
  adminNote: string;
  status: "PENDING" | "ACKED" | "COMPLETED" | "CANCELLED";
  requestedAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  requestedBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  resolvedBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  autoPunchOut: boolean;
  autoPunchOutAt: string | null;
  firstPunchIn: string | null;
  lastPunchOut: string | null;
  workedMs: number;
};

type TaskOption = {
  id: string;
  title: string;
  projectId: string;
  projectTitle: string;
};

type MissingIssue = {
  date: string;
  type: "missingPunchOut" | "autoPunch" | "noAttendance";
  autoPunchOutAt?: string;
};

function toTimeInput(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function fmtDay(value: string | null) {
  if (!value) return "—";
  const parts = value.split("-");
  if (parts.length === 3) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
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

function fmtIssueHint(issue: MissingIssue) {
  if (issue.type === "autoPunch") {
    if (issue.autoPunchOutAt) {
      const time = new Date(issue.autoPunchOutAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `System auto punch-out at ${time}. Set the correct punch-out time or log work.`;
    }
    return "System closed the day automatically. Set the correct punch-out time or log work.";
  }
  if (issue.type === "noAttendance")
    return "Apply leave or log working time to close the day.";
  return "Set the punch-out time and log remaining tasks.";
}

export default function ManualAttendanceRequests() {
  const me = getEmployee();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<ManualRequest[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selfIssues, setSelfIssues] = useState<MissingIssue[]>([]);
  const [selfLoading, setSelfLoading] = useState(true);
  const [selfErr, setSelfErr] = useState<string | null>(null);

  const [fillModal, setFillModal] = useState<{
    request: ManualRequest | null;
    punchIn: string;
    punchOut: string;
    breakMinutes: string;
    totalMinutes: string;
    adminNote: string;
    saving: boolean;
    error: string | null;
  }>({
    request: null,
    punchIn: "",
    punchOut: "",
    breakMinutes: "60",
    totalMinutes: "",
    adminNote: "",
    saving: false,
    error: null,
  });

  const [logModal, setLogModal] = useState<{
    request: ManualRequest | null;
    mode: "existing" | "new";
    taskId: string;
    minutes: string;
    note: string;
    title: string;
    saving: boolean;
    error: string | null;
    loading: boolean;
    tasks: TaskOption[];
    personalProjectId: string | null;
  }>({
    request: null,
    mode: "existing",
    taskId: "",
    minutes: "60",
    note: "",
    title: "",
    saving: false,
    error: null,
    loading: false,
    tasks: [],
    personalProjectId: null,
  });

  const [leaveModal, setLeaveModal] = useState<{
    request: ManualRequest | null;
    startDate: string;
    endDate: string;
    type: "PAID" | "CASUAL" | "SICK" | "UNPAID";
    reason: string;
    saving: boolean;
    error: string | null;
  }>({
    request: null,
    startDate: "",
    endDate: "",
    type: "PAID",
    reason: "",
    saving: false,
    error: null,
  });
  const [selfPunchModal, setSelfPunchModal] = useState<{
    date: string;
    time: string;
    open: boolean;
    saving: boolean;
    error: string | null;
  }>({
    date: "",
    time: "",
    open: false,
    saving: false,
    error: null,
  });

  useEffect(() => {
    void loadRequests();
    void loadSelfIssues();
  }, []);

  async function loadRequests() {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get("/attendance/manual-requests");
      setRequests(res.data?.requests || []);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load manual requests");
    } finally {
      setLoading(false);
    }
  }

  async function loadSelfIssues() {
    try {
      setSelfErr(null);
      setSelfLoading(true);
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
            return {
              date,
              type,
              autoPunchOutAt:
                typeof issue?.autoPunchOutAt === "string"
                  ? issue.autoPunchOutAt
                  : undefined,
            } as MissingIssue;
          })
          .filter(Boolean) as MissingIssue[];
      } else if (Array.isArray(payload.days)) {
        issues = (payload.days as string[]).map((date) => ({
          date,
          type: "missingPunchOut",
        }));
      }
      setSelfIssues(issues);
    } catch (e: any) {
      setSelfErr(
        e?.response?.data?.error || "Failed to load pending attendance issues"
      );
    } finally {
      setSelfLoading(false);
    }
  }

  async function refreshRequests() {
    try {
      setRefreshing(true);
      const res = await api.get("/attendance/manual-requests");
      setRequests(res.data?.requests || []);
      await loadSelfIssues();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to refresh requests");
    } finally {
      setRefreshing(false);
    }
  }

  function openFillModal(req: ManualRequest) {
    setFillModal({
      request: req,
      punchIn: toTimeInput(req.firstPunchIn),
      punchOut: toTimeInput(req.lastPunchOut),
      breakMinutes: "60",
      totalMinutes: req.workedMs ? Math.round(req.workedMs / 600) / 10 + "" : "",
      adminNote: req.adminNote || "",
      saving: false,
      error: null,
    });
  }

  function closeFillModal() {
    setFillModal((prev) => ({ ...prev, request: null, saving: false, error: null }));
  }

  function openLogModal(req: ManualRequest) {
    setLogModal({
      request: req,
      mode: "existing",
      taskId: "",
      minutes: "60",
      note: "",
      title: "",
      saving: false,
      error: null,
      loading: true,
      tasks: [],
      personalProjectId: null,
    });
    void loadTaskOptions(req);
  }

  function closeLogModal() {
    setLogModal((prev) => ({ ...prev, request: null, saving: false, error: null }));
  }

  async function loadTaskOptions(req: ManualRequest) {
    if (!req.employee?.id) {
      setLogModal((prev) => ({ ...prev, loading: false }));
      return;
    }
    try {
      const [tasksRes, personalRes] = await Promise.all([
        api.get("/projects/tasks/assigned", {
          params: { employeeId: req.employee.id },
        }),
        api.get("/projects/personal"),
      ]);
      const rawTasks = tasksRes.data?.tasks || [];
      const tasks: TaskOption[] = rawTasks.map((t: any) => {
        const proj = t.project || {};
        const projectId = typeof proj === "string" ? proj : proj?._id || "";
        return {
          id: String(t._id),
          title: t.title || "Untitled Task",
          projectId,
          projectTitle:
            typeof proj === "string"
              ? ""
              : proj?.title || "",
        };
      });
      const personalId = personalRes.data?.project?._id || null;
      setLogModal((prev) => ({
        ...prev,
        loading: false,
        tasks,
        personalProjectId: personalId,
      }));
    } catch (e: any) {
      setLogModal((prev) => ({
        ...prev,
        loading: false,
        error:
          e?.response?.data?.error || "Failed to load tasks for this employee",
      }));
    }
  }

  async function acknowledgeIfNeeded(req: ManualRequest) {
    if (!req.id || req.status !== "PENDING") return;
    try {
      await api.patch(`/attendance/manual-request/${req.id}/status`, {
        status: "ACKED",
      });
      await refreshRequests();
    } catch (e: any) {
      const message =
        e?.response?.data?.error || "Failed to acknowledge manual request";
      toast.error(message);
    }
  }

  async function handleFillSubmit() {
    if (!fillModal.request?.id) return;
    const req = fillModal.request;
    setFillModal((prev) => ({ ...prev, saving: true, error: null }));
    try {
      await acknowledgeIfNeeded(req);
      await api.post(`/attendance/manual-request/${req.id}/resolve`, {
        firstPunchIn: fillModal.punchIn,
        lastPunchOut: fillModal.punchOut,
        breakMinutes: fillModal.breakMinutes || undefined,
        totalMinutes: fillModal.totalMinutes || undefined,
        adminNote: fillModal.adminNote || undefined,
      });
      toast.success("Attendance updated successfully");
      closeFillModal();
      await refreshRequests();
    } catch (e: any) {
      const message =
        e?.response?.data?.error || "Failed to update attendance for the day";
      setFillModal((prev) => ({ ...prev, error: message, saving: false }));
    }
  }

  async function updateStatus(req: ManualRequest, status: "PENDING" | "ACKED" | "CANCELLED") {
    if (!req.id) return;
    try {
      await api.patch(`/attendance/manual-request/${req.id}/status`, {
        status,
      });
      await refreshRequests();
      toast.success(`Request marked ${status.toLowerCase()}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to update request status");
    }
  }

  async function submitLog() {
    const state = logModal;
    const req = state.request;
    if (!req?.id || !req.employee?.id) return;
    if (!state.minutes || parseInt(state.minutes, 10) <= 0) {
      setLogModal((prev) => ({
        ...prev,
        error: "Minutes must be greater than zero",
      }));
      return;
    }
    setLogModal((prev) => ({ ...prev, saving: true, error: null }));
    try {
      await acknowledgeIfNeeded(req);
      const minutes = parseInt(state.minutes, 10);
      let taskId = state.taskId;
      let projectId = "";

      if (state.mode === "existing") {
        if (!state.taskId) {
          throw new Error("Select a task to log time against");
        }
        const match = state.tasks.find((t) => t.id === state.taskId);
        if (!match) throw new Error("Selected task not found");
        projectId = match.projectId;
      } else {
        if (!state.title.trim()) throw new Error("Task title is required");
        if (!state.personalProjectId)
          throw new Error("Unable to locate personal project");
        const createRes = await api.post(
          `/projects/${state.personalProjectId}/tasks`,
          {
            title: state.title.trim(),
            description: state.note || undefined,
            assignedTo: req.employee.id,
          }
        );
        const created = createRes.data?.task;
        taskId = created?._id;
        projectId = state.personalProjectId;
      }

      if (!taskId || !projectId) throw new Error("Invalid task details");

      await api.post(`/projects/${projectId}/tasks/${taskId}/time-at`, {
        minutes,
        note: state.note || undefined,
        date: req.date,
        forEmployee: req.employee.id,
      });

      toast.success("Time logged successfully");
      closeLogModal();
      await refreshRequests();
    } catch (e: any) {
      const message =
        typeof e?.response?.data?.error === "string"
          ? e.response.data.error
          : e?.message || "Failed to log time";
      setLogModal((prev) => ({ ...prev, error: message, saving: false }));
      return;
    }
    setLogModal((prev) => ({ ...prev, saving: false }));
  }

  function openLeaveModal(req: ManualRequest) {
    const defaultDate = req.date || new Date().toISOString().slice(0, 10);
    setLeaveModal({
      request: req,
      startDate: defaultDate,
      endDate: defaultDate,
      type: "PAID",
      reason: "",
      saving: false,
      error: null,
    });
  }

  function closeLeaveModal() {
    setLeaveModal({
      request: null,
      startDate: "",
      endDate: "",
      type: "PAID",
      reason: "",
      saving: false,
      error: null,
    });
  }

  async function submitLeaveModal() {
    if (!leaveModal.request?.employee?.id) return;
    if (!leaveModal.startDate) {
      setLeaveModal((prev) => ({
        ...prev,
        error: "Start date is required",
      }));
      return;
    }
    if (
      new Date(leaveModal.startDate) >
      new Date(leaveModal.endDate || leaveModal.startDate)
    ) {
      setLeaveModal((prev) => ({
        ...prev,
        error: "End date must be on or after start date",
      }));
      return;
    }
    try {
      setLeaveModal((prev) => ({ ...prev, saving: true, error: null }));
      await api.post("/attendance/resolve/leave", {
        employeeId: leaveModal.request.employee?.id,
        date: leaveModal.startDate,
        endDate: leaveModal.endDate || leaveModal.startDate,
        type: leaveModal.type,
        reason: leaveModal.reason?.trim() || undefined,
      });
      toast.success("Leave applied");
      closeLeaveModal();
      await refreshRequests();
    } catch (e: any) {
      setLeaveModal((prev) => ({
        ...prev,
        saving: false,
        error: e?.response?.data?.error || "Failed to apply leave",
      }));
    }
  }

  async function submitSelfPunch() {
    if (!selfPunchModal.date || !selfPunchModal.time) {
      setSelfPunchModal((prev) => ({
        ...prev,
        error: "Punch-out time is required",
      }));
      return;
    }
    try {
      setSelfPunchModal((prev) => ({ ...prev, saving: true, error: null }));
      await api.post("/attendance/punchout-at", {
        date: selfPunchModal.date,
        time: selfPunchModal.time,
      });
      toast.success("Punch-out updated");
      setSelfPunchModal({
        date: "",
        time: "",
        open: false,
        saving: false,
        error: null,
      });
      await loadSelfIssues();
    } catch (e: any) {
      setSelfPunchModal((prev) => ({
        ...prev,
        saving: false,
        error: e?.response?.data?.error || "Failed to set punch-out time",
      }));
    }
  }

  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status !== "COMPLETED" && r.status !== "CANCELLED"),
    [requests]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Manual Attendance Requests</h1>
          <p className="text-sm text-muted">
            Review employee notifications and help close missed punches.
          </p>
        </div>
        <button
          className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
          onClick={refreshRequests}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading ? (
        <div className="rounded-md border border-border bg-surface p-4 text-sm text-muted">
          Loading requests…
        </div>
      ) : error ? (
        <div className="rounded-md border border-error/20 bg-error/10 p-4 text-sm text-error">
          {error}
        </div>
      ) : pendingRequests.length === 0 ? (
        <div className="rounded-md border border-border bg-surface p-4 text-sm text-muted">
          No open manual attendance requests.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 text-left">Employee</th>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-left">Requested</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Details</th>
                <th className="px-4 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {pendingRequests.map((req) => (
                <tr key={req.id || Math.random()}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{req.employee?.name || "—"}</div>
                    <div className="text-xs text-muted">
                      {req.employee?.email || ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{req.date || "—"}</div>
                    {req.autoPunchOut && (
                      <div className="text-[11px] text-error">
                        Auto punch-out triggered
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div>{fmtDate(req.requestedAt)}</div>
                    {req.requestedBy && (
                      <div className="text-xs text-muted">
                        By {req.requestedBy.name}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                      {req.status}
                    </span>
                    {req.acknowledgedAt && (
                      <div className="text-[11px] text-muted">
                        Ack {fmtDate(req.acknowledgedAt)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 space-y-1">
                    {req.note && (
                      <div className="text-xs text-muted">Employee: {req.note}</div>
                    )}
                    {req.adminNote && (
                      <div className="text-xs text-muted">Admin: {req.adminNote}</div>
                    )}
                    <div className="text-xs text-muted">
                      Worked: {formatMinutesLabel(Math.floor((req.workedMs || 0) / 60000))}
                    </div>
                    {req.firstPunchIn && (
                      <div className="text-xs text-muted">
                        Punch In: {fmtDate(req.firstPunchIn)}
                      </div>
                    )}
                    {req.lastPunchOut && (
                      <div className="text-xs text-muted">
                        Punch Out: {fmtDate(req.lastPunchOut)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <button
                        className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted/40"
                        onClick={() => openLeaveModal(req)}
                      >
                        Apply Leave
                      </button>
                      <button
                        className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted/40"
                        onClick={() => openFillModal(req)}
                      >
                        Fill Attendance
                      </button>
                      <button
                        className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted/40"
                        onClick={() => openLogModal(req)}
                      >
                        Log Tasks
                      </button>
                      {req.status === "PENDING" && (
                        <button
                          className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted/40"
                          onClick={() => updateStatus(req, "ACKED")}
                        >
                          Mark Acknowledged
                        </button>
                      )}
                      <button
                        className="rounded-md border border-error/20 bg-error/10 px-3 py-1 text-xs text-error hover:bg-error/20"
                        onClick={() => updateStatus(req, "CANCELLED")}
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="rounded-md border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">My Pending Attendance</h2>
            <p className="text-sm text-muted">
              Days where your own attendance needs action.
            </p>
          </div>
          <button
            className="rounded-md border border-border px-3 py-2 text-xs disabled:opacity-60"
            onClick={loadSelfIssues}
            disabled={selfLoading}
          >
            {selfLoading ? "Checking…" : "Refresh"}
          </button>
        </div>
        {selfErr && (
          <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
            {selfErr}
          </div>
        )}
        {selfLoading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : selfIssues.length === 0 ? (
          <div className="text-sm text-muted">No pending attendance issues.</div>
        ) : (
          <ul className="space-y-2">
            {selfIssues.map((issue) => (
              <li
                key={issue.date}
                className="flex flex-col gap-2 rounded border border-border px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{fmtDay(issue.date)}</div>
                    <div className="text-xs text-muted">
                      {describeIssue(issue)}
                    </div>
                  </div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] uppercase">
                    {issue.type}
                  </span>
                </div>
                <div className="text-xs text-muted">{fmtIssueHint(issue)}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {issue.type === "noAttendance" ? (
                    <>
                      <button
                        className="rounded-md border border-border px-3 py-1"
                        onClick={() =>
                          openLeaveModal({
                            id: null,
                            employee: {
                              id: me?.id || null,
                              name: me?.name || "",
                              email: me?.email || "",
                            },
                            date: issue.date,
                            note: "",
                            adminNote: "",
                            status: "PENDING",
                            requestedAt: null,
                            acknowledgedAt: null,
                            resolvedAt: null,
                            requestedBy: null,
                            resolvedBy: null,
                            autoPunchOut: false,
                            autoPunchOutAt: null,
                            firstPunchIn: null,
                            lastPunchOut: null,
                            workedMs: 0,
                          })
                        }
                      >
                        Apply Leave
                      </button>
                      <button
                        className="rounded-md border border-border px-3 py-1"
                        onClick={() =>
                          openLogModal({
                            id: null,
                            employee: {
                              id: me?.id || null,
                              name: me?.name || "",
                              email: me?.email || "",
                            },
                            date: issue.date,
                            note: "",
                            adminNote: "",
                            status: "PENDING",
                            requestedAt: null,
                            acknowledgedAt: null,
                            resolvedAt: null,
                            requestedBy: null,
                            resolvedBy: null,
                            autoPunchOut: false,
                            autoPunchOutAt: null,
                            firstPunchIn: null,
                            lastPunchOut: null,
                            workedMs: 0,
                          })
                        }
                      >
                        Log Tasks
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="rounded-md border border-border px-3 py-1"
                        onClick={() =>
                          openLogModal({
                            id: null,
                            employee: {
                              id: me?.id || null,
                              name: me?.name || "",
                              email: me?.email || "",
                            },
                            date: issue.date,
                            note: "",
                            adminNote: "",
                            status: "PENDING",
                            requestedAt: null,
                            acknowledgedAt: null,
                            resolvedAt: null,
                            requestedBy: null,
                            resolvedBy: null,
                            autoPunchOut: issue.type === "autoPunch",
                            autoPunchOutAt: issue.autoPunchOutAt || null,
                            firstPunchIn: null,
                            lastPunchOut: null,
                            workedMs: 0,
                          })
                        }
                      >
                        Log Tasks
                      </button>
                      <button
                        className="rounded-md border border-border px-3 py-1"
                        onClick={() =>
                          setSelfPunchModal({
                            open: true,
                            date: issue.date,
                            time:
                              issue.autoPunchOutAt
                                ? issue.autoPunchOutAt.slice(11, 16)
                                : "18:00",
                            saving: false,
                            error: null,
                          })
                        }
                      >
                        Set Punch-Out
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Fill attendance modal */}
      {fillModal.request && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeFillModal}
          />
          <div className="relative w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">
                Fill Attendance — {fillModal.request.employee?.name || ""}
              </h2>
              <button
                className="text-sm underline"
                onClick={closeFillModal}
              >
                Close
              </button>
            </div>
            <div className="text-sm text-muted mb-4">
              Date: {fillModal.request.date || "—"}
            </div>
            {fillModal.error && (
              <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                {fillModal.error}
              </div>
            )}
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="w-32 text-muted">Punch-in time</span>
                <input
                  type="time"
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                  value={fillModal.punchIn}
                  onChange={(e) =>
                    setFillModal((prev) => ({ ...prev, punchIn: e.target.value }))
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="w-32 text-muted">Punch-out time</span>
                <input
                  type="time"
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                  value={fillModal.punchOut}
                  onChange={(e) =>
                    setFillModal((prev) => ({ ...prev, punchOut: e.target.value }))
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="w-32 text-muted">Break minutes</span>
                <input
                  type="number"
                  min={0}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2"
                  value={fillModal.breakMinutes}
                  onChange={(e) =>
                    setFillModal((prev) => ({
                      ...prev,
                      breakMinutes: e.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Override total minutes (optional)</span>
                <input
                  type="number"
                  min={0}
                  className="h-9 rounded-md border border-border bg-surface px-2"
                  value={fillModal.totalMinutes}
                  onChange={(e) =>
                    setFillModal((prev) => ({
                      ...prev,
                      totalMinutes: e.target.value,
                    }))
                  }
                  placeholder="Calculated from punch-in and punch-out"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Admin note (optional)</span>
                <textarea
                  className="min-h-[80px] rounded-md border border-border bg-surface px-2 py-1"
                  value={fillModal.adminNote}
                  onChange={(e) =>
                    setFillModal((prev) => ({
                      ...prev,
                      adminNote: e.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={closeFillModal}
                disabled={fillModal.saving}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-secondary px-4 py-2 text-white disabled:opacity-60"
                onClick={handleFillSubmit}
                disabled={fillModal.saving}
              >
                {fillModal.saving ? "Saving…" : "Save Attendance"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log tasks modal */}
      {logModal.request && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeLogModal}
          />
          <div className="relative w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">
                Log Tasks — {logModal.request.employee?.name || ""}
              </h2>
              <button
                className="text-sm underline"
                onClick={closeLogModal}
              >
                Close
              </button>
            </div>
            <div className="text-sm text-muted mb-4">
              Date: {logModal.request.date || "—"}
            </div>
            {logModal.error && (
              <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                {logModal.error}
              </div>
            )}
            {logModal.loading ? (
              <div className="text-sm text-muted">Loading tasks…</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="log-mode"
                      checked={logModal.mode === "existing"}
                      onChange={() =>
                        setLogModal((prev) => ({ ...prev, mode: "existing" }))
                      }
                    />
                    <span>Use existing task</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="log-mode"
                      checked={logModal.mode === "new"}
                      onChange={() =>
                        setLogModal((prev) => ({ ...prev, mode: "new" }))
                      }
                    />
                    <span>Create manual task</span>
                  </label>
                </div>
                {logModal.mode === "existing" ? (
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted">Select task</span>
                    <select
                      className="h-9 rounded-md border border-border bg-surface px-2"
                      value={logModal.taskId}
                      onChange={(e) =>
                        setLogModal((prev) => ({
                          ...prev,
                          taskId: e.target.value,
                        }))
                      }
                    >
                      <option value="">Select</option>
                      {logModal.tasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                          {t.projectTitle ? ` — ${t.projectTitle}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted">Task title</span>
                    <input
                      className="h-9 rounded-md border border-border bg-surface px-2"
                      value={logModal.title}
                      onChange={(e) =>
                        setLogModal((prev) => ({ ...prev, title: e.target.value }))
                      }
                      placeholder="e.g., Administrative adjustment"
                    />
                  </label>
                )}
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">Minutes worked</span>
                  <input
                    type="number"
                    min={1}
                    className="h-9 rounded-md border border-border bg-surface px-2"
                    value={logModal.minutes}
                    onChange={(e) =>
                      setLogModal((prev) => ({
                        ...prev,
                        minutes: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">Note (optional)</span>
                  <textarea
                    className="min-h-[80px] rounded-md border border-border bg-surface px-2 py-1"
                    value={logModal.note}
                    onChange={(e) =>
                      setLogModal((prev) => ({ ...prev, note: e.target.value }))
                    }
                  />
                </label>
              </div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={closeLogModal}
                disabled={logModal.saving}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-secondary px-4 py-2 text-white disabled:opacity-60"
                onClick={submitLog}
                disabled={logModal.saving || logModal.loading}
              >
                {logModal.saving ? "Logging…" : "Log Time"}
              </button>
            </div>
          </div>
        </div>
      )}

      {leaveModal.request && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => (!leaveModal.saving ? closeLeaveModal() : null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">
                Apply Leave — {leaveModal.request.employee?.name || ""}
              </h2>
              <button
                className="text-sm underline"
                onClick={() => (!leaveModal.saving ? closeLeaveModal() : null)}
                disabled={leaveModal.saving}
              >
                Close
              </button>
            </div>
            <div className="text-sm text-muted mb-4">
              Date: {leaveModal.request.date || "—"}
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
                      type: e.target.value as any,
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
                onClick={submitLeaveModal}
                disabled={leaveModal.saving}
              >
                {leaveModal.saving ? "Applying…" : "Apply Leave"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selfPunchModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() =>
              !selfPunchModal.saving &&
              setSelfPunchModal({
                date: "",
                time: "",
                open: false,
                saving: false,
                error: null,
              })
            }
          />
          <div className="relative w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Set Punch-Out</h2>
              <button
                className="text-sm underline"
                onClick={() =>
                  !selfPunchModal.saving &&
                  setSelfPunchModal({
                    date: "",
                    time: "",
                    open: false,
                    saving: false,
                    error: null,
                  })
                }
                disabled={selfPunchModal.saving}
              >
                Close
              </button>
            </div>
            <div className="text-sm text-muted mb-4">
              Date: {selfPunchModal.date}
            </div>
            {selfPunchModal.error && (
              <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                {selfPunchModal.error}
              </div>
            )}
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="w-28 text-muted">Punch-out time</span>
              <input
                type="time"
                className="h-9 rounded-md border border-border bg-surface px-2"
                value={selfPunchModal.time}
                onChange={(e) =>
                  setSelfPunchModal((prev) => ({
                    ...prev,
                    time: e.target.value,
                  }))
                }
                disabled={selfPunchModal.saving}
              />
            </label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={() =>
                  setSelfPunchModal({
                    date: "",
                    time: "",
                    open: false,
                    saving: false,
                    error: null,
                  })
                }
                disabled={selfPunchModal.saving}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-secondary px-4 py-2 text-white disabled:opacity-60"
                onClick={submitSelfPunch}
                disabled={selfPunchModal.saving}
              >
                {selfPunchModal.saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
