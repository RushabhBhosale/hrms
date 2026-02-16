import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { formatDateDisplay } from "../../lib/utils";
import {
  Th,
  Td,
  SkeletonRows,
  PaginationFooter,
} from "../../components/utils/Table";
import { StatusBadge } from "../../components/utils/StatusBadge";

type Leave = {
  _id: string;
  employee: { _id: string; name: string };
  startDate: string;
  endDate: string;
  type: "CASUAL" | "PAID" | "UNPAID" | "SICK";
  allocations?: {
    paid?: number;
    casual?: number;
    sick?: number;
    unpaid?: number;
  };
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminMessage?: string;
};

export default function LeaveApprovals() {
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | Leave["type"]>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | Leave["status"]>(
    "ALL",
  );
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortKey, setSortKey] = useState<
    "employee" | "start" | "end" | "type" | "status"
  >("start");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [modal, setModal] = useState<{
    id: string;
    action: "approve" | "reject";
  } | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      setLoading(true);
      setErr(null);
      const res = await api.get("/leaves/assigned");
      setRows(res.data.leaves || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load leaves");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const id = searchParams.get("leave");
    if (!id) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`leave-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
    return () => clearTimeout(t);
  }, [rows, searchParams]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (statusFilter === "ALL" || r.status === statusFilter) &&
        (typeFilter === "ALL" || r.type === typeFilter) &&
        (!term || r.employee.name.toLowerCase().includes(term)),
    );
  }, [rows, q, statusFilter, typeFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "employee":
          return dir * a.employee.name.localeCompare(b.employee.name);
        case "end":
          return (
            dir *
            (new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
          );
        case "type":
          return dir * a.type.localeCompare(b.type);
        case "status":
          return dir * a.status.localeCompare(b.status);
        case "start":
        default:
          return (
            dir *
            (new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
          );
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(total, page * limit);
  const pageRows = useMemo(
    () => sorted.slice((page - 1) * limit, (page - 1) * limit + limit),
    [sorted, page, limit],
  );

  function toggleSort(k: typeof sortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "start" ? "desc" : "asc");
    }
  }

  function formatType(l: Leave) {
    const parts: string[] = [];
    const fmt = (n?: number) =>
      Number.isFinite(n)
        ? Math.abs((n ?? 0) % 1) < 1e-4
          ? `${Math.round(n!)}`
          : `${Math.round((n || 0) * 100) / 100}`
        : null;
    const add = (label: string, val?: number) => {
      const num = fmt(val);
      if (num && Number(num) > 0) parts.push(`${num} ${label}`);
    };
    add("Paid", l.allocations?.paid);
    add("Casual", l.allocations?.casual);
    add("Sick", l.allocations?.sick);
    add("Unpaid", l.allocations?.unpaid);
    if (parts.length) return parts.join(" + ");
    return l.type;
  }

  async function confirmAction() {
    if (!modal) return;
    try {
      setSubmitting(true);
      await api.post(`/leaves/${modal.id}/${modal.action}`, { message });
      setModal(null);
      setMessage("");
      load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Leave Approvals</h2>
        <p className="text-sm text-muted-foreground">
          Review leave requests from your team.
        </p>
      </div>
      <div className="flex gap-2 flex-wrap md:items-end">
        <select
          className="h-10 rounded-md border border-border bg-surface px-3"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
        >
          <option value="ALL">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <select
          className="h-10 rounded-md border border-border bg-surface px-3"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as any)}
        >
          <option value="ALL">All Types</option>
          <option value="CASUAL">Casual</option>
          <option value="PAID">Paid</option>
          <option value="UNPAID">Unpaid</option>
          <option value="SICK">Sick</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name"
          className="h-10 w-64 rounded-md border border-border bg-surface px-3"
        />
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `Showing ${start}-${end} of ${total} requests`}
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
        <table className="w-full text-sm">
          <thead className="bg-bg">
            <tr className="text-left">
              <Th
                sortable
                onSort={() => toggleSort("employee")}
                dir={sortKey === "employee" ? sortDir : null}
              >
                Employee
              </Th>
              <Th
                sortable
                onSort={() => toggleSort("start")}
                dir={sortKey === "start" ? sortDir : null}
              >
                Start
              </Th>
              <Th
                sortable
                onSort={() => toggleSort("end")}
                dir={sortKey === "end" ? sortDir : null}
              >
                End
              </Th>
              <Th
                sortable
                onSort={() => toggleSort("type")}
                dir={sortKey === "type" ? sortDir : null}
              >
                Type
              </Th>
              <Th
                sortable
                onSort={() => toggleSort("status")}
                dir={sortKey === "status" ? sortDir : null}
              >
                Status
              </Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={6} cols={6} />
            ) : pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  No leave requests.
                </td>
              </tr>
            ) : (
              pageRows.map((l) => (
                <tr
                  key={l._id}
                  id={`leave-${l._id}`}
                  className={[
                    "border-t border-border/70",
                    searchParams.get("leave") === l._id ? "bg-primary/5" : "",
                  ].join(" ")}
                >
                  <Td>{l.employee?.name || "-"}</Td>
                  <Td>{formatDateDisplay(l.startDate)}</Td>
                  <Td>{formatDateDisplay(l.endDate)}</Td>
                  <Td>{formatType(l)}</Td>
                  <Td>
                    <StatusBadge status={l.status} />
                  </Td>
                  <Td>
                    {l.status === "PENDING" ? (
                      <div className="flex gap-2">
                        <button
                          className="rounded-md bg-secondary px-3 py-1 text-white"
                          onClick={() =>
                            setModal({ id: l._id, action: "approve" })
                          }
                        >
                          Approve
                        </button>
                        <button
                          className="rounded-md bg-accent px-3 py-1 text-white"
                          onClick={() =>
                            setModal({ id: l._id, action: "reject" })
                          }
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span>{l.adminMessage || "-"}</span>
                    )}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="border-t border-border px-4 py-3">
          <PaginationFooter
            page={page}
            pages={pages}
            onFirst={() => setPage(1)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(pages, p + 1))}
            onLast={() => setPage(pages)}
            disabled={loading}
          />
        </div>
      </section>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 -mt-[32px]"
            onClick={() => setModal(null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h4 className="text-lg font-semibold mb-2">
              {modal.action === "approve" ? "Approve Leave" : "Reject Leave"}
            </h4>
            <p className="text-sm text-muted-foreground mb-3">
              Add a short message (optional).
            </p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
              placeholder="Message"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-2"
                onClick={() => setModal(null)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className={`rounded-md px-4 py-2 text-white ${
                  modal.action === "approve" ? "bg-secondary" : "bg-accent"
                } disabled:opacity-60`}
                onClick={confirmAction}
                disabled={submitting}
              >
                {submitting
                  ? "Saving…"
                  : modal.action === "approve"
                    ? "Approve"
                    : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
