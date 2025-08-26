import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

type Leave = {
  _id: string;
  employee: { _id: string; name: string };
  startDate: string;
  endDate: string;
  type: "CASUAL" | "PAID" | "UNPAID" | "SICK";
  reason?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminMessage?: string;
};

export default function LeaveRequests() {
  const [rows, setRows] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"ALL" | Leave["status"]>("ALL");
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
      const res = await api.get("/leaves/company");
      setRows(res.data.leaves || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load leave requests");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows
      .filter((r) => (status === "ALL" ? true : r.status === status))
      .filter(
        (r) =>
          !term ||
          r.employee.name.toLowerCase().includes(term) ||
          r.reason?.toLowerCase().includes(term)
      )
      .sort(
        (a, b) =>
          new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
      );
  }, [rows, q, status]);

  async function confirmAction() {
    if (!modal) return;
    try {
      setSubmitting(true);
      await api.post(`/leaves/${modal.id}/${modal.action}`, { message });
      setModal(null);
      setMessage("");
      load();
    } catch (e) {
      // noop: surfaced by load error if any
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Leave Requests</h2>
          <p className="text-sm text-muted">
            Review and take action on employee leave requests.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            className="h-10 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
          >
            <option value="ALL">All</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or reason…"
            className="h-10 w-64 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={load}
            className="h-10 rounded-md bg-primary px-4 text-white"
          >
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-red-50 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border px-4 py-3 text-sm text-muted">
          {loading
            ? "Loading…"
            : `${filtered.length} request${filtered.length === 1 ? "" : "s"}`}
        </div>

        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-left">
                <Th>Employee</Th>
                <Th>Start</Th>
                <Th>End</Th>
                <Th>Type</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={6} cols={7} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted">
                    No leave requests.
                  </td>
                </tr>
              ) : (
                filtered.map((l) => (
                  <tr key={l._id} className="border-t border-border/70">
                    <Td className="font-medium">{l.employee.name}</Td>
                    <Td>{new Date(l.startDate).toLocaleDateString()}</Td>
                    <Td>{new Date(l.endDate).toLocaleDateString()}</Td>
                    <Td>{l.type}</Td>
                    <Td>
                      <span
                        title={l.reason || ""}
                        className="line-clamp-1 max-w-[22rem] inline-block align-middle"
                      >
                        {l.reason || "-"}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={l.status} />
                    </Td>
                    <Td>
                      {l.status === "PENDING" ? (
                        <div className="flex gap-2">
                          <button
                            className="rounded-md bg-secondary px-3 py-1 text-white disabled:opacity-60"
                            onClick={() =>
                              setModal({ id: l._id, action: "approve" })
                            }
                          >
                            Approve
                          </button>
                          <button
                            className="rounded-md bg-accent px-3 py-1 text-white disabled:opacity-60"
                            onClick={() =>
                              setModal({ id: l._id, action: "reject" })
                            }
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">
                          {l.adminMessage ? `Note: ${l.adminMessage}` : "-"}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))
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
            <div className="px-4 py-6 text-center text-muted">
              No leave requests.
            </div>
          ) : (
            filtered.map((l) => (
              <div key={l._id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{l.employee.name}</div>
                  <StatusBadge status={l.status} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted">Start</div>
                  <div>{new Date(l.startDate).toLocaleDateString()}</div>
                  <div className="text-muted">End</div>
                  <div>{new Date(l.endDate).toLocaleDateString()}</div>
                  <div className="text-muted">Type</div>
                  <div>{l.type}</div>
                  <div className="text-muted">Reason</div>
                  <div className="col-span-1">{l.reason || "-"}</div>
                </div>
                {l.status === "PENDING" ? (
                  <div className="mt-3 flex gap-2">
                    <button
                      className="rounded-md bg-secondary px-3 py-1 text-white"
                      onClick={() => setModal({ id: l._id, action: "approve" })}
                    >
                      Approve
                    </button>
                    <button
                      className="rounded-md bg-accent px-3 py-1 text-white"
                      onClick={() => setModal({ id: l._id, action: "reject" })}
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted">
                    {l.adminMessage ? `Note: ${l.adminMessage}` : "-"}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setModal(null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h4 className="text-lg font-semibold mb-2">
              {modal.action === "approve" ? "Approve Leave" : "Reject Leave"}
            </h4>
            <p className="text-sm text-muted mb-3">
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

function StatusBadge({ status }: { status: Leave["status"] }) {
  const map: Record<Leave["status"], string> = {
    PENDING: "bg-accent/10 text-accent",
    APPROVED: "bg-secondary/10 text-secondary",
    REJECTED: "bg-error/10 text-error",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${map[status]}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
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
