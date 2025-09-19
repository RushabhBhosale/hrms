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
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
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
          dueFrom: dueFrom || undefined,
          dueTo: dueTo || undefined,
          amountMin: amountMin || undefined,
          amountMax: amountMax || undefined,
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
    setPartyType((prev) => {
      if (type === "payable" && prev === "client") return "vendor";
      if (type === "receivable" && prev === "vendor") return "client";
      return prev;
    });
  }, [type]);

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
    return { subtotal, tax, total: subtotal + tax };
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

  const listTotal = useMemo(() => {
    const sum = (items || []).reduce(
      (s: number, it: any) => s + Number(it.totalAmount || 0),
      0
    );
    return fmtMoney(sum);
  }, [items]);

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="sticky top-0 z-10 bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60 border-b border-border -mx-4 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">Invoices</h2>
            <span className="text-xs rounded-full border px-2 py-0.5">
              {type === "receivable" ? "Outgoing" : "Incoming"}
            </span>
          </div>
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
            <button
              className="px-3 py-1.5 rounded-md border"
              onClick={() =>
                exportExcel({
                  type,
                  status,
                  q,
                  from,
                  to,
                  dueFrom,
                  dueTo,
                  amountMin,
                  amountMax,
                })
              }
            >
              Export Excel
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-10 gap-3 items-end">
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
        <input
          type="date"
          value={dueFrom}
          onChange={(e) => setDueFrom(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2"
        />
        <input
          type="date"
          value={dueTo}
          onChange={(e) => setDueTo(e.target.value)}
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

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div className="relative">
          <input
            type="number"
            value={amountMin}
            onChange={(e) => setAmountMin(e.target.value)}
            className="w-full rounded-md border border-border bg-surface pl-7 pr-3 py-2"
            placeholder="Min Amount"
          />
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs">
            ₹
          </span>
        </div>
        <div className="relative">
          <input
            type="number"
            value={amountMax}
            onChange={(e) => setAmountMax(e.target.value)}
            className="w-full rounded-md border border-border bg-surface pl-7 pr-3 py-2"
            placeholder="Max Amount"
          />
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs">
            ₹
          </span>
        </div>

        <div>
          <button
            className="px-3 py-1.5 rounded-md border"
            onClick={() =>
              exportPdf({
                type,
                status,
                q,
                from,
                to,
                dueFrom,
                dueTo,
                amountMin,
                amountMax,
              })
            }
          >
            Export PDF
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="border border-border rounded-xl p-5 space-y-4 bg-surface/50">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-muted mb-1">Party Type</div>
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
              <div className="text-xs text-muted mb-1">Project (Client)</div>
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
              <div className="text-xs text-muted mb-1">Party Name</div>
              <input
                placeholder="Company or person e.g. Acme Ltd."
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </div>
            <div>
              <div className="text-xs text-muted mb-1">Party Email</div>
              <input
                type="email"
                placeholder="billing@acme.com"
                value={partyEmail}
                onChange={(e) => setPartyEmail(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </div>
            <div>
              <div className="text-xs text-muted mb-1">Issue Date</div>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </div>
            <div>
              <div className="text-xs text-muted mb-1">Due Date</div>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </div>
            <div>
              <div className="text-xs text-muted mb-1">Payment Terms</div>
              <input
                placeholder="Net 15 / Net 30 / On receipt"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold">Line Items</div>
            <div className="hidden md:grid md:grid-cols-6 gap-2 text-xs text-muted px-1 mt-2">
              <div className="md:col-span-2">Description</div>
              <div>Qty (hrs)</div>
              <div>Rate (₹/hr)</div>
              <div>Tax (%)</div>
              <div className="text-right">Amount</div>
            </div>
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
                    <div className="relative">
                      <input
                        type="number"
                        placeholder="0.00"
                        value={li.quantity}
                        onChange={(e) =>
                          setLine(idx, { quantity: Number(e.target.value) })
                        }
                        className="w-full rounded-md border border-border bg-surface pl-3 pr-14 py-2"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">
                        hrs
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        placeholder="0.00"
                        value={li.rate}
                        onChange={(e) =>
                          setLine(idx, { rate: Number(e.target.value) })
                        }
                        className="w-full rounded-md border border-border bg-surface pl-3 pr-16 py-2"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">
                        ₹/hr
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        placeholder="0"
                        value={li.taxPercent}
                        onChange={(e) =>
                          setLine(idx, { taxPercent: Number(e.target.value) })
                        }
                        className="w-full rounded-md border border-border bg-surface pl-3 pr-8 py-2"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">
                        %
                      </span>
                    </div>
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
                    <div className="text-xs text-muted">Show</div>
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
                    <div className="text-xs text-muted ml-4">Default Rate</div>
                    <input
                      type="number"
                      value={defaultRate}
                      onChange={(e) => setDefaultRate(Number(e.target.value))}
                      className="w-24 rounded-md border border-border bg-surface px-2 py-1"
                    />
                    <div className="text-xs text-muted">Tax %</div>
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
              <div className="text-xs text-muted">Notes</div>
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
        <div className="overflow-hidden border border-border rounded-xl">
          <div className="animate-pulse divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 bg-surface" />
            ))}
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-8 text-center text-sm text-muted">
          No invoices found. Try changing filters or create a new invoice.
        </div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-xl">
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
              {items.map((it, i) => {
                const d = it.issueDate ? new Date(it.issueDate) : null;
                const row = i % 2 ? "bg-bg" : "bg-surface/30";
                return (
                  <tr
                    key={it._id}
                    className={`border-t border-border hover:bg-surface/60 ${row}`}
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
            <tfoot>
              <tr className="border-t border-border bg-surface/50">
                <td colSpan={4} className="p-2 text-right font-semibold">
                  Total (listed)
                </td>
                <td className="p-2 text-right font-semibold">{listTotal}</td>
                <td />
              </tr>
            </tfoot>
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

async function exportExcel(opts: {
  type: "receivable" | "payable";
  status?: string;
  q?: string;
  from?: string;
  to?: string;
  dueFrom?: string;
  dueTo?: string;
  amountMin?: string;
  amountMax?: string;
}) {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.from) params.set("from", opts.from);
  if (opts?.to) params.set("to", opts.to);
  if (opts?.dueFrom) params.set("dueFrom", opts.dueFrom);
  if (opts?.dueTo) params.set("dueTo", opts.dueTo);
  if (opts?.amountMin) params.set("amountMin", opts.amountMin);
  if (opts?.amountMax) params.set("amountMax", opts.amountMax);
  const res = await api.get("/invoices/reports/export?" + params.toString(), {
    responseType: "blob",
  });
  const blob = new Blob([res.data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const fname =
    "invoices" +
    (opts.type ? "-" + opts.type : "") +
    (opts.from || opts.to
      ? "-" + (opts.from || "") + "_" + (opts.to || "")
      : "") +
    ".xlsx";
  await downloadFileBlob(blob, fname);
}

async function exportPdf(opts: {
  type: "receivable" | "payable";
  status?: string;
  q?: string;
  from?: string;
  to?: string;
  dueFrom?: string;
  dueTo?: string;
  amountMin?: string;
  amountMax?: string;
}) {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.from) params.set("from", opts.from);
  if (opts?.to) params.set("to", opts.to);
  if (opts?.dueFrom) params.set("dueFrom", opts.dueFrom);
  if (opts?.dueTo) params.set("dueTo", opts.dueTo);
  if (opts?.amountMin) params.set("amountMin", opts.amountMin);
  if (opts?.amountMax) params.set("amountMax", opts.amountMax);
  const res = await api.get(
    "/invoices/reports/export-pdf?" + params.toString(),
    { responseType: "blob" }
  );
  const blob = new Blob([res.data], { type: "application/pdf" });
  const fname =
    "invoices" +
    (opts.type ? "-" + opts.type : "") +
    (opts.from || opts.to
      ? "-" + (opts.from || "") + "_" + (opts.to || "")
      : "") +
    ".pdf";
  await downloadFileBlob(blob, fname);
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
