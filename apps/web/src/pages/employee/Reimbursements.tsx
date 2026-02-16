import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { resolveMediaUrl } from "../../lib/utils";
import { StatusBadge, StatusValue } from "../../components/utils/StatusBadge";
import { Th, Td, PaginationFooter } from "../../components/utils/Table";
import { Loader2, Paperclip, Plus } from "lucide-react";
import { toast } from "react-hot-toast";

type ReimbursementItem = {
  _id: string;
  type?: { _id: string; name: string } | null;
  typeName: string;
  project?: { _id: string; title: string } | null;
  projectName?: string;
  amount: number;
  description?: string;
  employeeNote?: string;
  adminNote?: string;
  status: StatusValue;
  attachments: string[];
  createdAt: string;
  resolvedAt?: string;
};

export default function EmployeeReimbursements() {
  const [items, setItems] = useState<ReimbursementItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusValue | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  async function loadItems(statusOverride?: StatusValue | "ALL") {
    const statusParam = statusOverride ?? statusFilter;
    try {
      setLoadingList(true);
      const res = await api.get("/reimbursements", {
        params: { status: statusParam },
      });
      setItems(res.data?.reimbursements || []);
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error || "Failed to load reimbursements",
      );
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    loadItems(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (items || []).filter((r) => {
      if (!term) return true;
      return (
        (r.type?.name || r.typeName || "").toLowerCase().includes(term) ||
        (r.project?.title || r.projectName || "").toLowerCase().includes(term) ||
        (r.description || "").toLowerCase().includes(term) ||
        (r.employeeNote || "").toLowerCase().includes(term) ||
        (r.adminNote || "").toLowerCase().includes(term)
      );
    });
  }, [items, search]);

  const totalAmount = useMemo(
    () =>
      filtered.reduce(
        (sum, r) =>
          sum + (Number.isFinite(Number(r.amount)) ? Number(r.amount) : 0),
        0,
      ),
    [filtered],
  );

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

  function formatDate(value?: string) {
    if (!value) return "-";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Reimbursements</h2>
          <p className="text-sm text-muted-foreground">
            Track your submitted reimbursement requests.
          </p>
        </div>
        <Link
          to="/app/reimbursements/new"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white"
        >
          <Plus size={16} />
          Request reimbursement
        </Link>
      </div>

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="font-semibold">Your requests</h3>
            <p className="text-xs text-muted-foreground">
              {loadingList
                ? "Loading…"
                : `Showing ${start}-${end} of ${total} requests`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs text-muted-foreground whitespace-nowrap">
              Total (filtered): Rs. {totalAmount.toFixed(2)}
            </div>
            <select
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              value={statusFilter}
              onChange={(e) => {
                setPage(1);
                setStatusFilter(e.target.value as StatusValue | "ALL");
              }}
            >
              <option value="ALL">All</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <input
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
              placeholder="Search type or description..."
              className="h-9 w-56 rounded-md border border-border bg-surface px-3 text-sm"
            />
            <select
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              value={limit}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setLimit(Number.isNaN(v) ? 10 : v);
                setPage(1);
              }}
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border/70">
            <thead className="bg-bg">
              <tr>
                <Th>Submitted</Th>
                <Th>Type</Th>
                <Th>Project</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th>Description</Th>
                <Th>Attachments</Th>
                <Th>Admin note</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loadingList ? (
                <tr>
                  <Td
                    colSpan={8}
                    className="text-center text-sm text-muted-foreground"
                  >
                    <div className="flex items-center justify-center gap-2 py-6">
                      <Loader2 size={16} className="animate-spin" />
                      Loading...
                    </div>
                  </Td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <Td
                    colSpan={8}
                    className="text-center text-sm text-muted-foreground"
                  >
                    No requests found.
                  </Td>
                </tr>
              ) : (
                pageRows.map((r) => (
                  <tr key={r._id} className="hover:bg-bg/60">
                    <Td>{formatDate(r.createdAt)}</Td>
                    <Td>{r.type?.name || r.typeName || "-"}</Td>
                    <Td>{r.project?.title || r.projectName || "-"}</Td>
                    <Td>Rs. {Number(r.amount || 0).toFixed(2)}</Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td className="max-w-xs text-sm">
                      {r.description || "-"}
                      {r.employeeNote ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          Your note: {r.employeeNote}
                        </div>
                      ) : null}
                    </Td>
                    <Td className="text-sm">
                      {r.attachments?.length ? (
                        <div className="flex flex-wrap gap-2">
                          {r.attachments.map((file) => (
                            <a
                              key={file}
                              className="inline-flex items-center gap-1 rounded-full bg-bg px-2 py-1 text-xs text-primary underline"
                              href={resolveMediaUrl(file) || "#"}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Paperclip size={12} />
                              View
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </Td>
                    <Td className="text-sm">
                      {r.adminNote ? (
                        r.adminNote
                      ) : r.status !== "PENDING" ? (
                        <span className="text-muted-foreground text-xs">
                          No note added
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-4 py-3">
          <PaginationFooter
            page={clampedPage}
            pages={pages}
            onFirst={() => setPage(1)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(pages, p + 1))}
            onLast={() => setPage(pages)}
            disabled={loadingList}
          />
        </div>
      </section>
    </div>
  );
}
