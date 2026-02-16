import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { Th, Td, PaginationFooter } from "../../components/utils/Table";
import { getEmployee } from "../../lib/auth";
import { toast } from "react-hot-toast";
import { CheckCircle2, XCircle } from "lucide-react";

type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";
type RequestType = "ADD" | "EDIT";

type AttendanceRequest = {
  _id: string;
  employee: { _id: string; name: string; employeeId?: string };
  requestedBy: { _id: string; name: string; employeeId?: string };
  date: string;
  type: RequestType;
  status: RequestStatus;
  punchIn: string;
  punchOut: string;
  message?: string;
  adminMessage?: string;
  createdAt: string;
  resolvedAt?: string;
};

export default function AttendanceRequests() {
  const me = getEmployee();
  const canAct =
    me?.primaryRole === "ADMIN" || me?.primaryRole === "SUPERADMIN";

  const [rows, setRows] = useState<AttendanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<RequestStatus | "ALL">("PENDING");
  const [typeFilter, setTypeFilter] = useState<RequestType | "ALL">("ALL");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const [modal, setModal] = useState<{
    id: string;
    action: "approve" | "reject";
  } | null>(null);
  const [adminMessage, setAdminMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      setLoading(true);
      setErr(null);
      const res = await api.get("/attendance/manual-requests", {
        params: {
          status,
          type: typeFilter,
        },
      });
      setRows(res.data.requests || []);
    } catch (e: any) {
      setErr(
        e?.response?.data?.error || "Failed to load attendance change requests",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [status, typeFilter]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => {
      const empName = (r.employee?.name || "").toLowerCase();
      const requester = (r.requestedBy?.name || "").toLowerCase();
      return empName.includes(term) || requester.includes(term);
    });
  }, [rows, q]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const clampedPage = Math.min(page, pages);
  const start = total === 0 ? 0 : (clampedPage - 1) * limit + 1;
  const end = Math.min(total, clampedPage * limit);
  const pageRows = useMemo(
    () =>
      filtered.slice(
        (clampedPage - 1) * limit,
        (clampedPage - 1) * limit + limit,
      ),
    [filtered, clampedPage, limit],
  );

  useEffect(() => {
    if (page !== clampedPage) setPage(clampedPage);
  }, [clampedPage, page]);

  function fmtDate(value: string) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
  }
  function fmtDateTime(value?: string) {
    if (!value) return "-";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
  }

  function openAction(id: string, action: "approve" | "reject") {
    setModal({ id, action });
    setAdminMessage("");
  }

  async function confirmAction() {
    if (!modal) return;
    try {
      setSubmitting(true);
      const path =
        modal.action === "approve"
          ? `/attendance/manual-requests/${modal.id}/approve`
          : `/attendance/manual-requests/${modal.id}/reject`;
      await api.post(path, { adminMessage });
      toast.success(
        modal.action === "approve" ? "Request approved" : "Request rejected",
      );
      setModal(null);
      setAdminMessage("");
      load();
    } catch (e: any) {
      toast.error(
        e?.response?.data?.error || `Failed to ${modal.action} request`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Attendance Requests</h2>
          <p className="text-sm text-muted-foreground">
            Review employee punch-in/out change requests.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            className="h-10 rounded-md border border-border bg-surface px-3"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value as any);
            }}
          >
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="ALL">All</option>
          </select>
          <select
            className="h-10 rounded-md border border-border bg-surface px-3"
            value={typeFilter}
            onChange={(e) => {
              setPage(1);
              setTypeFilter(e.target.value as any);
            }}
          >
            <option value="ALL">All types</option>
            <option value="ADD">Add punches</option>
            <option value="EDIT">Edit punches</option>
          </select>
          <input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Search employee/requester…"
            className="h-10 w-64 rounded-md border border-border bg-surface px-3"
          />
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <div>
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

        <div className="overflow-x-auto w-full">
          <table className="w-full min-w-full table-fixed text-sm">
            <thead className="bg-bg w-full">
              <tr className="text-left">
                <Th className="whitespace-nowrap">Employee</Th>
                <Th>Date</Th>
                <Th>Punches</Th>
                <Th>Message</Th>
                <Th>Updated</Th>
                <Th className="text-right whitespace-nowrap">Action</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-10 text-center text-muted-foreground"
                  >
                    Loading…
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-10 text-center text-muted-foreground"
                  >
                    No requests found.
                  </td>
                </tr>
              ) : (
                pageRows.map((r) => (
                  <tr
                    key={r._id}
                    className="border-t border-border/70 hover:bg-bg/60"
                  >
                    <Td>
                      <div className="font-medium">{r.employee?.name}</div>
                      {r.employee?.employeeId && (
                        <div className="text-[11px] text-muted-foreground">
                          #{r.employee.employeeId}
                        </div>
                      )}
                    </Td>
                    <Td>{fmtDate(r.date)}</Td>
                    <Td className="text-xs font-mono">
                      {r.punchIn} → {r.punchOut}
                    </Td>
                    <Td className="max-w-xs">
                      {r.message ? (
                        <div className="line-clamp-2">{r.message}</div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </Td>
                    <Td>
                      <div className="text-xs text-muted-foreground">
                        {r.resolvedAt
                          ? fmtDateTime(r.resolvedAt)
                          : fmtDateTime(r.createdAt)}
                      </div>
                      {r.adminMessage && (
                        <div className="text-[11px] text-muted-foreground line-clamp-2">
                          {r.adminMessage}
                        </div>
                      )}
                    </Td>
                    <Td className="text-right">
                      {r.status === "PENDING" ? (
                        <div className="inline-flex gap-2">
                          <button
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-error text-white shadow-sm hover:bg-error/90 disabled:opacity-50"
                            onClick={() => openAction(r._id, "reject")}
                            disabled={!canAct}
                            title="Reject request"
                            aria-label="Reject request"
                          >
                            <XCircle size={18} />
                          </button>
                          <button
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow-sm hover:bg-primary/90 disabled:opacity-50"
                            onClick={() => openAction(r._id, "approve")}
                            disabled={!canAct}
                            title="Approve request"
                            aria-label="Approve request"
                          >
                            <CheckCircle2 size={18} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border bg-surface px-4 py-3">
          <PaginationFooter
            page={clampedPage}
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
        <div className="fixed inset-0 z-[75] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => (!submitting ? setModal(null) : null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h4 className="text-lg font-semibold mb-1">
              {modal.action === "approve"
                ? "Approve request"
                : "Reject request"}
            </h4>
            <p className="text-sm text-muted-foreground mb-3">
              Leave a note for the employee (optional).
            </p>
            <textarea
              className="w-full min-h-[120px] rounded-md border border-border bg-white px-3 py-2 text-sm"
              placeholder="Message to include with this decision"
              value={adminMessage}
              onChange={(e) => setAdminMessage(e.target.value)}
              disabled={submitting}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={() => (!submitting ? setModal(null) : null)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className={`rounded-md px-4 py-2 text-sm text-white ${
                  modal.action === "approve" ? "bg-primary" : "bg-error"
                } disabled:opacity-60`}
                onClick={confirmAction}
                disabled={submitting || !canAct}
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
