import { useEffect, useRef, useState, useMemo } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { resolveLocationLabel } from "../../lib/location";
import ProjectTime from "../report/ProjectTime";
import {
  Users,
  UserCheck,
  FileText,
  TrendingUp,
  Receipt,
  PieChart as PieChartIcon,
  CalendarClock,
  AlertTriangle,
} from "lucide-react";
import { Card } from "../../components/ui/Card";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
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
};

type Attendance = {
  firstPunchIn?: string;
  lastPunchOut?: string;
  lastPunchIn?: string;
  firstPunchInLocation?: string | null;
  lastPunchInLocation?: string | null;
  workedMs?: number;
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

function titleCase(value?: string | null) {
  if (!value) return "-";
  return value
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const PIE_COLORS = ["#2563eb", "#14b8a6"];

function RecurringBarChart({ data }: { data: RecurringSeriesPoint[] }) {
  if (!data.length)
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted">
        No recurring expenses due in the next 30 days.
      </div>
    );

  const chartData = data.map((point) => ({
    ...point,
    label: new Date(point.date).toLocaleDateString("en-IN", {
      month: "short",
      day: "numeric",
    }),
    total: Number(point.total || 0),
  }));

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 16, right: 12, left: 4, bottom: 12 }}
        >
          <CartesianGrid
            strokeDasharray="4 8"
            stroke="rgba(148, 163, 184, 0.35)"
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tickFormatter={(value: any) => formatCurrencyShort(Number(value))}
            tick={{ fontSize: 12 }}
          />
          <RechartsTooltip
            cursor={{ fill: "rgba(37, 99, 235, 0.08)" }}
            formatter={(value: any) => formatCurrency(Number(value))}
            labelFormatter={(_: any, payload: any) => {
              const original = payload?.[0]?.payload;
              if (!original) return "";
              return new Date(original.date).toLocaleDateString("en-IN", {
                weekday: "short",
                month: "short",
                day: "numeric",
              });
            }}
          />
          <Bar
            dataKey="total"
            fill="#2563eb"
            radius={[6, 6, 0, 0]}
            maxBarSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PieSplitChart({ breakdown }: { breakdown: SpendBreakdown }) {
  const total = breakdown.recurring.amount + breakdown.oneTime.amount;
  if (total <= 0)
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted">
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
      <div className="flex h-64 items-center justify-center text-sm text-muted">
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
        <div className="text-xs uppercase tracking-wide text-muted">
          {title}
        </div>
        <div className="text-2xl font-semibold">{value}</div>
        {subValue && <div className="text-xs text-muted">{subValue}</div>}
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

export default function AdminDash() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ employees: 0, present: 0 });
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [loadingAtt, setLoadingAtt] = useState(true);
  const [pending, setPending] = useState<"in" | "out" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [leaveMap, setLeaveMap] = useState<Record<string, boolean>>({});
  const [finance, setFinance] = useState<FinanceSummary | null>(null);
  const [loadingFinance, setLoadingFinance] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [missingIssues, setMissingIssues] = useState<MissingIssue[]>([]);
  const [missingLoading, setMissingLoading] = useState(false);
  const [missingErr, setMissingErr] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);

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
              error?.response?.data?.error || "Failed to load finance overview"
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
          ]
        );
        const empList: EmployeeLite[] = empRes.data.employees || [];
        const projList: ProjectLite[] = (projRes.data.projects || []).filter(
          (p: ProjectLite) => !p.isPersonal
        );
        setEmployees(empList);
        setProjects(projList);
        const lmap: Record<string, boolean> = {};
        (leavesRes.data.leaves || []).forEach((l: any) => {
          const id = l.employee.id || l.employee._id;
          lmap[id] = true;
        });
        setLeaveMap(lmap);
        setStats({
          employees: empList.length,
          present: att.data.attendance.length,
        });
        if (financeRes && financeRes.data) setFinance(financeRes.data);
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
        "0"
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
        e?.response?.data?.error || "Failed to load attendance issues"
      );
    } finally {
      setMissingLoading(false);
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
        e?.response?.data?.error || "Failed to load finance overview"
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
      if (action === "in") {
        locationLabel = await resolveLocationLabel();
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
    attendance?.lastPunchIn && !attendance?.lastPunchOut
  );

  const assignments = useMemo(() => {
    if (!employees.length || !projects.length)
      return [] as { emp: EmployeeLite; projs: ProjectLite[] }[];
    return employees
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((emp) => {
        const projs = projects.filter(
          (p) => p.teamLead === emp.id || (p.members || []).includes(emp.id)
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
        emp.email.toLowerCase().includes(term)
    );
  }, [assignments, assignQ]);
  const assignTotal = filteredAssignments.length;
  const assignPages = Math.max(
    1,
    Math.ceil(assignTotal / Math.max(1, assignLimit))
  );
  const assignStart =
    assignTotal === 0 ? 0 : (assignPage - 1) * assignLimit + 1;
  const assignEnd = Math.min(assignTotal, assignPage * assignLimit);
  const assignRows = useMemo(
    () =>
      filteredAssignments.slice(
        (assignPage - 1) * assignLimit,
        (assignPage - 1) * assignLimit + assignLimit
      ),
    [filteredAssignments, assignPage, assignLimit]
  );

  return (
    <div className="space-y-8">
      {hasBlockingIssues && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
              <div>
                <div className="font-medium text-warning">
                  {blockingIssues.length} pending attendance
                  {blockingIssues.length > 1 ? " issues" : " issue"} found.
                </div>
                <div className="text-muted">
                  Resolve these days to keep your attendance and reports accurate.
                </div>
                {missingErr && (
                  <div className="mt-1 text-xs text-error">{missingErr}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-border px-3 py-2 text-xs"
                onClick={loadMissingOut}
                disabled={missingLoading}
              >
                {missingLoading ? "Checking…" : "Refresh"}
              </button>
              <button
                className="rounded-md border border-border px-3 py-2 text-xs"
                onClick={() => setShowMissing(true)}
              >
                View Details
              </button>
              <button
                className="rounded-md bg-secondary px-3 py-2 text-xs text-white"
                onClick={() => navigate("/admin/attendance/manual-requests")}
              >
                Manual Resolve
              </button>
            </div>
          </div>
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
              onClick={loadAttendance}
              disabled={loadingAtt || !!pending}
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
            >
              {loadingAtt ? "Loading..." : "Refresh"}
            </button>
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

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
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

      {/* Project time analytics at top */}
      <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
        <ProjectTime onlyActive />
      </section>

      <section className="space-y-6 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Financial Overview</h3>
            <p className="text-sm text-muted">
              Invoices and company spend snapshots
            </p>
          </div>
          <button
            onClick={refreshFinance}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-bg disabled:opacity-60"
            disabled={loadingFinance}
          >
            <CalendarClock size={16} />
            {loadingFinance ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {financeError && (
          <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
            {financeError}
          </div>
        )}

        {loadingFinance && !finance ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted">
            Loading finance metrics...
          </div>
        ) : finance ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <FinanceStatCard
                icon={<FileText size={18} />}
                title="Invoices Issued"
                value={`${finance.invoiceSummary.count}`}
                subValue={`Total ${formatCurrency(
                  finance.invoiceSummary.totalAmount
                )}${
                  finance.invoiceSummary.upcomingDueAmount > 0
                    ? ` · Due soon ${formatCurrency(
                        finance.invoiceSummary.upcomingDueAmount
                      )}`
                    : ""
                }`}
              />
              <FinanceStatCard
                icon={<TrendingUp size={18} />}
                title="Outstanding"
                value={formatCurrency(finance.invoiceSummary.outstandingAmount)}
                subValue={`Overdue ${formatCurrency(
                  finance.invoiceSummary.overdueAmount
                )}`}
                tone="accent"
              />
              <FinanceStatCard
                icon={<Receipt size={18} />}
                title="Expenses YTD"
                value={formatCurrency(finance.expenseSummary.yearToDateAmount)}
                subValue={`MTD ${formatCurrency(
                  finance.expenseSummary.monthToDateAmount
                )}`}
                tone="secondary"
              />
              <FinanceStatCard
                icon={<PieChartIcon size={18} />}
                title="Recurring Spend"
                value={formatCurrency(finance.expenseSummary.recurringAmount)}
                subValue={`${finance.expenseSummary.recurringCount} recurring entries`}
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
                        <tr className="text-left text-muted">
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
                        {finance.upcomingRecurring.length === 0 && (
                          <tr>
                            <td
                              className="px-3 py-4 text-center text-sm text-muted"
                              colSpan={5}
                            >
                              No recurring expenses due in the next 30 days.
                            </td>
                          </tr>
                        )}
                        {finance.upcomingRecurring.slice(0, 10).map((item) => (
                          <tr
                            key={item.id}
                            className="border-t border-border/50"
                          >
                            <td className="px-3 py-2 whitespace-nowrap">
                              {item.category || "-"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-muted">
                              {formatDateLabel(item.nextDueDate)}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-muted">
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
                      Upcoming Spend Curve
                    </h4>
                    <span className="text-xs text-muted">
                      Total{" "}
                      {formatCurrency(
                        finance.upcomingRecurringSeries.reduce(
                          (sum, item) => sum + item.total,
                          0
                        )
                      )}
                    </span>
                  </div>
                  <RecurringBarChart data={finance.upcomingRecurringSeries} />
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <h4 className="text-base font-semibold">
                    Recurring vs One-Time
                  </h4>
                  <PieSplitChart breakdown={finance.spendBreakdown} />
                </div>
                <div className="rounded-lg border border-border p-4">
                  <h4 className="text-base font-semibold">
                    Recurring Expense Trend
                  </h4>
                  <TrendLineChart data={finance.recurringTrend} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center text-sm text-muted">
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
            <p className="text-sm text-muted">
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
            <button
              onClick={() => {
                // quick refresh of employees and projects
                (async () => {
                  try {
                    setLoadingProjects(true);
                    const [empRes, projRes, leavesRes] = await Promise.all([
                      api.get("/companies/employees"),
                      api.get("/projects", { params: { active: true } }),
                      api.get("/leaves/company/today"),
                    ]);
                    const empList: EmployeeLite[] = empRes.data.employees || [];
                    const projList: ProjectLite[] = (
                      projRes.data.projects || []
                    ).filter((p: ProjectLite) => !p.isPersonal);
                    setEmployees(empList);
                    setProjects(projList);
                    const lmap: Record<string, boolean> = {};
                    (leavesRes.data.leaves || []).forEach((l: any) => {
                      const id = l.employee.id || l.employee._id;
                      lmap[id] = true;
                    });
                    setLeaveMap(lmap);
                    setStats((s) => ({ ...s, employees: empList.length }));
                  } finally {
                    setLoadingProjects(false);
                  }
                })();
              }}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-bg disabled:opacity-60"
              disabled={loadingProjects}
            >
              {loadingProjects ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="mt-3 text-sm text-muted">
          {loadingProjects
            ? "Loading..."
            : `Showing ${assignStart}-${assignEnd} of ${assignTotal}`}
        </div>

        <div className="mt-2 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
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
                  <td className="py-2 pr-4 text-muted whitespace-nowrap">
                    {emp.email}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <span
                      className={[
                        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium",
                        leaveMap[emp.id]
                          ? "bg-accent/10 text-accent"
                          : "bg-secondary/10 text-secondary",
                      ].join(" ")}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          leaveMap[emp.id] ? "bg-accent" : "bg-secondary"
                        }`}
                      />
                      {leaveMap[emp.id] ? "On Leave" : "Present"}
                    </span>
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
                      <span className="text-muted">No assignments</span>
                    )}
                  </td>
                </tr>
              ))}
              {assignTotal === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-muted">
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
          <div className="text-sm text-muted">
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

      {showMissing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowMissing(false)}
          />
          <div className="relative w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-lg font-semibold">Pending Attendance Issues</h4>
              <button
                className="text-sm underline"
                onClick={() => setShowMissing(false)}
              >
                Close
              </button>
            </div>
            <div className="text-sm text-muted mb-3">
              Review the days below and use the tools to resolve them.
            </div>
            {missingLoading ? (
              <div className="text-sm text-muted">Loading…</div>
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
                      <div>
                        <div className="text-sm font-medium">
                          {fmtDateKey(issue.date)}
                        </div>
                        <div className="text-xs text-muted">
                          {describeIssue(issue)}
                        </div>
                      </div>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] uppercase">
                        {issue.type}
                      </span>
                    </div>
                    <div className="text-xs text-muted">
                      {renderIssueHint(issue)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Link
                        to="/admin/attendance/manual-requests"
                        className="rounded-md border border-border px-3 py-1"
                        onClick={() => setShowMissing(false)}
                      >
                        Manual Attendance Tools
                      </Link>
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
    </div>
  );
}
