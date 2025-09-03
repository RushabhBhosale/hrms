import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";

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
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, assignee, status, priority…"
            className="h-10 w-80 rounded-md border border-border bg-surface px-3 outline-none ring-offset-2 focus:ring-2 focus:ring-primary"
          />
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
                <Th>Title</Th>
                <Th>Assignee</Th>
                <Th>Status</Th>
                <Th>Priority</Th>
                <Th>Time Spent</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={6} cols={6} />
              ) : filtered.length === 0 ? (
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
                filtered.map((t) => {
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
                      <Td classNameOverride="whitespace-nowrap text-muted">
                        {created}
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
                </div>
              );
            })
          )}
        </div>
      </section>

      <div className="flex items-center gap-2 justify-end">
        <button
          className="h-9 px-3 rounded-md border border-border text-sm disabled:opacity-50 hover:bg-bg"
          onClick={() => setPage(1)}
          disabled={page === 1}
        >
          First
        </button>
        <button
          className="h-9 px-3 rounded-md border border-border text-sm disabled:opacity-50 hover:bg-bg"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
        >
          Prev
        </button>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Page</span>
          <input
            type="number"
            min={1}
            max={pages}
            value={page}
            onChange={(e) =>
              setPage(Math.min(Math.max(1, Number(e.target.value) || 1), pages))
            }
            className="h-9 w-16 rounded-md border border-border bg-surface px-2 text-center"
          />
          <span className="text-muted">of {pages}</span>
        </div>
        <button
          className="h-9 px-3 rounded-md border border-border text-sm disabled:opacity-50 hover:bg-bg"
          onClick={() => setPage((p) => Math.min(pages, p + 1))}
          disabled={page >= pages}
        >
          Next
        </button>
        <button
          className="h-9 px-3 rounded-md border border-border text-sm disabled:opacity-50 hover:bg-bg"
          onClick={() => setPage(pages)}
          disabled={page === pages}
        >
          Last
        </button>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </th>
  );
}

function Td({
  children,
  classNameOverride,
}: {
  children: React.ReactNode;
  classNameOverride?: string;
}) {
  return (
    <td
      className={["px-4 py-3 align-middle", classNameOverride || ""].join(" ")}
    >
      {children}
    </td>
  );
}

function SkeletonRows({ rows, cols }: { rows: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t border-border/70">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-4 py-3">
              <div className="h-4 w-40 bg-bg rounded animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
