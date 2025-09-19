import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";

type LineItem = {
  description: string;
  quantity: number;
  rate: number;
  amountMode: "time" | "flat";
  flatAmount: number;
};

type ProjectLite = { _id: string; title: string };

const fmtMoney = (n: number, currency = "INR", locale = "en-IN") =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);

export default function InvoiceCreate() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const initialType =
    (searchParams.get("type") as "receivable" | "payable" | null) ||
    "receivable";

  const [type, setType] = useState<"receivable" | "payable">(initialType);
  const [partyType, setPartyType] = useState<"client" | "employee" | "vendor">(
    initialType === "payable" ? "vendor" : "client"
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
    { description: "", quantity: 1, rate: 0, amountMode: "time", flatAmount: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [invoiceAmount, setInvoiceAmount] = useState<string>("");
  const [attachments, setAttachments] = useState<File[]>([]);

  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [taskStatusFilter, setTaskStatusFilter] = useState<
    "ALL" | "DONE" | "INPROGRESS" | "PENDING"
  >("DONE");
  const [defaultRate, setDefaultRate] = useState<number>(0);
  const [taxPercent, setTaxPercent] = useState<number>(0);
  const [taskAmounts, setTaskAmounts] = useState<Record<string, string>>({});

  const isPayable = type === "payable";
  const isReceivable = type === "receivable";

  useEffect(() => {
    setPartyType((prev) => {
      if (type === "payable") return "vendor";
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
      } catch (error) {
        console.error("projects load failed", error);
      }
    })();
  }, []);

  async function loadTasksForProject(id: string) {
    try {
      setTaskLoading(true);
      const res = await api.get(`/projects/${id}/tasks`, {
        params: { limit: 1000 },
      });
      setTasks(res.data.tasks || []);
    } catch (error) {
      console.error("project tasks load failed", error);
    } finally {
      setTaskLoading(false);
    }
  }

  function setLine(idx: number, patch: Partial<LineItem>) {
    setLineItems((prev) =>
      prev.map((li, i) => (i === idx ? { ...li, ...patch } : li))
    );
  }

  function addLine() {
    setLineItems((prev) => [
      ...prev,
      { description: "", quantity: 1, rate: 0, amountMode: "time", flatAmount: 0 },
    ]);
  }

  function rmLine(idx: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function changeAmountMode(idx: number, mode: "time" | "flat") {
    setLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== idx) return li;
        if (mode === "flat") {
          const computed = Number(li.quantity || 0) * Number(li.rate || 0);
          return {
            ...li,
            amountMode: "flat",
            flatAmount:
              li.flatAmount || (Number.isFinite(computed) ? computed : 0),
          };
        }
        return { ...li, amountMode: "time" };
      })
    );
  }

  function toggleTask(id: string) {
    setSelectedTaskIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function addTaskLineFromTask(task: any, amountOverride?: number) {
    const minutes = Number(task.timeSpentMinutes || 0);
    const qty = Math.round((minutes / 60) * 100) / 100;
    const finalAmount =
      amountOverride !== undefined && Number.isFinite(amountOverride)
        ? Number(amountOverride)
        : undefined;
    const hasAmount = finalAmount !== undefined;
    const line: LineItem = {
      description: `Task: ${task.title}`,
      quantity: qty || 1,
      rate: defaultRate || 0,
      amountMode: hasAmount ? "flat" : "time",
      flatAmount: hasAmount ? finalAmount || 0 : 0,
    };
    setLineItems((prev) => [...prev, line]);
  }

  function importSelectedTasks() {
    const toImport = tasks.filter((t: any) =>
      selectedTaskIds.includes(String(t._id))
    );
    const mapped = toImport.map((t: any) => {
      const minutes = Number(t.timeSpentMinutes || 0);
      const qty = Math.round((minutes / 60) * 100) / 100;
      const taskId = String(t._id);
      const overrideRaw = taskAmounts[taskId];
      const overrideAmount = overrideRaw ? Number(overrideRaw) : undefined;
      const hasOverride =
        overrideAmount !== undefined && !Number.isNaN(overrideAmount);
      return {
        description: `Task: ${t.title}`,
        quantity: qty || 1,
        rate: defaultRate || 0,
        amountMode: hasOverride ? "flat" : "time",
        flatAmount: hasOverride ? overrideAmount || 0 : 0,
      } as LineItem;
    });
    setLineItems((prev) => [...prev, ...mapped]);
    setShowTaskPicker(false);
    setSelectedTaskIds([]);
    setTaskAmounts((prev) => {
      const next = { ...prev };
      toImport.forEach((t: any) => delete next[String(t._id)]);
      return next;
    });
  }

  const totals = useMemo(() => {
    const subtotal = lineItems.reduce((sum, li) => {
      const lineAmount =
        li.amountMode === "flat"
          ? Number(li.flatAmount || 0)
          : Number(li.quantity || 0) * Number(li.rate || 0);
      return sum + (Number.isFinite(lineAmount) ? lineAmount : 0);
    }, 0);
    const normalizedTaxPercent = Math.min(
      Math.max(Number(taxPercent || 0), 0),
      100
    );
    const tax = subtotal * (normalizedTaxPercent / 100);
    return {
      subtotal,
      tax,
      total: subtotal + tax,
      taxPercent: normalizedTaxPercent,
    };
  }, [lineItems, taxPercent]);

  const canSave = useMemo(() => {
    if (!issueDate) return false;
    if (!partyName && !projectId) return false;
    if (isPayable) {
      if (!invoiceAmount || Number(invoiceAmount) <= 0) return false;
      return true;
    }
    if (!lineItems.length) return false;
    if (!lineItems.some((l) => l.description.trim().length > 0)) return false;
    return true;
  }, [issueDate, partyName, projectId, lineItems, isPayable, invoiceAmount]);

  function appendBullet(idx: number) {
    if (!isReceivable) return;
    setLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== idx) return li;
        const current = li.description || "";
        const needsNewline = current.length > 0 && !current.endsWith("\n");
        const nextValue = `${current}${needsNewline ? "\n" : ""}• `;
        return { ...li, description: nextValue };
      })
    );
  }

  function appendNumbered(idx: number) {
    if (!isReceivable) return;
    setLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== idx) return li;
        const current = li.description || "";
        const lines = current
          .split(/\n/)
          .map((line) => line.trim())
          .filter((line) => /^\d+\./.test(line));
        const lastNumber = lines.length
          ? parseInt(lines[lines.length - 1].split(".")[0], 10)
          : 0;
        const nextNumber = Number.isFinite(lastNumber) ? lastNumber + 1 : 1;
        const needsNewline = current.length > 0 && !current.endsWith("\n");
        const nextValue = `${current}${
          needsNewline ? "\n" : ""
        }${nextNumber}. `;
        return { ...li, description: nextValue };
      })
    );
  }

  async function createInvoice() {
    try {
      setSaving(true);
      setErr(null);
      const normalizedTaxPercent = totals.taxPercent ?? 0;
      const payload: any = {
        type,
        partyType,
        projectId: projectId || undefined,
        partyName: partyName || undefined,
        partyEmail: partyEmail || undefined,
        issueDate,
        dueDate: dueDate || undefined,
        paymentTerms: paymentTerms || undefined,
        lineItems: isPayable
          ? [
              {
                description: "Invoice Amount",
                quantity: 1,
                rate: Number(invoiceAmount || 0),
                taxPercent: 0,
              },
            ]
          : lineItems.map((li) => {
              const useFlat = li.amountMode === "flat";
              const quantity = useFlat ? 1 : Number(li.quantity || 0);
              const rate = useFlat
                ? Number(li.flatAmount || 0)
                : Number(li.rate || 0);
              return {
                description: li.description,
                quantity: Number.isFinite(quantity) ? quantity : 0,
                rate: Number.isFinite(rate) ? rate : 0,
                taxPercent: normalizedTaxPercent,
              };
            }),
        notes: notes || undefined,
        status: "draft",
      };
      const res = await api.post("/invoices", payload);
      const invId = res?.data?.invoice?._id;
      if (isPayable && invId && attachments.length) {
        const fd = new FormData();
        attachments.forEach((file) => fd.append("files", file));
        try {
          await api.post(`/invoices/${invId}/attachments`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        } catch (uploadErr) {
          console.error("attachment upload failed", uploadErr);
        }
      }
      if (invId) {
        nav(`/admin/invoices/${invId}`);
      } else {
        nav("/admin/invoices");
      }
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to create invoice");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              New Invoice
            </h1>
            <span className="text-xs rounded-full border px-2 py-0.5">
              {type === "receivable" ? "Outgoing" : "Incoming"}
            </span>
          </div>
          <p className="text-sm text-muted">
            Create an invoice with detailed line items and rich descriptions.
          </p>
        </div>
        <Link className="text-sm underline" to="/admin/invoices">
          Back to invoices
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className={`px-3 py-1.5 rounded-md border ${
            type === "receivable" ? "bg-primary text-white" : ""
          }`}
          onClick={() => setType("receivable")}
        >
          Outgoing
        </button>
        <button
          className={`px-3 py-1.5 rounded-md border ${
            type === "payable" ? "bg-primary text-white" : ""
          }`}
          onClick={() => setType("payable")}
        >
          Incoming
        </button>
      </div>

      <div className="border border-border rounded-xl p-5 space-y-4 bg-surface/50">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {!isPayable && (
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
          )}
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
        {isReceivable && (
          <div>
            <div className="text-sm font-semibold">Line Items</div>
            <div className="space-y-3 mt-2">
              {lineItems.length === 0 && (
                <div className="border border-dashed border-border rounded-md p-4 text-sm text-muted">
                  No line items yet. Add one to get started.
                </div>
              )}
              {lineItems.map((li, idx) => {
                const isTime = li.amountMode === "time";
                const amount = isTime
                  ? Number(li.quantity || 0) * Number(li.rate || 0)
                  : Number(li.flatAmount || 0);
                const safeAmount = Number.isFinite(amount) ? amount : 0;
                return (
                  <div
                    key={idx}
                    className="rounded-lg border border-border bg-surface px-3 py-3 space-y-3"
                  >
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Line {idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => rmLine(idx)}
                        className="px-2 py-1 border rounded"
                      >
                        Remove
                      </button>
                    </div>
                    <textarea
                      placeholder="Describe work or item e.g. Landing page design (8h)"
                      value={li.description}
                      onChange={(e) => setLine(idx, { description: e.target.value })}
                      className="w-full rounded-md border border-border bg-surface px-3 py-2"
                      rows={3}
                    />
                    <div className="flex gap-2 text-xs text-muted flex-wrap">
                      <button
                        type="button"
                        className="px-2 py-1 border rounded"
                        onClick={() => appendBullet(idx)}
                      >
                        • Bullet
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 border rounded"
                        onClick={() => appendNumbered(idx)}
                      >
                        1. Numbered
                      </button>
                      <span className="inline-flex items-center">
                        Lists supported via Enter
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-xs text-muted">Amount type</span>
                      <button
                        type="button"
                        onClick={() => changeAmountMode(idx, "time")}
                        className={`px-2 py-1 border rounded ${
                          isTime ? "bg-primary text-white border-primary" : ""
                        }`}
                      >
                        Hours × Rate
                      </button>
                      <button
                        type="button"
                        onClick={() => changeAmountMode(idx, "flat")}
                        className={`px-2 py-1 border rounded ${
                          !isTime ? "bg-primary text-white border-primary" : ""
                        }`}
                      >
                        Flat amount
                      </button>
                    </div>
                    {isTime ? (
                      <div className="flex flex-wrap gap-3">
                        <div className="relative w-full md:w-32">
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={li.quantity}
                            onChange={(e) =>
                              setLine(idx, { quantity: Number(e.target.value) })
                            }
                            className="w-full rounded-md border border-border bg-surface pl-3 pr-8 py-2"
                          />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">
                            hrs
                          </span>
                        </div>
                        <div className="relative w-full md:w-36">
                          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
                            ₹
                          </span>
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={li.rate}
                            onChange={(e) =>
                              setLine(idx, { rate: Number(e.target.value) })
                            }
                            className="w-full rounded-md border border-border bg-surface pl-5 pr-3 py-2"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="relative w-full md:w-48">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
                          ₹
                        </span>
                        <input
                          type="number"
                          min={0}
                          placeholder="0"
                          value={li.flatAmount}
                          onChange={(e) =>
                            setLine(idx, { flatAmount: Number(e.target.value) })
                          }
                          className="w-full rounded-md border border-border bg-surface pl-5 pr-3 py-2"
                        />
                      </div>
                    )}
                    <div className="text-right font-medium">
                      Amount: {fmtMoney(safeAmount)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 flex-wrap mt-3">
              <button onClick={addLine} className="px-3 py-2 rounded-md border">
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
                    onChange={(e) => setTaskStatusFilter(e.target.value as any)}
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
                          <th className="p-2 text-right">Override Amount (₹)</th>
                          <th className="p-2 text-right">Action</th>
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
                            const hours = Math.round((minutes / 60) * 100) / 100;
                            const taskId = String(t._id);
                            const overrideValue = taskAmounts[taskId] ?? "";
                            return (
                              <tr key={t._id} className="border-t border-border">
                                <td className="p-2">
                                  <input
                                    type="checkbox"
                                    checked={selectedTaskIds.includes(taskId)}
                                    onChange={() => toggleTask(taskId)}
                                  />
                                </td>
                                <td className="p-2 break-words">{t.title}</td>
                                <td className="p-2 text-right">{minutes}</td>
                                <td className="p-2 text-right">{hours}</td>
                                <td className="p-2 text-right">
                                  <input
                                    type="number"
                                    value={overrideValue}
                                    onChange={(e) =>
                                      setTaskAmounts((prev) => ({
                                        ...prev,
                                        [taskId]: e.target.value,
                                      }))
                                    }
                                    placeholder={
                                      defaultRate
                                        ? String(
                                            Math.round(hours * defaultRate * 100) /
                                              100
                                          )
                                        : ""
                                    }
                                    className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-right"
                                  />
                                </td>
                                <td className="p-2 text-right">
                                  <button
                                    type="button"
                                    className="px-2 py-1 border rounded"
                                    onClick={() => {
                                      const amount = overrideValue
                                        ? Number(overrideValue)
                                        : undefined;
                                      addTaskLineFromTask(t, amount);
                                      setTaskAmounts((prev) => {
                                        const next = { ...prev };
                                        delete next[taskId];
                                        return next;
                                      });
                                    }}
                                  >
                                    Add
                                  </button>
                                </td>
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
        )}

        {isPayable && (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted mb-1">Invoice Amount</div>
              <input
                type="number"
                value={invoiceAmount}
                onChange={(e) => setInvoiceAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
                min={0}
              />
            </div>
            <div>
              <div className="text-xs text-muted mb-1">Attachments</div>
              <input
                type="file"
                multiple
                onChange={(e) => {
                  const files = e.target.files
                    ? Array.from(e.target.files)
                    : [];
                  setAttachments((prev) => [...prev, ...files]);
                  e.target.value = "";
                }}
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
              {attachments.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {attachments.map((file, idx) => (
                    <li
                      key={`${file.name}-${idx}`}
                      className="flex items-center gap-2"
                    >
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        className="underline"
                        onClick={() =>
                          setAttachments((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

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
          <div className="border rounded-md p-3 bg-bg space-y-3">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>
                {fmtMoney(
                  isPayable ? Number(invoiceAmount || 0) : totals.subtotal
                )}
              </span>
            </div>
            {isPayable ? (
              <div className="flex justify-between">
                <span>Tax</span>
                <span>{fmtMoney(0)}</span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>Tax %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={taxPercent}
                    onChange={(e) => setTaxPercent(Number(e.target.value))}
                    className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-right"
                  />
                </div>
                <div className="flex justify-between">
                  <span>Tax ({totals.taxPercent}%)</span>
                  <span>{fmtMoney(totals.tax)}</span>
                </div>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base">
              <span>Total</span>
              <span>
                {fmtMoney(
                  isPayable ? Number(invoiceAmount || 0) : totals.total
                )}
              </span>
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
          <button
            disabled={saving}
            onClick={() => nav("/admin/invoices")}
            className="rounded-md border border-border px-4 py-2 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
