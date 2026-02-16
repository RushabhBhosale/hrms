import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { resolveMediaUrl } from "../../lib/utils";
import { StatusBadge, StatusValue } from "../../components/utils/StatusBadge";
import { Th, Td, PaginationFooter } from "../../components/utils/Table";
import { CheckCircle2, Loader2, Paperclip, XCircle } from "lucide-react";
import { toast } from "react-hot-toast";
import { Link } from "react-router-dom";

type ReimbursementType = {
  _id: string;
  name: string;
  description?: string;
  isActive?: boolean;
};

type ProjectRef = {
  _id: string;
  title: string;
};

type EmployeeRef = { _id: string; name: string; employeeId?: string };

type ReimbursementItem = {
  _id: string;
  employee: EmployeeRef;
  type?: ReimbursementType | null;
  typeName: string;
  project?: ProjectRef | null;
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

const PROJECT_FILTER_CUSTOM = "__CUSTOM__";
const PROJECT_FILTER_NONE = "__NONE__";

export default function ReimbursementsAdmin() {
  const [types, setTypes] = useState<ReimbursementType[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);

  const [items, setItems] = useState<ReimbursementItem[]>([]);
  const [status, setStatus] = useState<StatusValue | "ALL">("PENDING");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [projectFilter, setProjectFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [amountEdit, setAmountEdit] = useState<number | "">("");

  const [modal, setModal] = useState<{
    id: string;
    action: "approve" | "reject";
  } | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  async function loadTypes() {
    try {
      const res = await api.get("/reimbursements/types", {
        params: { includeInactive: true },
      });
      setTypes(res.data?.types || []);
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error || "Failed to load reimbursement types",
      );
    }
  }

  async function loadProjects() {
    try {
      setLoadingProjects(true);
      const res = await api.get("/projects", { params: { active: "true" } });
      const list: ProjectRef[] = (res.data?.projects || []).map((p: any) => ({
        _id: p._id,
        title: p.title,
      }));
      setProjects(list);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to load projects");
    } finally {
      setLoadingProjects(false);
    }
  }

  async function loadItems() {
    try {
      setLoading(true);
      const typeParam = typeFilter !== "ALL" ? typeFilter : undefined;
      const projectParam =
        projectFilter !== "ALL" &&
        projectFilter !== PROJECT_FILTER_CUSTOM &&
        projectFilter !== PROJECT_FILTER_NONE
          ? projectFilter
          : undefined;
      const res = await api.get("/reimbursements", {
        params: {
          status,
          typeId: typeParam,
          projectId: projectParam,
        },
      });
      setItems(res.data?.reimbursements || []);
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error || "Failed to load reimbursements",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTypes();
    loadProjects();
  }, []);

  useEffect(() => {
    loadItems();
  }, [status, typeFilter, projectFilter]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (items || []).filter((r) => {
      if (typeFilter !== "ALL" && r.type?._id !== typeFilter) return false;
      if (projectFilter !== "ALL") {
        if (projectFilter === PROJECT_FILTER_CUSTOM) {
          if (r.project || !r.projectName) return false;
        } else if (projectFilter === PROJECT_FILTER_NONE) {
          if (r.project || r.projectName) return false;
        } else if ((r.project?._id || "") !== projectFilter) {
          return false;
        }
      }
      if (!term) return true;
      const emp = (r.employee?.name || "").toLowerCase();
      const typeName = (r.type?.name || r.typeName || "").toLowerCase();
      const desc = (r.description || "").toLowerCase();
      return (
        emp.includes(term) ||
        typeName.includes(term) ||
        desc.includes(term) ||
        (r.project?.title || r.projectName || "").toLowerCase().includes(term)
      );
    });
  }, [items, typeFilter, projectFilter, q]);

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

  function openAction(id: string, action: "approve" | "reject") {
    setModal({ id, action });
    setAdminNote("");
    if (action === "approve") {
      const item = items.find((i) => i._id === id);
      setAmountEdit(item?.amount ?? "");
    } else {
      setAmountEdit("");
    }
  }

  async function confirmAction() {
    if (!modal) return;
    try {
      setSubmitting(true);
      const path =
        modal.action === "approve"
          ? `/reimbursements/${modal.id}/approve`
          : `/reimbursements/${modal.id}/reject`;
      const payload: Record<string, any> = { adminNote };
      if (modal.action === "approve" && amountEdit !== "") {
        const amtNum = Number(amountEdit);
        if (Number.isNaN(amtNum)) {
          toast.error("Please enter a valid amount");
          setSubmitting(false);
          return;
        }
        if (amtNum < 0) {
          toast.error("Amount cannot be negative");
          setSubmitting(false);
          return;
        }
        payload.amount = amtNum;
      }

      await api.post(path, payload);
      toast.success(
        modal.action === "approve"
          ? "Reimbursement approved"
          : "Reimbursement rejected",
      );
      setModal(null);
      setAdminNote("");
      setAmountEdit("");
      loadItems();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error || `Failed to ${modal.action} request`,
      );
    } finally {
      setSubmitting(false);
    }
  }

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
            Configure reimbursement types and act on employee submissions.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <select
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
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
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            value={typeFilter}
            onChange={(e) => {
              setPage(1);
              setTypeFilter(e.target.value);
            }}
          >
            <option value="ALL">All types</option>
            {types.map((t) => (
              <option key={t._id} value={t._id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            value={projectFilter}
            onChange={(e) => {
              setPage(1);
              setProjectFilter(e.target.value);
            }}
            disabled={loadingProjects}
          >
            <option value="ALL">All projects</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.title}
              </option>
            ))}
            <option value={PROJECT_FILTER_CUSTOM}>Other / custom</option>
            <option value={PROJECT_FILTER_NONE}>No project</option>
          </select>
          <input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Search employee/type..."
            className="h-10 w-56 rounded-md border border-border bg-surface px-3 text-sm"
          />
          <Link
            to="/admin/reimbursements/types/new"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white"
          >
            Add type
          </Link>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="font-semibold">Requests</h3>
            <p className="text-xs text-muted-foreground">
              {loading
                ? "Loading…"
                : `Showing ${start}-${end} of ${total} requests`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs text-muted-foreground whitespace-nowrap">
              Total (filtered): Rs. {totalAmount.toFixed(2)}
            </div>
            <select
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              value={limit}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setLimit(Number.isNaN(v) ? 20 : v);
                setPage(1);
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

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border/70">
            <thead className="bg-bg">
              <tr>
                <Th>Submitted</Th>
                <Th>Employee</Th>
                <Th>Type</Th>
                <Th>Project</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th>Description</Th>
                <Th>Attachments</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading ? (
                <tr>
                  <Td
                    colSpan={9}
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
                    colSpan={9}
                    className="text-center text-sm text-muted-foreground"
                  >
                    No requests found.
                  </Td>
                </tr>
              ) : (
                pageRows.map((r) => (
                  <tr key={r._id} className="hover:bg-bg/60">
                    <Td>{formatDate(r.createdAt)}</Td>
                    <Td className="text-sm">
                      <div className="font-medium">{r.employee?.name}</div>
                      {r.employee?.employeeId && (
                        <div className="text-xs text-muted-foreground">
                          ID: {r.employee.employeeId}
                        </div>
                      )}
                    </Td>
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
                          Note: {r.employeeNote}
                        </div>
                      ) : null}
                      {r.adminNote ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          Admin note: {r.adminNote}
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
                    <Td>
                      {r.status === "PENDING" ? (
                        <div className="flex gap-2">
                          <button
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow-sm hover:bg-primary/90"
                            onClick={() => openAction(r._id, "approve")}
                            title="Approve"
                            aria-label="Approve reimbursement"
                          >
                            <CheckCircle2 size={18} />
                          </button>
                          <button
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-error text-white shadow-sm hover:bg-error/90"
                            onClick={() => openAction(r._id, "reject")}
                            title="Reject"
                            aria-label="Reject reimbursement"
                          >
                            <XCircle size={18} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {r.status === "APPROVED" ? "Approved" : "Rejected"}
                        </span>
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
                ? "Approve reimbursement"
                : "Reject reimbursement"}
            </h4>
            <p className="text-sm text-muted-foreground mb-3">
              Add an optional note to send back to the employee.
            </p>
            {modal.action === "approve" ? (
              <div className="space-y-1 mb-3">
                <label className="text-sm font-medium">Amount</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                  value={amountEdit}
                  onChange={(e) => {
                    const val = e.target.value;
                    setAmountEdit(val === "" ? "" : Number(val));
                  }}
                  disabled={submitting}
                />
                <p className="text-xs text-muted-foreground">
                  Update the reimbursable amount before approving. Leave as-is
                  to keep the original value.
                </p>
              </div>
            ) : null}
            <textarea
              className="w-full min-h-[120px] rounded-md border border-border bg-white px-3 py-2 text-sm"
              placeholder="Message to include with this decision"
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
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
                disabled={submitting}
              >
                {submitting
                  ? "Saving..."
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
