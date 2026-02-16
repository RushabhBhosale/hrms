import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { resolveMediaUrl } from "../../lib/utils";
import { Button } from "../../components/ui/button";

const fmtMoney = (n: number, currency = "INR", locale = "en-IN") =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(n || 0));

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

export default function InvoiceDetails() {
  const { id } = useParams();
  const nav = useNavigate();

  const [invoice, setInvoice] = useState<any>(null);
  const [projects, setProjects] = useState<{ _id: string; title: string }[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailing, setEmailing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [partyType, setPartyType] = useState<"client" | "employee" | "vendor">(
    "client",
  );
  const [projectId, setProjectId] = useState<string>("");
  const [partyName, setPartyName] = useState("");
  const [partyEmail, setPartyEmail] = useState("");
  const [partyAddress, setPartyAddress] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<any[]>([]);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get(`/invoices/${id}`);
      const inv = res.data.invoice;
      setInvoice(inv);
      setEmailTo(inv?.partyEmail || "");
      setPartyType(inv.partyType);
      setProjectId(inv.project?._id || inv.project || "");
      setPartyName(inv.partyName || "");
      setPartyEmail(inv.partyEmail || "");
      setPartyAddress(inv.partyAddress || "");
      setIssueDate(inv.issueDate ? String(inv.issueDate).slice(0, 10) : "");
      setDueDate(inv.dueDate ? String(inv.dueDate).slice(0, 10) : "");
      setPaymentTerms(inv.paymentTerms || "");
      setCurrency(inv.currency || "INR");
      setNotes(inv.notes || "");
      setLineItems(
        (inv.lineItems || []).map((li: any) => ({
          description: li.description,
          quantity: li.quantity,
          rate: li.rate,
          taxPercent: li.taxPercent,
        })),
      );
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/projects", { params: { active: "true" } });
        setProjects(
          (res.data.projects || []).map((p: any) => ({
            _id: p._id,
            title: p.title,
          })),
        );
      } catch {}
    })();
  }, []);

  async function updateStatus(status: string) {
    try {
      setUpdating(true);
      setErr(null);
      await api.put(`/invoices/${id}`, { status });
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to update");
    } finally {
      setUpdating(false);
    }
  }

  async function sendEmail() {
    try {
      setEmailing(true);
      setErr(null);
      await api.post(`/invoices/${id}/email`, { to: emailTo });
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to email");
    } finally {
      setEmailing(false);
    }
  }

  async function uploadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || !files.length) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    try {
      setUploading(true);
      await api.post(`/invoices/${id}/attachments`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to upload");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function uploadPartyLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || !files.length) return;
    const fd = new FormData();
    fd.append("logo", files[0]);
    try {
      setUploading(true);
      await api.post(`/invoices/${id}/party-logo`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to upload logo");
    } finally {
      setUploading(false);
      (e.target as any).value = "";
    }
  }

  function setLine(idx: number, patch: any) {
    setLineItems((prev) =>
      prev.map((li, i) => (i === idx ? { ...li, ...patch } : li)),
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

  const editTotals = useMemo(() => {
    const subtotal = lineItems.reduce(
      (s, li) => s + Number(li.quantity || 0) * Number(li.rate || 0),
      0,
    );
    const tax = lineItems.reduce(
      (s, li) =>
        s +
        Number(li.quantity || 0) *
          Number(li.rate || 0) *
          (Math.min(Math.max(Number(li.taxPercent || 0), 0), 100) / 100),
      0,
    );
    return { subtotal, tax, total: subtotal + tax };
  }, [lineItems]);

  async function saveEdits() {
    try {
      setSaving(true);
      setErr(null);
      await api.put(`/invoices/${id}`, {
        partyType,
        partyName: partyName || undefined,
        partyEmail: partyEmail || undefined,
        partyAddress: partyAddress || undefined,
        issueDate: issueDate || undefined,
        dueDate: dueDate || undefined,
        paymentTerms: paymentTerms || undefined,
        currency,
        project: projectId || undefined,
        lineItems,
        notes: notes || undefined,
      });
      setEditing(false);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div>Loading…</div>;
  if (!invoice) return <div>Not found</div>;

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Invoice {invoice.invoiceNumber}
          </h2>
          <div className="mt-1 text-sm text-muted-foreground">
            Issued{" "}
            {invoice.issueDate
              ? new Date(invoice.issueDate).toLocaleDateString("en-IN")
              : "-"}
            {invoice.dueDate
              ? ` • Due ${new Date(invoice.dueDate).toLocaleDateString(
                  "en-IN",
                )}`
              : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              const res = await api.get(`/invoices/${invoice._id}/pdf`, {
                responseType: "blob",
              });
              const blob = new Blob([res.data], { type: "application/pdf" });
              const filename = `Invoice-${
                invoice.invoiceNumber || invoice._id
              }.pdf`;
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => window.URL.revokeObjectURL(url), 0);
            }}
          >
            Download PDF
          </Button>
          <Button
            variant="outline"
            className="h-10"
            onClick={() => nav("/admin/invoices")}
          >
            Back
          </Button>
        </div>
      </div>

      {err && <div className="text-error text-sm">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded-xl p-4 bg-surface space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">Status</div>
            <span className={statusClass(invoice.status)}>
              {String(invoice.status || "draft").toUpperCase()}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-muted-foreground">Type</div>
            <div className="font-medium capitalize">{invoice.type}</div>
            {invoice.project && (
              <>
                <div className="text-muted-foreground">Project</div>
                <div className="break-words">
                  {invoice.project?.title || invoice.project}
                </div>
              </>
            )}
            <div className="text-muted-foreground">Currency</div>
            <div className="font-medium">{invoice.currency || "INR"}</div>
          </div>
          <div className="pt-2">
            {!editing ? (
              <button
                className="px-3 py-2 rounded-md border bg-accent text-white"
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            ) : (
              <button
                className="px-3 py-2 rounded-md border bg-accent text-white"
                onClick={() => setEditing(false)}
              >
                Cancel Edit
              </button>
            )}
          </div>
        </div>

        <div className="border rounded-xl p-4 bg-surface">
          {!editing ? (
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Bill To</div>
              <div className="font-semibold">{invoice.partyName || "-"}</div>
              {invoice.partyEmail && (
                <div className="text-sm">{invoice.partyEmail}</div>
              )}
              {invoice.partyAddress && (
                <div className="whitespace-pre-wrap text-sm">
                  {invoice.partyAddress}
                </div>
              )}
              <div className="mt-3">
                <div className="text-sm text-muted-foreground mb-1">
                  Client Logo
                </div>
                <div className="flex items-center gap-2">
                  {invoice.partyLogo ? (
                    <img
                      src={resolveMediaUrl(invoice.partyLogo) || ""}
                      alt="client logo"
                      className="h-10 object-contain"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      No logo
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={uploadPartyLogo}
                    disabled={uploading}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">
                Party Type
              </label>
              <select
                value={partyType}
                onChange={(e) => setPartyType(e.target.value as any)}
                className="w-full rounded-md border border-border bg-bg px-3 py-2"
              >
                <option value="client">Client</option>
                <option value="employee">Employee</option>
                <option value="vendor">Vendor</option>
              </select>
              <label className="text-xs text-muted-foreground mt-2">
                Project (Client)
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-md border border-border bg-bg px-3 py-2"
              >
                <option value="">— Select Project —</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <label className="text-xs text-muted-foreground mt-2">
                Party Name
              </label>
              <input
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder="Company or person e.g. Acme Ltd."
                className="w-full rounded-md border border-border bg-bg px-3 py-2"
              />
              <label className="text-xs text-muted-foreground mt-2">
                Party Email
              </label>
              <input
                type="email"
                value={partyEmail}
                onChange={(e) => setPartyEmail(e.target.value)}
                placeholder="billing@acme.com"
                className="w-full rounded-md border border-border bg-bg px-3 py-2"
              />
              <label className="text-xs text-muted-foreground mt-2">
                Party Address
              </label>
              <textarea
                value={partyAddress}
                onChange={(e) => setPartyAddress(e.target.value)}
                placeholder="Line 1&#10;City, State, ZIP&#10;Country"
                className="w-full rounded-md border border-border bg-bg px-3 py-2 h-24"
              />
            </div>
          )}
        </div>

        <div className="border rounded-xl p-4 bg-surface">
          {!editing ? (
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Totals</div>
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{fmtMoney(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span>{fmtMoney(invoice.taxTotal)}</span>
              </div>
              <div className="flex justify-between font-semibold text-base">
                <span>Total</span>
                <span>{fmtMoney(invoice.totalAmount)}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">
                    Issue Date
                  </label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full rounded-md border border-border bg-bg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full rounded-md border border-border bg-bg px-3 py-2"
                  />
                </div>
              </div>
              <label className="text-xs text-muted-foreground">
                Payment Terms
              </label>
              <input
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="Net 15 / Net 30 / On receipt"
                className="w-full rounded-md border border-border bg-bg px-3 py-2"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">
                    Currency
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full rounded-md border border-border bg-bg px-3 py-2"
                  >
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
              </div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Thank you for your business. UPI/Bank details, late fee policy, or PO reference can go here."
                className="w-full rounded-md border border-border bg-bg px-3 py-2 h-24"
              />
              <div className="mt-2 border rounded-md p-3 bg-bg space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{fmtMoney(editTotals.subtotal, currency)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Tax</span>
                  <span>{fmtMoney(editTotals.tax, currency)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{fmtMoney(editTotals.total, currency)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border bg-white p-2 border-border rounded-xl">
        {!editing ? (
          <table className="min-w-full text-sm">
            <thead className="">
              <tr>
                <th className="text-left p-2">Description</th>
                <th className="text-right p-2">Qty (hrs)</th>
                <th className="text-right p-2">Rate</th>
                <th className="text-right p-2">Tax %</th>
                <th className="text-right p-2">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.lineItems || []).map((li: any, idx: number) => {
                const line =
                  Number(li.quantity || 0) *
                  Number(li.rate || 0) *
                  (1 +
                    Math.min(Math.max(Number(li.taxPercent || 0), 0), 100) /
                      100);
                return (
                  <tr key={idx} className="border-t border-border">
                    <td className="p-2 break-words">{li.description}</td>
                    <td className="p-2 text-right">{li.quantity}</td>
                    <td className="p-2 text-right">
                      {fmtMoney(li.rate, invoice.currency)}
                    </td>
                    <td className="p-2 text-right">{li.taxPercent}</td>
                    <td className="p-2 text-right">
                      {fmtMoney(line, invoice.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="p-3 space-y-2">
            <div className="hidden md:grid md:grid-cols-6 gap-2 text-xs text-muted-foreground px-1">
              <div className="md:col-span-2">Description</div>
              <div>Qty (hrs)</div>
              <div>Rate ({currency === "INR" ? "INR" : currency}/hr)</div>
              <div>Tax (%)</div>
              <div className="text-right">Amount</div>
            </div>
            {(lineItems || []).map((li: any, idx: number) => {
              const amt =
                Number(li.quantity || 0) *
                Number(li.rate || 0) *
                (1 +
                  Math.min(Math.max(Number(li.taxPercent || 0), 0), 100) / 100);
              return (
                <div
                  key={idx}
                  className="grid grid-cols-1 md:grid-cols-6 gap-2 items-center"
                >
                  <input
                    className="rounded-md border border-border bg-surface px-3 py-2 md:col-span-2"
                    value={li.description}
                    onChange={(e) =>
                      setLine(idx, { description: e.target.value })
                    }
                    placeholder="Describe work e.g. Landing page (8h)"
                  />
                  <div className="relative">
                    <input
                      type="number"
                      className="w-full rounded-md border border-border bg-surface pl-3 pr-14 py-2"
                      value={li.quantity}
                      onChange={(e) =>
                        setLine(idx, { quantity: Number(e.target.value) })
                      }
                      placeholder="0.00"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      hrs
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      className="w-full rounded-md border border-border bg-surface pl-3 pr-16 py-2"
                      value={li.rate}
                      onChange={(e) =>
                        setLine(idx, { rate: Number(e.target.value) })
                      }
                      placeholder="0.00"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      {currency === "INR" ? "INR" : currency}/hr
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      className="w-full rounded-md border border-border bg-surface pl-3 pr-8 py-2"
                      value={li.taxPercent}
                      onChange={(e) =>
                        setLine(idx, { taxPercent: Number(e.target.value) })
                      }
                      placeholder="0"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                  <div className="text-right font-medium">
                    {fmtMoney(amt, currency)}
                  </div>
                  <button
                    className="px-3 py-2 rounded-md border md:col-span-1 md:justify-self-start"
                    onClick={() => rmLine(idx)}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
            <button className="px-3 py-2 rounded-md border" onClick={addLine}>
              Add line
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="flex gap-2">
          <button
            className="rounded-md bg-primary text-white px-4 py-2 disabled:opacity-50"
            disabled={saving}
            onClick={saveEdits}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <button
            className="rounded-md border px-4 py-2"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 p-2 bg-white shadow-md w-fit rounded-md">
          <button
            disabled={updating}
            className="px-3 py-2 rounded-md border bg-primary text-white"
            onClick={() => updateStatus("draft")}
          >
            Mark Draft
          </button>
          <button
            disabled={updating}
            className="px-3 py-2 rounded-md border bg-primary text-white"
            onClick={() =>
              updateStatus(invoice.type === "receivable" ? "sent" : "pending")
            }
          >
            Mark {invoice.type === "receivable" ? "Sent" : "Pending"}
          </button>
          <button
            disabled={updating}
            className="px-3 py-2 rounded-md border bg-primary text-white"
            onClick={() => updateStatus("paid")}
          >
            Mark Paid
          </button>
          <button
            disabled={updating}
            className="px-3 py-2 rounded-md border bg-primary text-white"
            onClick={() => updateStatus("overdue")}
          >
            Mark Overdue
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded-xl p-4 bg-surface space-y-2">
          <div className="font-semibold">Email Invoice</div>
          <input
            type="email"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            placeholder="Recipient email"
            className="w-full rounded-md border border-border bg-bg px-3 py-2"
          />
          <button
            disabled={emailing}
            onClick={sendEmail}
            className="rounded-md bg-primary text-white px-4 py-2 disabled:opacity-50"
          >
            {emailing ? "Sending…" : "Send Email"}
          </button>
        </div>
        <div className="border rounded-xl p-4 bg-surface space-y-2">
          <div className="font-semibold">Attachments</div>
          <input
            type="file"
            multiple
            onChange={uploadFiles}
            disabled={uploading}
          />
          <div className="text-xs text-muted-foreground">
            Upload vendor/client invoices or related files
          </div>
          <ul className="list-disc pl-5">
            {(invoice.attachments || []).map((f: string, idx: number) => (
              <li key={idx}>
                <a
                  className="underline"
                  href={resolveMediaUrl(f) || "#"}
                  target="_blank"
                  rel="noreferrer"
                >
                  {f}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
