import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

type Invoice = any;

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
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [sortBy, setSortBy] = useState("issueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [items, setItems] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const isReceivable = type === "receivable";

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

  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const t = setTimeout(() => load(), 400);
    return () => clearTimeout(t);
  }, [q, from, to]);

  const listTotals = useMemo(() => {
    return (items || []).reduce(
      (acc, it: any) => {
        const subtotalRaw = Number(
          it?.subtotal ?? it?.totalAmount ?? it?.amount ?? 0
        );
        const taxRaw = Number(it?.taxTotal ?? 0);
        const subtotal = Number.isFinite(subtotalRaw) ? subtotalRaw : 0;
        const tax = Number.isFinite(taxRaw) ? taxRaw : 0;
        const totalSource =
          it?.totalAmount !== undefined && it?.totalAmount !== null
            ? Number(it.totalAmount)
            : subtotal + tax;
        const total = Number.isFinite(totalSource) ? totalSource : 0;
        acc.subtotal += subtotal;
        acc.tax += tax;
        acc.total += total;
        return acc;
      },
      { subtotal: 0, tax: 0, total: 0 }
    );
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
            <Link
              className="px-3 py-1.5 rounded-md border"
              to={`/admin/invoices/new?type=${type}`}
            >
              New Invoice
            </Link>
          <button
            className="px-3 py-1.5 rounded-md border"
            onClick={() =>
              exportExcel({
                type,
                status,
                q,
                from,
                to,
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
                amountMin,
                amountMax,
              })
            }
          >
            Export PDF
          </button>
        </div>
      </div>


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
                {isReceivable && (
                  <th className="text-right p-2">Total</th>
                )}
                <th className="text-right p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const d = it.issueDate ? new Date(it.issueDate) : null;
                const row = i % 2 ? "bg-bg" : "bg-surface/30";
                const subtotalRaw = Number(
                  it?.subtotal ?? it?.totalAmount ?? it?.amount ?? 0
                );
                const subtotal = Number.isFinite(subtotalRaw) ? subtotalRaw : 0;
                const taxRaw = Number(it?.taxTotal ?? 0);
                const tax = Number.isFinite(taxRaw) ? taxRaw : 0;
                const totalSource =
                  it?.totalAmount !== undefined && it?.totalAmount !== null
                    ? Number(it.totalAmount)
                    : subtotal + tax;
                const total = Number.isFinite(totalSource) ? totalSource : 0;
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
                      {isReceivable ? (
                        <div className="flex flex-col items-end leading-tight">
                          <span>{fmtMoney(subtotal)}</span>
                          {tax > 0 ? (
                            <span className="text-xs text-muted">
                              + Tax {fmtMoney(tax)}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        fmtMoney(total)
                      )}
                    </td>
                    {isReceivable && (
                      <td className="p-2 text-right font-medium">
                        {fmtMoney(total)}
                      </td>
                    )}
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
                <td className="p-2 text-right font-semibold">
                  {isReceivable ? (
                    <div className="flex flex-col items-end leading-tight">
                      <span>{fmtMoney(listTotals.subtotal)}</span>
                      {listTotals.tax > 0 ? (
                        <span className="text-xs text-muted">
                          + Tax {fmtMoney(listTotals.tax)}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    fmtMoney(listTotals.total)
                  )}
                </td>
                {isReceivable && (
                  <td className="p-2 text-right font-semibold">
                    {fmtMoney(listTotals.total)}
                  </td>
                )}
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
  amountMin?: string;
  amountMax?: string;
}) {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.from) params.set("from", opts.from);
  if (opts?.to) params.set("to", opts.to);
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
  amountMin?: string;
  amountMax?: string;
}) {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.from) params.set("from", opts.from);
  if (opts?.to) params.set("to", opts.to);
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
