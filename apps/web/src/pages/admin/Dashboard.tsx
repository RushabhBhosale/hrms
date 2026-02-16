import { useEffect, useRef, useState, useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { api } from "../../lib/api";
import { resolveLocationLabel } from "../../lib/location";
import {
  Users,
  UserCheck,
  FileText,
  TrendingUp,
  Receipt,
  PieChart as PieChartIcon,
  Eye,
} from "lucide-react";
import { Card } from "../../components/utils/Card";
import { Button } from "../../components/ui/button";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

type EmployeeLite = {
  id: string;
  name: string;
  email: string;
  subRoles: string[];
};
type ProjectLite = {
  _id: string;
  title: string;
  teamLead: string;
  members: string[];
  isPersonal?: boolean;
  estimatedTimeMinutes?: number;
  monthlyEstimateMinutes?: number;
  startTime?: string;
};

type Attendance = {
  firstPunchIn?: string;
  lastPunchOut?: string;
  lastPunchIn?: string;
  firstPunchInLocation?: string | null;
  lastPunchInLocation?: string | null;
  workedMs?: number;
};

type CompanyAttendanceRecord = {
  employee: { id?: string; _id?: string; name: string };
  firstPunchIn?: string;
  lastPunchOut?: string;
};

type PresenceRow = {
  employee: { id: string; name: string };
  firstPunchIn?: string;
  lastPunchOut?: string;
  onLeaveToday?: boolean;
  leaveTodayStatus?: "APPROVED" | "PENDING" | string | null;
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

type TimeLog = {
  minutes: number;
  note?: string;
  addedBy: string;
  createdAt: string;
};

type ProjectTask = {
  _id: string;
  title: string;
  timeLogs?: TimeLog[];
};

type ProjectTimeRow = {
  id: string;
  title: string;
  startTime?: string;
  estimatedMinutes: number;
  spentMinutes: number;
  monthlyCapMinutes: number;
  monthlySpentMinutes: number;
  monthlyByEmployee: Record<string, number>;
  taskCount: number;
  logCount: number;
  byEmployee: Record<string, number>;
};

type InvoiceSummary = {
  count: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  overdueAmount: number;
  upcomingDueAmount: number;
  upcomingDueCount: number;
};

type ExpenseSummary = {
  totalCount: number;
  totalAmount: number;
  monthToDateAmount: number;
  yearToDateAmount: number;
  recurringCount: number;
  recurringAmount: number;
};

type UpcomingRecurringItem = {
  id: string;
  category: string;
  nextDueDate: string | null;
  frequency: string | null;
  amount: number;
  lastPaidOn?: string;
  status: "pending" | "paid";
};

type RecurringSeriesPoint = {
  date: string;
  total: number;
};

type SpendBreakdown = {
  recurring: { amount: number; count: number };
  oneTime: { amount: number; count: number };
};

type RecurringTrendPoint = {
  key: string;
  label: string;
  total: number;
};

type FinanceSummary = {
  invoiceSummary: InvoiceSummary;
  expenseSummary: ExpenseSummary;
  upcomingRecurring: UpcomingRecurringItem[];
  upcomingRecurringSeries: RecurringSeriesPoint[];
  spendBreakdown: SpendBreakdown;
  recurringTrend: RecurringTrendPoint[];
};

type MissingIssue = {
  date: string;
  type: "missingPunchOut" | "autoPunch" | "noAttendance";
  autoPunchOutAt?: string;
};

type LeaveModalState = {
  open: boolean;
  date: string | null;
  startDate: string;
  endDate: string;
  type: string;
  reason: string;
  saving: boolean;
  error: string | null;
};

type PunchModalState = {
  open: boolean;
  date: string | null;
  time: string;
  saving: boolean;
  error: string | null;
};

function createLeaveModalState(): LeaveModalState {
  return {
    open: false,
    date: null,
    startDate: "",
    endDate: "",
    type: "PAID",
    reason: "",
    saving: false,
    error: null,
  };
}

function createPunchModalState(): PunchModalState {
  return {
    open: false,
    date: null,
    time: "",
    saving: false,
    error: null,
  };
}

function formatCurrency(value: number, currency = "INR") {
  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
  return formatter.format(Number.isFinite(value) ? value : 0);
}

function formatCurrencyShort(value: number) {
  const formatted = formatCurrency(value);
  return formatted.replace(/^[^\d-]*/, "");
}

function fmtPresenceTime(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function presenceStatus(row: PresenceRow) {
  if (row.firstPunchIn && row.lastPunchOut) return "Punched out";
  if (row.firstPunchIn) return "Punched in";
  return "Not punched in";
}

function formatDateLabel(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtDateKey(key: string) {
  const [y, m, d] = key.split("-").map((x) => parseInt(x, 10));
  const local = new Date(y, (m || 1) - 1, d || 1);
  return local.toLocaleDateString();
}

function fmtShortTime(iso?: string) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

function renderIssueHint(issue: MissingIssue) {
  if (issue.type === "autoPunch") {
    const time = fmtShortTime(issue.autoPunchOutAt);
    return time
      ? `System closed the day at ${time}. Confirm the actual punch-out time.`
      : "System closed the day automatically. Confirm the actual punch-out time.";
  }
  if (issue.type === "noAttendance")
    return "Apply leave or notify an admin to record the punches for that day.";
  return "Set the punch-out time and log the tasks you worked on.";
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

function titleCase(value?: string | null) {
  if (!value) return "-";
  return value
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const PIE_COLORS = ["#2563eb", "#14b8a6"];

function PieSplitChart({ breakdown }: { breakdown: SpendBreakdown }) {
  const total = breakdown.recurring.amount + breakdown.oneTime.amount;
  if (total <= 0)
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        No expenses recorded yet.
      </div>
    );

  const chartData = [
    {
      name: "Recurring",
      value: Number(breakdown.recurring.amount || 0),
      count: breakdown.recurring.count,
    },
    {
      name: "One-Time",
      value: Number(breakdown.oneTime.amount || 0),
      count: breakdown.oneTime.count,
    },
  ];

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius="50%"
            outerRadius="72%"
            paddingAngle={4}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={PIE_COLORS[index % PIE_COLORS.length]}
              />
            ))}
          </Pie>
          <Legend
            layout="horizontal"
            align="center"
            verticalAlign="bottom"
            height={36}
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value: any, entry: any) => {
              const datum = chartData.find((d) => d.name === value);
              if (!datum) return value;
              return `${value} · ${formatCurrency(datum.value)} · ${
                datum.count
              } items`;
            }}
          />
          <RechartsTooltip
            formatter={(value: any, name: any) => [
              formatCurrency(Number(value)),
              name,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendLineChart({ data }: { data: RecurringTrendPoint[] }) {
  if (!data.length)
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No recurring expenses logged yet.
      </div>
    );

  const chartData = data.map((point) => ({
    ...point,
    total: Number(point.total || 0),
  }));

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 12, right: 16, left: 0, bottom: 12 }}
        >
          <CartesianGrid
            strokeDasharray="4 8"
            stroke="rgba(148, 163, 184, 0.35)"
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            angle={-15}
            height={50}
            textAnchor="end"
            tick={{ fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tickFormatter={(value: any) => formatCurrencyShort(Number(value))}
            tick={{ fontSize: 12 }}
          />
          <RechartsTooltip
            formatter={(value: any) => formatCurrency(Number(value))}
          />
          <Line
            type="monotone"
            dataKey="total"
            stroke="#2563eb"
            strokeWidth={2}
            dot={{ r: 3.5, strokeWidth: 1, stroke: "#1d4ed8", fill: "white" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function FinanceStatCard({
  icon,
  title,
  value,
  subValue,
  tone = "primary",
}: {
  icon: ReactNode;
  title: string;
  value: string;
  subValue?: string;
  tone?: "primary" | "secondary" | "accent" | "neutral";
}) {
  const toneClasses: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    secondary: "bg-secondary/10 text-secondary",
    accent: "bg-accent/10 text-accent",
    neutral: "bg-muted text-foreground/70",
  };
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-4 shadow-sm">
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <div className="text-2xl font-semibold">{value}</div>
        {subValue && (
          <div className="text-xs text-muted-foreground">{subValue}</div>
        )}
      </div>
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full ${
          toneClasses[tone] || toneClasses.primary
        }`}
      >
        {icon}
      </div>
    </div>
  );
}

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

function minutesToHours(min: number) {
  if (!Number.isFinite(min)) return "0.00";
  const totalMinutes = Math.max(0, Math.round(min));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  // Display as hours.minutes where minutes are base-60 (00-59) instead of decimal hours
  return `${hours}.${minutes.toString().padStart(2, "0")}`;
}

export default function AdminDash() {
  const [stats, setStats] = useState({ employees: 0, present: 0 });
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [loadingAtt, setLoadingAtt] = useState(true);
  const [pending, setPending] = useState<"in" | "out" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [locationPrompt, setLocationPrompt] = useState<{
    open: boolean;
    permission: "granted" | "denied" | "prompt" | "unavailable";
    action: "in" | "out";
  }>({ open: false, permission: "prompt", action: "in" });
  const timerRef = useRef<number | null>(null);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [leaveMap, setLeaveMap] = useState<Record<string, boolean>>({});
  const [attendanceMap, setAttendanceMap] = useState<Record<string, boolean>>(
    {},
  );
  const [presenceRows, setPresenceRows] = useState<PresenceRow[]>([]);
  const [presenceLoading, setPresenceLoading] = useState(true);
  const [presenceErr, setPresenceErr] = useState<string | null>(null);
  const [presenceRefreshedAt, setPresenceRefreshedAt] = useState<Date | null>(
    null,
  );
  const [presenceDetail, setPresenceDetail] = useState<PresenceRow | null>(null);
  const [projectTasks, setProjectTasks] = useState<
    Record<string, ProjectTask[]>
  >({});
  const [loadingProjectTime, setLoadingProjectTime] = useState(false);
  const [finance, setFinance] = useState<FinanceSummary | null>(null);
  const [loadingFinance, setLoadingFinance] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [missingIssues, setMissingIssues] = useState<MissingIssue[]>([]);
  const [missingLoading, setMissingLoading] = useState(false);
  const [missingErr, setMissingErr] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [leaveModal, setLeaveModal] = useState<LeaveModalState>(
    createLeaveModalState,
  );
  const [punchModal, setPunchModal] = useState<PunchModalState>(
    createPunchModalState,
  );
  const [projectModalId, setProjectModalId] = useState<string | null>(null);
  // Finance-safe fallbacks to avoid undefined property reads
  const invoiceSummarySafe = useMemo(
    () => ({
      count: finance?.invoiceSummary?.count ?? 0,
      totalAmount: finance?.invoiceSummary?.totalAmount ?? 0,
      upcomingDueAmount: finance?.invoiceSummary?.upcomingDueAmount ?? 0,
      outstandingAmount: finance?.invoiceSummary?.outstandingAmount ?? 0,
      overdueAmount: finance?.invoiceSummary?.overdueAmount ?? 0,
    }),
    [finance?.invoiceSummary],
  );
  const expenseSummarySafe = useMemo(
    () => ({
      totalCount: finance?.expenseSummary?.totalCount ?? 0,
      totalAmount: finance?.expenseSummary?.totalAmount ?? 0,
      monthToDateAmount: finance?.expenseSummary?.monthToDateAmount ?? 0,
      yearToDateAmount: finance?.expenseSummary?.yearToDateAmount ?? 0,
      recurringCount: finance?.expenseSummary?.recurringCount ?? 0,
      recurringAmount: finance?.expenseSummary?.recurringAmount ?? 0,
    }),
    [finance?.expenseSummary],
  );
  const upcomingRecurringSafe = finance?.upcomingRecurring ?? [];
  const spendBreakdownSafe = useMemo(
    () => ({
      recurring: {
        amount: finance?.spendBreakdown?.recurring?.amount ?? 0,
        count: finance?.spendBreakdown?.recurring?.count ?? 0,
      },
      oneTime: {
        amount: finance?.spendBreakdown?.oneTime?.amount ?? 0,
        count: finance?.spendBreakdown?.oneTime?.count ?? 0,
      },
    }),
    [finance?.spendBreakdown],
  );
  const recurringTrendSafe = finance?.recurringTrend ?? [];

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

  async function loadProjectTasks(list: ProjectLite[]) {
    if (!list.length) {
      setProjectTasks({});
      return;
    }
    try {
      setLoadingProjectTime(true);
      const taskMap: Record<string, ProjectTask[]> = {};
      await Promise.all(
        list.map(async (project) => {
          try {
            const res = await api.get(`/projects/${project._id}/tasks`);
            taskMap[project._id] = (res.data.tasks || []) as ProjectTask[];
          } catch {
            taskMap[project._id] = [];
          }
        }),
      );
      setProjectTasks(taskMap);
    } finally {
      setLoadingProjectTime(false);
    }
  }

  async function loadPresence() {
    try {
      setPresenceErr(null);
      setPresenceLoading(true);
      const res = await api.get("/attendance/company/presence");
      setPresenceRows(res.data.rows || []);
      setPresenceRefreshedAt(new Date());
    } catch (e: any) {
      setPresenceErr(e?.response?.data?.error || "Failed to load presence");
    } finally {
      setPresenceLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        setErr(null);
        setLoadingProjects(true);
        setFinanceError(null);
        setLoadingFinance(true);
        const financePromise = api
          .get("/finance/dashboard")
          .then((res) => {
            setFinanceError(null);
            return res;
          })
          .catch((error) => {
            console.error(error);
            setFinance(null);
            setFinanceError(
              error?.response?.data?.error || "Failed to load finance overview",
            );
            return null;
          });

        const [empRes, att, projRes, leavesRes, financeRes] = await Promise.all(
          [
            api.get("/companies/employees"),
            api.get("/attendance/company/today"),
            api.get("/projects", { params: { active: true } }),
            api.get("/leaves/company/today"),
            financePromise,
          ],
        );
        const empList: EmployeeLite[] = empRes.data.employees || [];
        const projList: ProjectLite[] = (projRes.data.projects || []).filter(
          (p: ProjectLite) => !p.isPersonal,
        );
        const companyAttendance: CompanyAttendanceRecord[] =
          att.data.attendance || [];
        const todayPunchMap: Record<string, boolean> = {};
        companyAttendance.forEach((record) => {
          const id = record?.employee?.id || record?.employee?._id;
          if (!id) return;
          todayPunchMap[id] = Boolean(record.firstPunchIn);
        });
        setEmployees(empList);
        setProjects(projList);
        setAttendanceMap(todayPunchMap);
        const lmap: Record<string, boolean> = {};
        (leavesRes.data.leaves || []).forEach((l: any) => {
          const id = l.employee.id || l.employee._id;
          lmap[id] = true;
        });
        setLeaveMap(lmap);
        setStats({
          employees: empList.length,
          present: companyAttendance.filter((r) => r.firstPunchIn).length,
        });
        if (financeRes && financeRes.data) setFinance(financeRes.data);
        await loadProjectTasks(projList);
      } catch (err: any) {
        console.error(err);
        setErr(err?.response?.data?.error || "Failed to load dashboard data");
      } finally {
        setLoadingProjects(false);
        setLoadingFinance(false);
      }
    }
    load();
    loadMissingOut();
    loadPresence();
  }, []);

  async function loadAttendance() {
    try {
      setErr(null);
      setLoadingAtt(true);
      const res = await api.get("/attendance/today");
      setAttendance(res.data.attendance ?? null);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load attendance");
    } finally {
      setLoadingAtt(false);
    }
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
        params: { month: ym, scope: "all" },
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
      setMissingIssues(issues);
    } catch (e: any) {
      setMissingErr(
        e?.response?.data?.error || "Failed to load attendance issues",
      );
    } finally {
      setMissingLoading(false);
    }
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
    setLeaveModal(createLeaveModalState());
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
      await loadAttendance();
    } catch (e: any) {
      setLeaveModal((prev) => ({
        ...prev,
        saving: false,
        error: e?.response?.data?.error || "Failed to apply leave",
      }));
    }
  }

  function openPunchModal(dateKey: string) {
    setPunchModal({
      open: true,
      date: dateKey,
      time: "",
      saving: false,
      error: null,
    });
  }

  function closePunchModal() {
    setPunchModal(createPunchModalState());
  }

  async function submitPunch() {
    if (!punchModal.date) return;
    if (!punchModal.time) {
      setPunchModal((prev) => ({
        ...prev,
        error: "Select a punch-out time",
      }));
      return;
    }
    try {
      setPunchModal((prev) => ({ ...prev, saving: true, error: null }));
      await api.post("/attendance/punchout-at", {
        date: punchModal.date,
        time: punchModal.time,
        ...getTimezonePayload(),
      });
      toast.success("Punch-out saved");
      closePunchModal();
      await loadMissingOut();
      await loadAttendance();
    } catch (e: any) {
      setPunchModal((prev) => ({
        ...prev,
        saving: false,
        error: e?.response?.data?.error || "Failed to set punch-out time",
      }));
    }
  }

  async function refreshFinance() {
    try {
      setFinanceError(null);
      setLoadingFinance(true);
      const res = await api.get("/finance/dashboard");
      setFinance(res.data || null);
    } catch (e: any) {
      setFinance(null);
      setFinanceError(
        e?.response?.data?.error || "Failed to load finance overview",
      );
    } finally {
      setLoadingFinance(false);
    }
  }

  async function punch(action: "in" | "out") {
    if (pending) return;
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
      });
      await loadAttendance();
    } catch (e: any) {
      setErr(e?.response?.data?.error || `Failed to punch ${action}`);
    } finally {
      setPending(null);
    }
  }

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!attendance) {
      setElapsed(0);
      return;
    }
    const base = attendance.workedMs ?? 0;
    if (attendance.lastPunchIn && !attendance.lastPunchOut) {
      const start = new Date(attendance.lastPunchIn).getTime();
      const tick = () => setElapsed(base + (Date.now() - start));
      tick();
      timerRef.current = window.setInterval(tick, 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
    setElapsed(base);
  }, [attendance]);

  useEffect(() => {
    const handleVis = () => {
      if (document.hidden) return;
      setAttendance((prev) => (prev ? { ...prev } : prev));
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, []);

  useEffect(() => {
    loadAttendance();
  }, []);

  const punchedIn = Boolean(
    attendance?.lastPunchIn && !attendance?.lastPunchOut,
  );

  const employeeNameMap = useMemo(
    () => new Map(employees.map((emp) => [emp.id, emp.name])),
    [employees],
  );

  const monthRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end };
  }, []);

  const projectTimeRows = useMemo<ProjectTimeRow[]>(() => {
    if (!projects.length) return [];
    const { start: monthStart, end: monthEnd } = monthRange;
    return projects
      .map((project) => {
        const tasks = projectTasks[project._id] || [];
        let spentMinutes = 0;
        let monthlySpentMinutes = 0;
        let logCount = 0;
        const byEmployee: Record<string, number> = {};
        const monthlyByEmployee: Record<string, number> = {};
        tasks.forEach((task) => {
          const logs = (task.timeLogs || []) as TimeLog[];
          logs.forEach((log) => {
            const minutes = Number(log.minutes || 0);
            const createdAt = new Date(log.createdAt);
            spentMinutes += minutes;
            if (
              !Number.isNaN(createdAt.getTime()) &&
              createdAt >= monthStart &&
              createdAt < monthEnd
            ) {
              monthlySpentMinutes += minutes;
            }
            logCount += 1;
            const empId = String(log.addedBy || "");
            if (!empId) return;
            byEmployee[empId] = (byEmployee[empId] || 0) + minutes;
            if (
              !Number.isNaN(createdAt.getTime()) &&
              createdAt >= monthStart &&
              createdAt < monthEnd
            ) {
              monthlyByEmployee[empId] =
                (monthlyByEmployee[empId] || 0) + minutes;
            }
          });
        });
        const monthlyCapMinutes = Number(project.monthlyEstimateMinutes || 0);
        return {
          id: project._id,
          title: project.title,
          startTime: project.startTime,
          estimatedMinutes: Number(project.estimatedTimeMinutes || 0),
          spentMinutes,
          monthlyCapMinutes,
          monthlySpentMinutes,
          taskCount: tasks.length,
          logCount,
          byEmployee,
          monthlyByEmployee,
        };
      })
      .sort((a, b) => b.spentMinutes - a.spentMinutes);
  }, [projects, projectTasks, monthRange]);

  const hasMonthlyCaps = useMemo(
    () => projectTimeRows.some((row) => Number(row.monthlyCapMinutes) > 0),
    [projectTimeRows],
  );

  const projectTableColSpan = hasMonthlyCaps ? 7 : 5;

  const projectModal = useMemo(() => {
    if (!projectModalId) return null;
    const row = projectTimeRows.find((item) => item.id === projectModalId);
    if (!row) return null;
    const contributors = Object.entries(row.monthlyByEmployee)
      .map(([id, minutes]) => ({
        id,
        name: employeeNameMap.get(id) || "Employee",
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes);
    return {
      row,
      contributors,
      totalMinutes: row.monthlySpentMinutes,
    };
  }, [projectModalId, projectTimeRows, employeeNameMap]);

  const assignments = useMemo(() => {
    if (!employees.length || !projects.length)
      return [] as { emp: EmployeeLite; projs: ProjectLite[] }[];
    return employees
      .filter(
        (emp: any) =>
          emp.primaryRole !== "ADMIN" && emp.primaryRole !== "SUPERADMIN",
      )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((emp) => {
        const projs = projects.filter(
          (p) => p.teamLead === emp.id || (p.members || []).includes(emp.id),
        );
        return { emp, projs };
      });
  }, [employees, projects]);

  // Project assignments table controls
  const [assignQ, setAssignQ] = useState("");
  const [assignPage, setAssignPage] = useState(1);
  const [assignLimit, setAssignLimit] = useState(20);
  const filteredAssignments = useMemo(() => {
    const term = assignQ.trim().toLowerCase();
    if (!term) return assignments;
    return assignments.filter(
      ({ emp }) =>
        emp.name.toLowerCase().includes(term) ||
        emp.email.toLowerCase().includes(term),
    );
  }, [assignments, assignQ]);
  const assignTotal = filteredAssignments.length;
  const assignPages = Math.max(
    1,
    Math.ceil(assignTotal / Math.max(1, assignLimit)),
  );
  const assignStart =
    assignTotal === 0 ? 0 : (assignPage - 1) * assignLimit + 1;
  const assignEnd = Math.min(assignTotal, assignPage * assignLimit);
  const assignRows = useMemo(
    () =>
      filteredAssignments.slice(
        (assignPage - 1) * assignLimit,
        (assignPage - 1) * assignLimit + assignLimit,
      ),
    [filteredAssignments, assignPage, assignLimit],
  );

  const upcomingSummary = useMemo(() => {
    if (!finance) return null;
    const items = finance.upcomingRecurring || [];
    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
    const pendingItems = items.filter((item) => item.status === "pending");
    const pendingAmount = pendingItems.reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    const nextDue = pendingItems
      .filter((item) => item.nextDueDate)
      .sort((a, b) => {
        const aTime = new Date(a.nextDueDate as string).getTime();
        const bTime = new Date(b.nextDueDate as string).getTime();
        return aTime - bTime;
      })[0];
    const byCategory = new Map<string, number>();
    items.forEach((item) => {
      const key = item.category || "Uncategorized";
      byCategory.set(key, (byCategory.get(key) || 0) + item.amount);
    });
    const topCategory = Array.from(byCategory.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0];
    return {
      totalAmount,
      totalCount: items.length,
      pendingAmount,
      pendingCount: pendingItems.length,
      nextDue,
      topCategory,
    };
  }, [finance]);

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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

            <div className="flex flex-wrap items-center gap-2">
              {hasBlockingIssues && (
                <button
                  className="rounded-md border border-border px-3 py-2 text-sm"
                  onClick={() => setShowMissing(true)}
                  title="Open pending attendance days"
                >
                  {`Resolve Attendance Issues (${blockingIssues.length})`}
                </button>
              )}
              {punchedIn ? (
                <button
                  className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-60"
                  onClick={() => punch("out")}
                  disabled={pending === "out"}
                >
                  {pending === "out" ? "Punching Out..." : "Punch Out"}
                </button>
              ) : (
                <button
                  className="rounded-md bg-secondary px-4 py-2 text-white disabled:opacity-60"
                  onClick={() => punch("in")}
                  disabled={pending === "in"}
                >
                  {pending === "in" ? "Punching In..." : "Punch In"}
                </button>
              )}
            </div>
          </div>
        </section>
        <Card
          icon={<Users size={22} />}
          title="Total Employees"
          value={stats.employees}
          tone="primary"
        />
        <Card
          icon={<UserCheck size={22} />}
          title="Today's Attendance"
          value={stats.present}
          tone="secondary"
        />
      </div>

      {/* Project time overview */}
      <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Project Time</h3>
            <p className="text-sm text-muted-foreground">
              Quick view of time spent per project.
            </p>
          </div>
          <Link
            to="/admin/reports/projects"
            className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-bg"
          >
            View full analytics
          </Link>
        </div>

        <div className="mt-3 text-sm text-muted-foreground">
          {loadingProjectTime
            ? "Loading project analytics..."
            : `Showing ${projectTimeRows.length} projects`}
        </div>

        <div className="mt-2 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Project</th>
                <th className="py-2 pr-4 font-medium">Estimated (h)</th>
                <th className="py-2 pr-4 font-medium">Spent (h)</th>
                {hasMonthlyCaps && (
                  <>
                    <th className="py-2 pr-4 font-medium">Monthly Cap (h)</th>
                    <th className="py-2 pr-4 font-medium">This Month (h)</th>
                  </>
                )}
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {projectTimeRows.map((row) => {
                const over = row.spentMinutes - row.estimatedMinutes;
                const monthlyOver =
                  row.monthlyCapMinutes > 0
                    ? row.monthlySpentMinutes - row.monthlyCapMinutes
                    : 0;
                return (
                  <tr key={row.id} className="border-t border-border/60">
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        onClick={() => setProjectModalId(row.id)}
                        className="text-primary hover:underline"
                        title="View project analytics"
                      >
                        {row.title}
                      </button>
                    </td>
                    <td className="py-2 pr-4">
                      {minutesToHours(row.estimatedMinutes)}
                    </td>
                    <td className="py-2 pr-4">
                      {minutesToHours(row.spentMinutes)}
                    </td>
                    {hasMonthlyCaps && (
                      <>
                        <td className="py-2 pr-4">
                          {row.monthlyCapMinutes
                            ? `${minutesToHours(row.monthlyCapMinutes)} h/mo`
                            : "—"}
                        </td>
                        <td className="py-2 pr-4">
                          {row.monthlyCapMinutes ? (
                            monthlyOver > 0 ? (
                              <span className="text-error">
                                {minutesToHours(row.monthlySpentMinutes)} h (
                                {minutesToHours(monthlyOver)} h over)
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {minutesToHours(row.monthlySpentMinutes)} h (
                                {minutesToHours(
                                  Math.max(
                                    0,
                                    row.monthlyCapMinutes -
                                      row.monthlySpentMinutes,
                                  ),
                                )}{" "}
                                h left)
                              </span>
                            )
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </>
                    )}
                    <td className="py-2">
                      {over > 0 ? (
                        <span className="text-error">
                          + {minutesToHours(over)} h
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          -{" "}
                          {minutesToHours(
                            Math.max(
                              0,
                              row.estimatedMinutes - row.spentMinutes,
                            ),
                          )}{" "}
                          h
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loadingProjectTime && projectTimeRows.length === 0 && (
                <tr>
                  <td
                    colSpan={projectTableColSpan}
                    className="py-4 text-center text-muted-foreground"
                  >
                    No projects found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Users size={18} />
            <h3 className="text-lg font-semibold leading-none">
              Team Presence
            </h3>
          </div>
        </div>

        {presenceErr && (
          <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
            {presenceErr}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs">
                <th className="px-2 py-1 font-medium">Member</th>
                <th className="px-2 py-1 font-medium">Punch In</th>
                <th className="px-2 py-1 font-medium">Punch Out</th>
                <th className="px-2 py-1 font-medium">Status</th>
                <th className="px-2 py-1 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {presenceLoading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-2 py-6 text-center text-muted-foreground text-sm"
                  >
                    Loading…
                  </td>
                </tr>
              ) : presenceRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-2 py-6 text-center text-muted-foreground text-sm"
                  >
                    No employees found.
                  </td>
                </tr>
              ) : (
                presenceRows.map((row) => {
                  const status = presenceStatus(row);
                  const noteParts: string[] = [];
                  if (row.onLeaveToday) {
                    const st = row.leaveTodayStatus || "PENDING";
                    noteParts.push(
                      st === "APPROVED"
                        ? "On leave today"
                        : "On leave today (pending)",
                    );
                  }
                  if (row.startingLeaveTomorrow) {
                    const st = row.leaveTomorrowStatus || "PENDING";
                    noteParts.push(
                      st === "APPROVED"
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
                        noteParts.push(`On leave tomorrow (${statusLabel})`);
                      }
                    } else if (days > 1) {
                      noteParts.push(
                        `On leave in ${days} days (${statusLabel})`,
                      );
                    }
                  }
                  return (
                    <tr
                      key={row.employee.id}
                      className="border-t border-border/70 text-sm hover:bg-bg/60 transition-colors"
                    >
                      <td className="px-2 py-1">{row.employee.name}</td>
                      <td className="px-2 py-1">
                        {fmtPresenceTime(row.firstPunchIn)}
                      </td>
                      <td className="px-2 py-1">
                        {fmtPresenceTime(row.lastPunchOut)}
                      </td>
                  <td className="px-2 py-1">
                    <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px]">
                      {status}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span className="truncate">
                        {noteParts.length ? noteParts.join(" · ") : "—"}
                      </span>
                      {noteParts.length > 0 && (
                        <button
                          className="h-7 w-7 inline-flex items-center justify-center rounded border border-border hover:bg-bg"
                          title="View leave details"
                          onClick={() => setPresenceDetail(row)}
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
          {presenceRefreshedAt
          ? `Updated ${presenceRefreshedAt.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : "—"}
        </div>

        {presenceDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setPresenceDetail(null)}
            />
            <div className="relative z-10 w-[min(380px,92vw)] rounded-lg border border-border bg-surface p-4 shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Leave details</div>
                  <div className="text-xs text-muted-foreground">
                    {presenceDetail.employee.name}
                  </div>
                </div>
                <button
                  className="text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => setPresenceDetail(null)}
                >
                  Close
                </button>
              </div>
              <div className="text-sm space-y-1">
                {presenceDetail.leaveTodayReason && (
                  <div>
                    <span className="text-muted-foreground">Today: </span>
                    {presenceDetail.leaveTodayReason}
                    {presenceDetail.leaveTodayType
                      ? ` (${presenceDetail.leaveTodayType})`
                      : ""}
                  </div>
                )}
                {presenceDetail.leaveTomorrowReason && (
                  <div>
                    <span className="text-muted-foreground">Tomorrow: </span>
                    {presenceDetail.leaveTomorrowReason}
                    {presenceDetail.leaveTomorrowType
                      ? ` (${presenceDetail.leaveTomorrowType})`
                      : ""}
                  </div>
                )}
                {presenceDetail.nextLeaveReason && (
                  <div>
                    <span className="text-muted-foreground">Next leave: </span>
                    {presenceDetail.nextLeaveReason}
                    {presenceDetail.nextLeaveType
                      ? ` (${presenceDetail.nextLeaveType})`
                      : ""}
                    {presenceDetail.nextLeaveInDays !== null &&
                    presenceDetail.nextLeaveInDays !== undefined
                      ? ` in ${presenceDetail.nextLeaveInDays} day(s)`
                      : ""}
                  </div>
                )}
                {!presenceDetail.leaveTodayReason &&
                  !presenceDetail.leaveTomorrowReason &&
                  !presenceDetail.nextLeaveReason && (
                    <div className="text-muted-foreground text-sm">
                      No leave reason available.
                    </div>
                  )}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-6 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Financial Overview</h3>
            <p className="text-sm text-muted-foreground">
              Invoices and company spend snapshots
            </p>
          </div>
        </div>

        {financeError && (
          <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
            {financeError}
          </div>
        )}

        {loadingFinance && !finance ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            Loading finance metrics...
          </div>
        ) : finance ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <FinanceStatCard
                icon={<FileText size={18} />}
                title="Invoices Issued"
                value={`${invoiceSummarySafe.count}`}
                subValue={`Total ${formatCurrency(
                  invoiceSummarySafe.totalAmount,
                )}${
                  invoiceSummarySafe.upcomingDueAmount > 0
                    ? ` · Due soon ${formatCurrency(
                        invoiceSummarySafe.upcomingDueAmount,
                      )}`
                    : ""
                }`}
              />
              <FinanceStatCard
                icon={<TrendingUp size={18} />}
                title="Outstanding"
                value={formatCurrency(invoiceSummarySafe.outstandingAmount)}
                subValue={`Overdue ${formatCurrency(
                  invoiceSummarySafe.overdueAmount,
                )}`}
                tone="accent"
              />
              <FinanceStatCard
                icon={<Receipt size={18} />}
                title="Expenses YTD"
                value={formatCurrency(expenseSummarySafe.yearToDateAmount)}
                subValue={`MTD ${formatCurrency(
                  expenseSummarySafe.monthToDateAmount,
                )}`}
                tone="secondary"
              />
              <FinanceStatCard
                icon={<PieChartIcon size={18} />}
                title="Recurring Spend"
                value={formatCurrency(expenseSummarySafe.recurringAmount)}
                subValue={`${expenseSummarySafe.recurringCount} recurring entries`}
                tone="neutral"
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[2fr_1.15fr]">
              <div className="space-y-4">
                <div>
                  <h4 className="text-base font-semibold">
                    Upcoming Recurring Expenses (Next 30 Days)
                  </h4>
                  <div className="mt-3 overflow-auto rounded-lg border border-border">
                    <table className="min-w-full text-sm">
                      <thead className="bg-muted/20">
                        <tr className="text-left text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Category</th>
                          <th className="px-3 py-2 font-medium">
                            Next Due Date
                          </th>
                          <th className="px-3 py-2 font-medium">Frequency</th>
                          <th className="px-3 py-2 font-medium text-right">
                            Amount
                          </th>
                          <th className="px-3 py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {upcomingRecurringSafe.length === 0 && (
                          <tr>
                            <td
                              className="px-3 py-4 text-center text-sm text-muted-foreground"
                              colSpan={5}
                            >
                              No recurring expenses due in the next 30 days.
                            </td>
                          </tr>
                        )}
                        {upcomingRecurringSafe.slice(0, 10).map((item) => (
                          <tr
                            key={item.id}
                            className="border-t border-border/50"
                          >
                            <td className="px-3 py-2 whitespace-nowrap">
                              {item.category || "-"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                              {formatDateLabel(item.nextDueDate)}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                              {titleCase(item.frequency)}
                            </td>
                            <td className="px-3 py-2 text-right font-medium">
                              {formatCurrency(item.amount)}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${
                                  item.status === "pending"
                                    ? "bg-accent/10 text-accent"
                                    : "bg-secondary/10 text-secondary"
                                }`}
                              >
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    item.status === "pending"
                                      ? "bg-accent"
                                      : "bg-secondary"
                                  }`}
                                />
                                {titleCase(item.status)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-base font-semibold">
                      Upcoming Recurring Summary
                    </h4>
                    <span className="text-xs text-muted-foreground">
                      Next 30 days
                    </span>
                  </div>
                  {!upcomingSummary || upcomingSummary.totalCount === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No recurring expenses due in the next 30 days.
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border border-border/60 bg-bg p-3">
                        <div className="text-xs text-muted-foreground">
                          Next due
                        </div>
                        <div className="text-sm font-medium">
                          {upcomingSummary.nextDue
                            ? `${
                                upcomingSummary.nextDue.category || "Expense"
                              } · ${formatDateLabel(
                                upcomingSummary.nextDue.nextDueDate,
                              )}`
                            : "No pending dues"}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {upcomingSummary.nextDue
                            ? formatCurrency(upcomingSummary.nextDue.amount)
                            : "-"}
                        </div>
                      </div>
                      <div className="rounded-md border border-border/60 bg-bg p-3">
                        <div className="text-xs text-muted-foreground">
                          Pending this window
                        </div>
                        <div className="text-sm font-medium">
                          {formatCurrency(upcomingSummary.pendingAmount)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {upcomingSummary.pendingCount} pending items
                        </div>
                      </div>
                      <div className="rounded-md border border-border/60 bg-bg p-3">
                        <div className="text-xs text-muted-foreground">
                          Total upcoming
                        </div>
                        <div className="text-sm font-medium">
                          {formatCurrency(upcomingSummary.totalAmount)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {upcomingSummary.totalCount} items
                        </div>
                      </div>
                      <div className="rounded-md border border-border/60 bg-bg p-3">
                        <div className="text-xs text-muted-foreground">
                          Top category
                        </div>
                        <div className="text-sm font-medium">
                          {upcomingSummary.topCategory
                            ? upcomingSummary.topCategory[0]
                            : "-"}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {upcomingSummary.topCategory
                            ? formatCurrency(upcomingSummary.topCategory[1])
                            : "-"}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <h4 className="text-base font-semibold">
                    Recurring vs One-Time
                  </h4>
                  <PieSplitChart breakdown={spendBreakdownSafe} />
                </div>
                <div className="rounded-lg border border-border p-4">
                  <h4 className="text-base font-semibold">
                    Recurring Expense Trend
                  </h4>
                  <TrendLineChart data={recurringTrendSafe} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            Finance data not available.
          </div>
        )}
      </section>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      {/* Project assignments */}
      <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold">Project Assignments</h3>
            <p className="text-sm text-muted-foreground">
              Employees and their assigned projects
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={assignQ}
              onChange={(e) => {
                setAssignPage(1);
                setAssignQ(e.target.value);
              }}
              placeholder="Search name or email..."
              className="h-10 w-64 rounded-md border border-border bg-surface px-3"
            />
            <select
              className="h-10 rounded-md border border-border bg-surface px-2 text-sm"
              value={assignLimit}
              onChange={(e) => {
                setAssignPage(1);
                setAssignLimit(parseInt(e.target.value, 10));
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

        <div className="mt-3 text-sm text-muted-foreground">
          {loadingProjects
            ? "Loading..."
            : `Showing ${assignStart}-${assignEnd} of ${assignTotal}`}
        </div>

        <div className="mt-2 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Employee</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Projects</th>
              </tr>
            </thead>
            <tbody>
              {assignRows.map(({ emp, projs }) => (
                <tr key={emp.id} className="border-t border-border/60">
                  <td className="py-2 pr-4 whitespace-nowrap">{emp.name}</td>
                  <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                    {emp.email}
                  </td>
                  <td className="py-2 pr-4 text-black whitespace-nowrap">
                    {(() => {
                      const onLeave = !!leaveMap[emp.id];
                      const punched = !!attendanceMap[emp.id];
                      const label = onLeave
                        ? "On Leave"
                        : punched
                          ? "Present"
                          : "Not Punched In Yet";
                      const tone = onLeave
                        ? "bg-accent/10 text-accent"
                        : punched
                          ? "bg-secondary/10 text-secondary"
                          : "bg-muted text-black";
                      const dot = onLeave
                        ? "bg-accent"
                        : punched
                          ? "bg-secondary"
                          : "bg-black";
                      return (
                        <span
                          className={[
                            "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium",
                            tone,
                          ].join(" ")}
                        >
                          <span className={`h-2 w-2 rounded-full ${dot}`} />
                          {label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-2">
                    {projs.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {projs.map((p) => (
                          <span
                            key={p._id}
                            className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs"
                            title={p.title}
                          >
                            {p.title}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        No assignments
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {assignTotal === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="py-4 text-center text-muted-foreground"
                  >
                    {loadingProjects
                      ? "Loading assignments..."
                      : "No employees or projects found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50"
            onClick={() => setAssignPage(1)}
            disabled={assignPage === 1}
          >
            First
          </button>
          <button
            className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50"
            onClick={() => setAssignPage((p) => Math.max(1, p - 1))}
            disabled={assignPage === 1}
          >
            Prev
          </button>
          <div className="text-sm text-muted-foreground">
            Page {assignPage} of {assignPages}
          </div>
          <button
            className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50"
            onClick={() => setAssignPage((p) => Math.min(assignPages, p + 1))}
            disabled={assignPage >= assignPages}
          >
            Next
          </button>
          <button
            className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50"
            onClick={() => setAssignPage(assignPages)}
            disabled={assignPage >= assignPages}
          >
            Last
          </button>
        </div>
      </section>

      {locationPrompt.open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
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

      {projectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 -mt-[32px]"
            onClick={() => setProjectModalId(null)}
          />
          <div className="relative w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold">
                  {projectModal.row.title}
                </h4>
                <div className="text-sm text-muted-foreground">
                  Quick project analytics
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setProjectModalId(null)}
              >
                Close
              </Button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border/60 bg-bg p-3">
                <div className="text-xs text-muted-foreground">
                  Total logged
                </div>
                <div className="text-lg font-semibold">
                  {minutesToHours(projectModal.row.spentMinutes)} h
                </div>
              </div>
              <div className="rounded-md border border-border/60 bg-bg p-3">
                <div className="text-xs text-muted-foreground">Estimated</div>
                <div className="text-lg font-semibold">
                  {minutesToHours(projectModal.row.estimatedMinutes)} h
                </div>
              </div>
              {projectModal.row.monthlyCapMinutes > 0 && (
                <div className="rounded-md border border-border/60 bg-bg p-3">
                  <div className="text-xs text-muted-foreground">
                    This month
                  </div>
                  <div className="text-lg font-semibold">
                    {minutesToHours(projectModal.row.monthlySpentMinutes)} /{" "}
                    {minutesToHours(projectModal.row.monthlyCapMinutes)} h
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {projectModal.row.monthlySpentMinutes >
                    projectModal.row.monthlyCapMinutes ? (
                      <span className="text-error">
                        Over by{" "}
                        {minutesToHours(
                          projectModal.row.monthlySpentMinutes -
                            projectModal.row.monthlyCapMinutes,
                        )}{" "}
                        h this month
                      </span>
                    ) : (
                      <span>
                        {minutesToHours(
                          Math.max(
                            0,
                            projectModal.row.monthlyCapMinutes -
                              projectModal.row.monthlySpentMinutes,
                          ),
                        )}{" "}
                        h remaining this month
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div className="rounded-md border border-border/60 bg-bg p-3">
                <div className="text-xs text-muted-foreground">Tasks</div>
                <div className="text-lg font-semibold">
                  {projectModal.row.taskCount}
                </div>
              </div>
              <div className="rounded-md border border-border/60 bg-bg p-3">
                <div className="text-xs text-muted-foreground">Time logs</div>
                <div className="text-lg font-semibold">
                  {projectModal.row.logCount}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-border/60 bg-bg p-3">
              <div className="text-xs text-muted-foreground">Status</div>
              <div className="text-base font-medium">
                {projectModal.row.spentMinutes >
                projectModal.row.estimatedMinutes ? (
                  <span className="text-error">
                    {`Over by ${minutesToHours(
                      projectModal.row.spentMinutes -
                        projectModal.row.estimatedMinutes,
                    )} h`}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {`Remaining ${minutesToHours(
                      Math.max(
                        0,
                        projectModal.row.estimatedMinutes -
                          projectModal.row.spentMinutes,
                      ),
                    )} h`}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4">
              <div className="text-sm font-semibold mb-2">Who worked</div>
              {projectModal.contributors.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No time logged this month.
                </div>
              ) : (
                <div className="space-y-2">
                  {projectModal.contributors.slice(0, 6).map((item) => {
                    const pct =
                      projectModal.totalMinutes > 0
                        ? Math.round(
                            (item.minutes / projectModal.totalMinutes) * 100,
                          )
                        : 0;
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="truncate">{item.name}</span>
                        <span className="text-muted-foreground">
                          {minutesToHours(item.minutes)} h
                          {pct ? ` · ${pct}%` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <Link
                to="/admin/reports/projects"
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-bg"
              >
                View full analytics
              </Link>
            </div>
          </div>
        </div>
      )}

      {showMissing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 -mt-[32px]"
            onClick={() => setShowMissing(false)}
          />
          <div className="relative w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">
                Pending Attendance Issues
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
            ) : blockingIssues.length === 0 ? (
              <div className="text-sm">No unresolved days. You're all set!</div>
            ) : (
              <ul className="space-y-2 max-h-80 overflow-auto pr-1">
                {blockingIssues.map((issue) => (
                  <li
                    key={issue.date}
                    className="flex flex-col gap-2 rounded border border-border px-3 py-2"
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
                        <div className="text-xs text-muted-foreground">
                          {renderIssueHint(issue)}
                        </div>
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
                              openPunchModal(issue.date);
                            }}
                          >
                            {issue.type === "autoPunch"
                              ? "Fix punch-out"
                              : "Set punch-out"}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-center justify-end">
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
              Mark the selected day as leave to resolve the attendance issue
              instantly. This bypasses approval.
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
                      date: e.target.value || null,
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
                  <option value="UNPAID">Unpaid</option>
                  <option value="SICK">Sick</option>
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-muted-foreground">Reason (optional)</span>
                <textarea
                  className="min-h-[80px] rounded-md border border-border bg-surface px-2 py-2 text-sm"
                  value={leaveModal.reason}
                  onChange={(e) =>
                    setLeaveModal((prev) => ({
                      ...prev,
                      reason: e.target.value,
                    }))
                  }
                  placeholder="Add context for the leave request"
                  disabled={leaveModal.saving}
                />
              </label>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={() => (!leaveModal.saving ? closeLeaveModal() : null)}
                disabled={leaveModal.saving}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-60"
                onClick={submitLeave}
                disabled={leaveModal.saving || !leaveModal.startDate}
              >
                {leaveModal.saving ? "Applying…" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      )}

      {punchModal.open && punchModal.date && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 -mt-[32px]"
            onClick={() => (!punchModal.saving ? closePunchModal() : null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">
                {`Fix punch-out for ${fmtDateKey(punchModal.date)}`}
              </h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => (!punchModal.saving ? closePunchModal() : null)}
                disabled={punchModal.saving}
              >
                Close
              </Button>
            </div>
            <div className="text-sm text-muted-foreground mb-3">
              Set the punch-out time recorded for this day to clear the pending
              attendance issue.
            </div>
            {punchModal.error && (
              <div className="mb-3 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                {punchModal.error}
              </div>
            )}
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="w-36 text-muted-foreground">
                  Punch-out time
                </span>
                <input
                  type="time"
                  className="h-9 rounded-md border border-border bg-surface px-2"
                  value={punchModal.time}
                  onChange={(e) =>
                    setPunchModal((prev) => ({
                      ...prev,
                      time: e.target.value,
                    }))
                  }
                  disabled={punchModal.saving}
                />
              </label>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={() => (!punchModal.saving ? closePunchModal() : null)}
                disabled={punchModal.saving}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-accent px-4 py-2 text-white disabled:opacity-60"
                onClick={submitPunch}
                disabled={punchModal.saving || !punchModal.time}
              >
                {punchModal.saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
