import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Leave = {
  _id: string;
  employee: { _id: string; name: string };
  startDate: string;
  endDate: string;
  type: "CASUAL" | "PAID" | "UNPAID" | "SICK";
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminMessage?: string;
};

export default function LeaveApprovals() {
  const [rows, setRows] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | Leave["type"]>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | Leave["status"]>("ALL");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortKey, setSortKey] = useState<'employee'|'start'|'end'|'type'|'status'>('start');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [modal, setModal] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
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

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(r =>
      (statusFilter==='ALL' || r.status===statusFilter)
      && (typeFilter==='ALL' || r.type===typeFilter)
      && (!term || r.employee.name.toLowerCase().includes(term))
    );
  }, [rows, q, statusFilter, typeFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir==='asc'?1:-1;
    arr.sort((a,b)=>{
      switch (sortKey) {
        case 'employee': return dir * a.employee.name.localeCompare(b.employee.name);
        case 'end': return dir * (new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
        case 'type': return dir * a.type.localeCompare(b.type);
        case 'status': return dir * a.status.localeCompare(b.status);
        case 'start':
        default: return dir * (new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(total, page * limit);
  const pageRows = useMemo(() => sorted.slice((page-1)*limit, (page-1)*limit + limit), [sorted, page, limit]);

  function toggleSort(k: typeof sortKey) {
    if (sortKey === k) setSortDir(d => d==='asc'?'desc':'asc'); else { setSortKey(k); setSortDir(k==='start'?'desc':'asc'); }
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
        <p className="text-sm text-muted">Review leave requests from your team.</p>
      </div>
      <div className="flex gap-2 flex-wrap md:items-end">
        <select className="h-10 rounded-md border border-border bg-surface px-3" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as any)}>
          <option value="ALL">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <select className="h-10 rounded-md border border-border bg-surface px-3" value={typeFilter} onChange={e=>setTypeFilter(e.target.value as any)}>
          <option value="ALL">All Types</option>
          <option value="CASUAL">Casual</option>
          <option value="PAID">Paid</option>
          <option value="UNPAID">Unpaid</option>
          <option value="SICK">Sick</option>
        </select>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by name" className="h-10 w-64 rounded-md border border-border bg-surface px-3" />
        <button onClick={load} className="h-10 rounded-md bg-primary px-4 text-white">Refresh</button>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">{err}</div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="text-sm text-muted">{loading ? 'Loading…' : `Showing ${start}-${end} of ${total} requests`}</div>
          <div className="flex items-center gap-2">
            <select className="h-9 rounded-md border border-border bg-surface px-2 text-sm" value={limit} onChange={e=>{ setPage(1); setLimit(parseInt(e.target.value,10)); }}>
              {[10,20,50,100].map(n=> <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-bg">
              <tr className="text-left">
                <SortableTh label="Employee" dir={sortKey==='employee'?sortDir:null} onClick={()=>toggleSort('employee')} />
                <SortableTh label="Start" dir={sortKey==='start'?sortDir:null} onClick={()=>toggleSort('start')} />
                <SortableTh label="End" dir={sortKey==='end'?sortDir:null} onClick={()=>toggleSort('end')} />
                <SortableTh label="Type" dir={sortKey==='type'?sortDir:null} onClick={()=>toggleSort('type')} />
                <SortableTh label="Status" dir={sortKey==='status'?sortDir:null} onClick={()=>toggleSort('status')} />
                <Th>Actions</Th>
              </tr>
          </thead>
          <tbody>
              {loading ? (
                <SkeletonRows rows={6} cols={6} />
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted">
                    No leave requests.
                  </td>
                </tr>
              ) : (
                pageRows.map((l) => (
                <tr key={l._id} className="border-t border-border/70">
                  <Td>{l.employee?.name || "-"}</Td>
                  <Td>{new Date(l.startDate).toLocaleDateString()}</Td>
                  <Td>{new Date(l.endDate).toLocaleDateString()}</Td>
                  <Td>{l.type}</Td>
                  <Td>
                    <StatusBadge status={l.status} />
                  </Td>
                  <Td>
                    {l.status === "PENDING" ? (
                      <div className="flex gap-2">
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
                      <span>{l.adminMessage || "-"}</span>
                    )}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <div className="flex items-center gap-2 justify-end">
        <button className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50" onClick={()=>setPage(1)} disabled={page===1}>First</button>
        <button className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>Prev</button>
        <div className="text-sm text-muted">Page {page} of {pages}</div>
        <button className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50" onClick={()=>setPage(p=>Math.min(pages,p+1))} disabled={page>=pages}>Next</button>
        <button className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50" onClick={()=>setPage(pages)} disabled={page>=pages}>Last</button>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal(null)} />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h4 className="text-lg font-semibold mb-2">
              {modal.action === "approve" ? "Approve Leave" : "Reject Leave"}
            </h4>
            <p className="text-sm text-muted mb-3">Add a short message (optional).</p>
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
                {submitting ? "Saving…" : modal.action === "approve" ? "Approve" : "Reject"}
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

function SortableTh({ label, dir, onClick }: { label: string; dir: 'asc'|'desc'|null; onClick: ()=>void }) {
  return (
    <th onClick={onClick} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted cursor-pointer hover:text-text select-none">
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="text-[10px]">{dir==='asc'?'▲':dir==='desc'?'▼':'↕'}</span>
      </span>
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-middle">{children}</td>;
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

function StatusBadge({ status }: { status: Leave["status"] }) {
  const map: Record<Leave["status"], string> = {
    PENDING: "bg-accent/10 text-accent",
    APPROVED: "bg-secondary/10 text-secondary",
    REJECTED: "bg-error/10 text-error",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${map[status]}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
