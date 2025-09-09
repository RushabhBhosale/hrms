import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

type Invoice = any;

type LineItem = {
  description: string;
  quantity: number;
  rate: number;
  taxPercent: number;
};

type ProjectLite = { _id: string; title: string };

const fmtMoney = (n: number, currency = "INR", locale = "en-IN") =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);

const statusClass = (s?: string) => {
  const base =
    "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";
  if (s === "paid")
    return `${base} bg-emerald-600/10 text-emerald-700 border border-emerald-200`;
  if (s === "overdue")
    return `${base} bg-red-600/10 text-red-700 border border-red-200`;
  if (s === "pending")
    return `${base} bg-amber-500/10 text-amber-700 border border-amber-200`;
  if (s === "sent")
    return `${base} bg-blue-500/10 text-blue-700 border border-blue-200`;
  return `${base} bg-muted text-foreground/70 border border-border`;
};

export default function Invoices() {
  const [type, setType] = useState<"receivable" | "payable">("receivable");
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortBy, setSortBy] = useState("issueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [items, setItems] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [partyType, setPartyType] = useState<"client" | "employee" | "vendor">(
    "client"
  );
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [partyName, setPartyName] = useState("");
  const [partyEmail, setPartyEmail] = useState("");
  const [issueDate, setIssueDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [dueDate, setDueDate] = useState<string>("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, rate: 0, taxPercent: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get("/invoices", {
        params: {
          type,
          status: status || undefined,
          q: q || undefined,
          from: from || undefined,
          to: to || undefined,
          sortBy,
          sortDir,
        },
      });
      setItems(res.data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [type, status, sortBy, sortDir]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/projects", { params: { active: "true" } });
        setProjects(
          (res.data.projects || []).map((p: any) => ({
            _id: p._id,
            title: p.title,
          }))
        );
      } catch {}
    })();
  }, []);

  async function createInvoice() {
    try {
      setSaving(true);
      setErr(null);
      const payload: any = {
        type,
        partyType,
        projectId: projectId || undefined,
        partyName: partyName || undefined,
        partyEmail: partyEmail || undefined,
        issueDate,
        dueDate: dueDate || undefined,
        paymentTerms: paymentTerms || undefined,
        lineItems,
        notes: notes || undefined,
        status: "draft",
      };
      await api.post("/invoices", payload);
      setShowCreate(false);
      setPartyType("client");
      setPartyName("");
      setPartyEmail("");
      setIssueDate(new Date().toISOString().slice(0, 10));
      setDueDate("");
      setPaymentTerms("");
      setNotes("");
      setLineItems([{ description: "", quantity: 1, rate: 0, taxPercent: 0 }]);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  const totals = useMemo(() => {
    const subtotal = lineItems.reduce(
      (s, li) => s + Number(li.quantity || 0) * Number(li.rate || 0),
      0
    );
    const tax = lineItems.reduce(
      (s, li) =>
        s +
        Number(li.quantity || 0) *
          Number(li.rate || 0) *
          (Math.min(Math.max(Number(li.taxPercent || 0), 0), 100) / 100),
      0
    );
    const total = subtotal + tax;
    return { subtotal, tax, total };
  }, [lineItems]);

  function setLine(idx: number, patch: Partial<LineItem>) {
    setLineItems((prev) =>
      prev.map((li, i) => (i === idx ? { ...li, ...patch } : li))
    );
  }

  function addLine() {
    setLineItems((prev) => [
      ...prev,
      { description: "", quantity: 1, rate: 0, taxPercent: 0 },
    ]);
  }
  function rmLine(idx: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [taskStatusFilter, setTaskStatusFilter] = useState<
    "ALL" | "DONE" | "INPROGRESS" | "PENDING"
  >("DONE");
  const [defaultRate, setDefaultRate] = useState<number>(0);
  const [defaultTaxPercent, setDefaultTaxPercent] = useState<number>(0);

  async function loadTasksForProject(id: string) {
    try {
      setTaskLoading(true);
      const res = await api.get(`/projects/${id}/tasks`, {
        params: { limit: 1000 },
      });
      setTasks(res.data.tasks || []);
    } finally {
      setTaskLoading(false);
    }
  }

  function toggleTask(id: string) {
    setSelectedTaskIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function importSelectedTasks() {
    const toImport = tasks.filter((t: any) =>
      selectedTaskIds.includes(String(t._id))
    );
    const mapped = toImport.map((t: any) => {
      const minutes = Number(t.timeSpentMinutes || 0);
      const qty = Math.round((minutes / 60) * 100) / 100;
      return {
        description: `Task: ${t.title}`,
        quantity: qty || 1,
        rate: defaultRate || 0,
        taxPercent: defaultTaxPercent || 0,
      } as LineItem;
    });
    setLineItems((prev) => [...prev, ...mapped]);
    setShowTaskPicker(false);
    setSelectedTaskIds([]);
  }

  const canSave = useMemo(() => {
    if (!issueDate) return false;
    if (!partyName && !projectId) return false;
    if (!lineItems.length) return false;
    if (!lineItems.some((l) => l.description.trim().length > 0)) return false;
    return true;
  }, [issueDate, partyName, projectId, lineItems]);

  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const t = setTimeout(() => load(), 400);
    return () => clearTimeout(t);
  }, [q, from, to]);

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">Invoices</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-md border border-border overflow-hidden">
            <button
              className={`px-3 py-1.5 ${
                type === "receivable" ? "bg-primary text-white" : "bg-surface"
              }`}
              onClick={() => setType("receivable")}
            >
              Outgoing
            </button>
            <button
              className={`px-3 py-1.5 ${
                type === "payable" ? "bg-primary text-white" : "bg-surface"
              }`}
              onClick={() => setType("payable")}
            >
              Incoming
            </button>
          </div>
          <button
            className="px-3 py-1.5 rounded-md border"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? "Close" : "New Invoice"}
          </button>
          <a
            className="px-3 py-1.5 rounded-md border"
            href={`${
              import.meta.env.VITE_API_URL || "http://localhost:4000"
            }/invoices/reports/export?type=${type}${
              from ? `&from=${from}` : ""
            }${to ? `&to=${to}` : ""}`}
            target="_blank"
            rel="noreferrer"
          >
            Export Excel
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-7 gap-3 items-end">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2"
        >
          <option value="">All Status</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
        <input
          placeholder="Search by #, party, notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 md:col-span-2"
        />
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2"
        />
        <div className="flex gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2"
          >
            <option value="issueDate">Date</option>
            <option value="totalAmount">Amount</option>
            <option value="status">Status</option>
          </select>
          <select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as any)}
            className="rounded-md border border-border bg-surface px-3 py-2"
          >
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
          <button
            className="px-3 py-2 rounded-md border bg-primary text-white"
            onClick={load}
          >
            Apply
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="border border-border rounded-md p-4 space-y-4 bg-surface/50">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted">Party Type</label>
              <select
                value={partyType}
                onChange={(e) => setPartyType(e.target.value as any)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              >
                <option value="client">Client</option>
                <option value="employee">Employee</option>
                <option value="vendor">Vendor</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted">Project (Client)</label>
              <select
                value={projectId}
                onChange={async (e) => {
                  const v = e.target.value;
                  setProjectId(v);
                  if (v) {
                    const proj = projects.find((p) => p._id === v);
                    if (proj && !partyName) setPartyName(proj.title);
                    await loadTasksForProject(v);
                  } else {
                    setTasks([]);
                  }
                }}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              >
                <option value="">— Select Project —</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted">Party Name</label>
              <input
                placeholder="Company or person e.g. Acme Ltd."
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-muted">Party Email</label>
              <input
                type="email"
                placeholder="billing@acme.com"
                value={partyEmail}
                onChange={(e) => setPartyEmail(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-muted">Issue Date</label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-muted">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-muted">Payment Terms</label>
              <input
                placeholder="Net 15 / Net 30 / On receipt"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold">Line Items</label>
            <div className="space-y-2 mt-2">
              {lineItems.map((li, idx) => {
                const amount =
                  Number(li.quantity || 0) *
                  Number(li.rate || 0) *
                  (1 +
                    Math.min(Math.max(Number(li.taxPercent || 0), 0), 100) /
                      100);
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-1 md:grid-cols-6 gap-2 items-center"
                  >
                    <input
                      placeholder="Describe work or item e.g. Landing page design (8h)"
                      value={li.description}
                      onChange={(e) =>
                        setLine(idx, { description: e.target.value })
                      }
                      className="rounded-md border border-border bg-surface px-3 py-2 md:col-span-2"
                    />
                    <input
                      type="number"
                      placeholder="Hours e.g. 2.5"
                      value={li.quantity}
                      onChange={(e) =>
                        setLine(idx, { quantity: Number(e.target.value) })
                      }
                      className="rounded-md border border-border bg-surface px-3 py-2"
                    />
                    <input
                      type="number"
                      placeholder="Rate e.g. 1500"
                      value={li.rate}
                      onChange={(e) =>
                        setLine(idx, { rate: Number(e.target.value) })
                      }
                      className="rounded-md border border-border bg-surface px-3 py-2"
                    />
                    <input
                      type="number"
                      placeholder="Tax % e.g. 18"
                      value={li.taxPercent}
                      onChange={(e) =>
                        setLine(idx, { taxPercent: Number(e.target.value) })
                      }
                      className="rounded-md border border-border bg-surface px-3 py-2"
                    />
                    <div className="text-right font-medium">
                      {fmtMoney(amount)}
                    </div>
                    <button
                      onClick={() => rmLine(idx)}
                      className="px-3 py-2 rounded-md border md:col-span-1"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={addLine}
                  className="px-3 py-2 rounded-md border"
                >
                  Add line
                </button>
                <button
                  disabled={!projectId}
                  onClick={() => {
                    if (projectId) {
                      setShowTaskPicker((v) => !v);
                      if (!tasks.length) loadTasksForProject(projectId);
                    }
                  }}
                  className="px-3 py-2 rounded-md border disabled:opacity-50"
                >
                  {showTaskPicker ? "Hide tasks" : "Add tasks from project"}
                </button>
              </div>

              {showTaskPicker && (
                <div className="mt-3 border border-border rounded-md p-2 bg-bg">
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-muted">Show</label>
                    <select
                      value={taskStatusFilter}
                      onChange={(e) =>
                        setTaskStatusFilter(e.target.value as any)
                      }
                      className="rounded-md border border-border bg-surface px-2 py-1"
                    >
                      <option value="ALL">All</option>
                      <option value="DONE">Done</option>
                      <option value="INPROGRESS">In Progress</option>
                      <option value="PENDING">Pending</option>
                    </select>
                    <label className="text-xs text-muted ml-4">
                      Default Rate
                    </label>
                    <input
                      type="number"
                      value={defaultRate}
                      onChange={(e) => setDefaultRate(Number(e.target.value))}
                      className="w-24 rounded-md border border-border bg-surface px-2 py-1"
                    />
                    <label className="text-xs text-muted">Tax %</label>
                    <input
                      type="number"
                      value={defaultTaxPercent}
                      onChange={(e) =>
                        setDefaultTaxPercent(Number(e.target.value))
                      }
                      className="w-20 rounded-md border border-border bg-surface px-2 py-1"
                    />
                    <button
                      onClick={importSelectedTasks}
                      className="ml-auto px-3 py-2 rounded-md border"
                    >
                      Add selected
                    </button>
                  </div>
                  <div className="overflow-x-auto mt-2">
                    {taskLoading ? (
                      <div className="p-2">Loading tasks…</div>
                    ) : (
                      <table className="min-w-full text-sm">
                        <thead className="bg-surface">
                          <tr>
                            <th className="p-2 text-left">Select</th>
                            <th className="p-2 text-left">Task</th>
                            <th className="p-2 text-right">Minutes</th>
                            <th className="p-2 text-right">Hours</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tasks
                            .filter(
                              (t: any) =>
                                taskStatusFilter === "ALL" ||
                                t.status === taskStatusFilter
                            )
                            .map((t: any) => {
                              const minutes = Number(t.timeSpentMinutes || 0);
                              const hours =
                                Math.round((minutes / 60) * 100) / 100;
                              return (
                                <tr
                                  key={t._id}
                                  className="border-t border-border"
                                >
                                  <td className="p-2">
                                    <input
                                      type="checkbox"
                                      checked={selectedTaskIds.includes(
                                        String(t._id)
                                      )}
                                      onChange={() => toggleTask(String(t._id))}
                                    />
                                  </td>
                                  <td className="p-2 break-words">{t.title}</td>
                                  <td className="p-2 text-right">{minutes}</td>
                                  <td className="p-2 text-right">{hours}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs text-muted">Notes</label>
              <textarea
                placeholder="Thank you for your business. UPI/Bank details, late fee policy, or PO reference can go here."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 h-24"
              />
            </div>
            <div className="border rounded-md p-3 bg-bg space-y-1">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{fmtMoney(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span>{fmtMoney(totals.tax)}</span>
              </div>
              <div className="flex justify-between font-semibold text-base">
                <span>Total</span>
                <span>{fmtMoney(totals.total)}</span>
              </div>
            </div>
          </div>

          {err && <div className="text-error text-sm">{err}</div>}
          <div className="flex gap-2">
            <button
              disabled={saving || !canSave}
              onClick={createInvoice}
              className="rounded-md bg-primary text-white px-4 py-2 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Draft"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="overflow-hidden border border-border rounded-md">
          <div className="animate-pulse divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 bg-surface" />
            ))}
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-border rounded-md p-8 text-center text-sm text-muted">
          No invoices found. Try changing filters or create a new invoice.
        </div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-md">
          <table className="min-w-full text-sm">
            <thead className="bg-surface">
              <tr>
                <th className="text-left p-2">Invoice #</th>
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Party</th>
                <th className="text-left p-2">Status</th>
                <th className="text-right p-2">Amount</th>
                <th className="text-right p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const d = it.issueDate ? new Date(it.issueDate) : null;
                return (
                  <tr
                    key={it._id}
                    className="border-t border-border hover:bg-surface/50"
                  >
                    <td className="p-2 font-mono break-words">
                      {it.invoiceNumber}
                    </td>
                    <td className="p-2">
                      {d
                        ? d.toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : ""}
                    </td>
                    <td className="p-2 break-words max-w-[240px]">
                      {it.partyName || "-"}
                    </td>
                    <td className="p-2">
                      <span className={statusClass(it.status)}>
                        {String(it.status || "draft").toUpperCase()}
                      </span>
                    </td>
                    <td className="p-2 text-right">
                      {it?.totalAmount?.toFixed
                        ? fmtMoney(it.totalAmount)
                        : fmtMoney(Number(it.totalAmount || 0))}
                    </td>
                    <td className="p-2 text-right space-x-3">
                      <Link
                        className="underline"
                        to={`/admin/invoices/${it._id}`}
                      >
                        Open
                      </Link>
                      <button
                        className="underline"
                        onClick={() => downloadPdf(it._id, it.invoiceNumber)}
                      >
                        PDF
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function downloadPdf(id: string, invoiceNumber?: string) {
  const name = invoiceNumber ? `Invoice-${invoiceNumber}.pdf` : "Invoice.pdf";
  const res = await api.get(`/invoices/${id}/pdf`, { responseType: "blob" });
  const blob = new Blob([res.data], { type: "application/pdf" });
  await downloadFileBlob(blob, name);
}

async function downloadFileBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 0);
}
