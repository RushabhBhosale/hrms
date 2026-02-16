import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  Download,
  Edit2,
  EyeIcon,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  RefreshCwOff,
  Trash2,
} from "lucide-react";
import { api } from "../../lib/api";
import { resolveMediaUrl } from "../../lib/utils";


const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const;

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
] as const;

type ExpenseCategory = {
  _id: string;
  name: string;
  isDefault?: boolean;
};

type ExpenseRecurring = {
  frequency: string;
  startDate?: string;
  nextDueDate?: string;
  reminderDaysBefore?: number;
};

type ExpenseItem = {
  _id: string;
  date: string;
  category: ExpenseCategory | null;
  categoryName: string;
  description?: string;
  notes?: string;
  amount: number;
  paidBy: string;
  attachments: string[];
  isRecurring: boolean;
  recurring?: ExpenseRecurring | null;
  hasVoucher?: boolean;
  voucher?: {
    number?: string;
    authorizedBy?: string;
    pdfFile?: string;
    generatedAt?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type ExpenseFormState = {
  id: string | null;
  date: string;
  categoryId: string;
  description: string;
  notes: string;
  amount: string;
  paidBy: string;
  isRecurring: boolean;
  frequency: string;
  startDate: string;
  reminderDaysBefore: number;
  serverNextDueDate?: string | null;
  generateVoucher: boolean;
  authorizedBy: string;
  serverVoucherNumber?: string | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const initialForm = (): ExpenseFormState => ({
  id: null,
  date: todayISO(),
  categoryId: "",
  description: "",
  notes: "",
  amount: "",
  paidBy: PAYMENT_MODES[0].value,
  isRecurring: false,
  frequency: FREQUENCIES[2].value,
  startDate: todayISO(),
  reminderDaysBefore: 0,
  serverNextDueDate: null,
  generateVoucher: false,
  authorizedBy: "",
  serverVoucherNumber: null,
});

const freqConfig: Record<
  string,
  { unit: "days" | "months" | "years"; value: number }
> = {
  daily: { unit: "days", value: 1 },
  weekly: { unit: "days", value: 7 },
  monthly: { unit: "months", value: 1 },
  quarterly: { unit: "months", value: 3 },
  yearly: { unit: "years", value: 1 },
};

function normalizeDate(value?: string | Date | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addFrequency(date: Date, frequency: string) {
  const cfg = freqConfig[frequency];
  if (!cfg) return null;
  const next = new Date(date.getTime());
  if (cfg.unit === "days") {
    next.setDate(next.getDate() + cfg.value);
    return next;
  }
  if (cfg.unit === "months") {
    const currentDay = date.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + cfg.value);
    const max = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(currentDay, max));
    return next;
  }
  if (cfg.unit === "years") {
    next.setFullYear(next.getFullYear() + cfg.value);
    return next;
  }
  return null;
}

function computeNextDue(startDate?: string, frequency?: string) {
  const start = normalizeDate(startDate ?? null);
  if (!start || !frequency || !freqConfig[frequency]) return null;
  const today = normalizeDate(new Date());
  if (!today) return null;
  if (start >= today) return start;
  let cursor: Date | null = new Date(start.getTime());
  let guard = 0;
  while (cursor && cursor < today && guard < 500) {
    cursor = addFrequency(cursor, frequency);
    guard += 1;
  }
  return cursor && cursor >= today ? cursor : null;
}

function formatDate(input?: string | Date | null) {
  if (!input) return "-";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ExpensesAdmin() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [categoryInput, setCategoryInput] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseFormState>(() => initialForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<string[]>([]);
  const [attachmentsToRemove, setAttachmentsToRemove] = useState<string[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [selectedExpense, setSelectedExpense] = useState<ExpenseItem | null>(
    null,
  );

  async function loadCategories() {
    try {
      setLoadingCategories(true);
      const res = await api.get("/expenses/categories");
      const items: ExpenseCategory[] = res.data?.categories ?? [];
      setCategories(items);
      setForm((prev) => {
        if (!prev.categoryId && items.length) {
          return { ...prev, categoryId: items[0]._id };
        }
        return prev;
      });
    } catch (err: any) {
      console.error("load categories", err);
      setCategoryError(
        err?.response?.data?.error || "Failed to load categories",
      );
    } finally {
      setLoadingCategories(false);
    }
  }

  async function loadExpenses() {
    try {
      setLoadingExpenses(true);
      const res = await api.get("/expenses");
      setExpenses(res.data?.expenses ?? []);
    } catch (err: any) {
      console.error("load expenses", err);
      setFormError(err?.response?.data?.error || "Failed to load expenses");
    } finally {
      setLoadingExpenses(false);
    }
  }

  useEffect(() => {
    loadCategories();
    loadExpenses();
  }, []);

  const nextDuePreview = useMemo(() => {
    if (!form.isRecurring) return null;
    return (
      computeNextDue(form.startDate, form.frequency) ||
      (form.serverNextDueDate ? new Date(form.serverNextDueDate) : null)
    );
  }, [
    form.isRecurring,
    form.startDate,
    form.frequency,
    form.serverNextDueDate,
  ]);

  function resetForm() {
    setForm(() => {
      const base = initialForm();
      if (categories.length) base.categoryId = categories[0]._id;
      return base;
    });
    setExistingAttachments([]);
    setAttachmentsToRemove([]);
    setNewFiles([]);
    setFileInputKey((k) => k + 1);
    setFormError(null);
  }

  async function handleSaveExpense() {
    if (!form.categoryId) {
      setFormError("Please select a category");
      return;
    }
    if (!form.amount) {
      setFormError("Please enter an amount");
      return;
    }
    if (form.generateVoucher && !form.authorizedBy.trim()) {
      setFormError("Please provide an Authorized By name for the voucher");
      return;
    }
    try {
      setSavingExpense(true);
      setFormError(null);
      const payload = new FormData();
      payload.append("date", form.date);
      payload.append("categoryId", form.categoryId);
      payload.append("amount", form.amount);
      payload.append("paidBy", form.paidBy);
      payload.append("description", form.description || "");
      payload.append("notes", form.notes || "");
      payload.append("isRecurring", String(form.isRecurring));
      payload.append("voucherEnabled", String(form.generateVoucher));
      if (form.generateVoucher || form.id) {
        payload.append("voucherAuthorizedBy", form.authorizedBy || "");
      }
      if (form.isRecurring) {
        payload.append("frequency", form.frequency);
        payload.append("startDate", form.startDate);
        payload.append(
          "reminderDaysBefore",
          String(Math.max(0, form.reminderDaysBefore)),
        );
      }
      if (attachmentsToRemove.length && form.id) {
        payload.append(
          "removeAttachments",
          JSON.stringify(attachmentsToRemove),
        );
      }
      newFiles.forEach((file) => payload.append("attachments", file));

      if (form.id) {
        await api.put(`/expenses/${form.id}`, payload, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        await api.post("/expenses", payload, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      await Promise.all([loadExpenses(), loadCategories()]);
      resetForm();
    } catch (err: any) {
      console.error("save expense", err);
      const msg = err?.response?.data?.error || "Failed to save expense";
      setFormError(msg);
    } finally {
      setSavingExpense(false);
    }
  }

  function startEdit(expense: ExpenseItem) {
    const matchedCategoryId =
      expense.category?._id ||
      categories.find((cat) => cat.name === expense.categoryName)?._id ||
      (categories[0]?._id ?? "");
    setForm({
      id: expense._id,
      date: expense.date?.slice(0, 10) || todayISO(),
      categoryId: matchedCategoryId,
      description: expense.description || "",
      notes: expense.notes || "",
      amount: String(expense.amount ?? ""),
      paidBy: expense.paidBy || PAYMENT_MODES[0].value,
      isRecurring: expense.isRecurring,
      frequency: expense.recurring?.frequency || FREQUENCIES[2].value,
      startDate: expense.recurring?.startDate
        ? expense.recurring.startDate.slice(0, 10)
        : expense.date?.slice(0, 10) || todayISO(),
      reminderDaysBefore: expense.recurring?.reminderDaysBefore ?? 0,
      serverNextDueDate: expense.recurring?.nextDueDate || null,
      generateVoucher: Boolean(expense.hasVoucher),
      authorizedBy: expense.voucher?.authorizedBy || "",
      serverVoucherNumber: expense.voucher?.number || null,
    });
    setExistingAttachments(expense.attachments || []);
    setAttachmentsToRemove([]);
    setNewFiles([]);
    setFileInputKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleRemoveAttachment(name: string) {
    setAttachmentsToRemove((prev) =>
      prev.includes(name)
        ? prev.filter((item) => item !== name)
        : [...prev, name],
    );
  }

  function onFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    setNewFiles(files);
  }

  async function deleteExpense(id: string) {
    if (!window.confirm("Delete this expense?")) return;
    try {
      await api.delete(`/expenses/${id}`);
      await loadExpenses();
    } catch (err: any) {
      console.error("delete expense", err);
      setFormError(err?.response?.data?.error || "Failed to delete expense");
    }
  }

  async function endRecurring(expense: ExpenseItem) {
    if (!expense.isRecurring) return;
    if (!window.confirm("End recurring schedule for this expense?")) return;
    try {
      const payload = new FormData();
      payload.append("isRecurring", "false");
      await api.put(`/expenses/${expense._id}`, payload, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await loadExpenses();
    } catch (err: any) {
      console.error("end recurring expense", err);
      setFormError(
        err?.response?.data?.error || "Failed to end recurring expense",
      );
    }
  }

  async function addCategory() {
    const name = categoryInput.trim();
    if (!name) {
      setCategoryError("Enter a category name");
      return;
    }
    try {
      setCategoryError(null);
      await api.post("/expenses/categories", { name });
      setCategoryInput("");
      await loadCategories();
    } catch (err: any) {
      console.error("add category", err);
      setCategoryError(err?.response?.data?.error || "Failed to add category");
    }
  }

  async function removeCategory(id: string) {
    if (!window.confirm("Remove this category?")) return;
    try {
      await api.delete(`/expenses/categories/${id}`);
      await loadCategories();
    } catch (err: any) {
      console.error("remove category", err);
      setCategoryError(
        err?.response?.data?.error || "Failed to remove category",
      );
    }
  }

  function downloadExpense(expense: ExpenseItem) {
    const payload = {
      ...expense,
      categoryLabel: expense.category?.name || expense.categoryName,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `expense-${expense._id}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function printExpense(expense: ExpenseItem) {
    const win = window.open("", "_blank", "width=480,height=640");
    if (!win) return;
    const categoryLabel = expense.category?.name || expense.categoryName;
    const rows = [
      ["Date", formatDate(expense.date)],
      ["Category", categoryLabel],
      [
        "Amount",
        expense.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 }),
      ],
      ["Paid By", expense.paidBy.toUpperCase()],
      ["Description", expense.description || "-"],
      ["Notes", expense.notes || "-"],
    ];
    if (expense.isRecurring) {
      rows.push(["Recurring", `Yes (${expense.recurring?.frequency || "-"})`]);
      rows.push([
        "Start Date",
        formatDate(expense.recurring?.startDate || expense.date),
      ]);
      rows.push([
        "Next Due",
        formatDate(
          expense.recurring?.nextDueDate || expense.recurring?.startDate,
        ),
      ]);
      rows.push([
        "Reminder",
        `${expense.recurring?.reminderDaysBefore ?? 0} day(s) before`,
      ]);
    }
    if (expense.hasVoucher && expense.voucher?.number) {
      rows.push(["Voucher No.", expense.voucher.number]);
      rows.push(["Authorized By", expense.voucher?.authorizedBy || "-"]);
    }
    const doc = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Expense ${expense._id}</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  td { border: 1px solid #ccc; padding: 8px 12px; vertical-align: top; }
  td.label { width: 160px; font-weight: bold; background: #f5f5f5; }
</style>
</head>
<body>
  <h1>Expense Record</h1>
  <table>
    ${rows
      .map(
        ([label, value]) =>
          `<tr><td class="label">${label}</td><td>${value}</td></tr>`,
      )
      .join("")}
  </table>
</body>
</html>`;
    win.document.write(doc);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
      win.close();
    }, 100);
  }

  return (
    <>
      <div className="space-y-8">
        <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Expense Entry</h2>
              {form.id && (
                <button
                  onClick={resetForm}
                  className="inline-flex items-center gap-2 text-xs text-accent hover:text-secondary"
                >
                  <RefreshCw size={14} />
                  Reset
                </button>
              )}
            </div>
            {formError && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col text-sm">
                <span className="mb-1 font-medium">Date of Expense</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, date: e.target.value }))
                  }
                  className="rounded border border-border bg-white px-3 py-2"
                />
              </label>
              <label className="flex flex-col text-sm">
                <span className="mb-1 font-medium">Expense Category</span>
                <select
                  value={form.categoryId}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, categoryId: e.target.value }))
                  }
                  className="rounded border border-border bg-white px-3 py-2"
                >
                  <option value="" disabled>
                    Select a category
                  </option>
                  {categories.map((cat) => (
                    <option key={cat._id} value={cat._id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-sm sm:col-span-2">
                <span className="mb-1 font-medium">Description / Notes</span>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  placeholder="Short description"
                  className="rounded border border-border bg-white px-3 py-2"
                />
              </label>
              <label className="flex flex-col text-sm">
                <span className="mb-1 font-medium">Amount</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, amount: e.target.value }))
                  }
                  className="rounded border border-border bg-white px-3 py-2"
                  placeholder="0.00"
                />
              </label>
              <label className="flex flex-col text-sm">
                <span className="mb-1 font-medium">Paid By</span>
                <select
                  value={form.paidBy}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, paidBy: e.target.value }))
                  }
                  className="rounded border border-border bg-white px-3 py-2"
                >
                  {PAYMENT_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-sm sm:col-span-2">
                <span className="mb-1 font-medium">Attachment (optional)</span>
                <input
                  key={fileInputKey}
                  type="file"
                  multiple
                  onChange={onFilesChange}
                  className="rounded border border-border bg-white px-3 py-2"
                />
                {(newFiles.length > 0 || existingAttachments.length > 0) && (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {existingAttachments.map((file) => (
                      <li
                        key={file}
                        className="flex items-center justify-between gap-2"
                      >
                        <span>{file}</span>
                        <button
                          type="button"
                          onClick={() => toggleRemoveAttachment(file)}
                          className={`inline-flex items-center gap-1 rounded px-2 py-1 border border-border ${
                            attachmentsToRemove.includes(file)
                              ? "bg-red-50 text-red-600"
                              : "bg-white text-accent"
                          }`}
                        >
                          {attachmentsToRemove.includes(file)
                            ? "Undo"
                            : "Remove"}
                        </button>
                      </li>
                    ))}
                    {newFiles.map((file, idx) => (
                      <li
                        key={`${file.name}-${idx}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span>{file.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setNewFiles((prev) =>
                              prev.filter((_, i) => i !== idx),
                            )
                          }
                          className="inline-flex items-center gap-1 rounded px-2 py-1 border border-border text-red-600"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </label>

              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.isRecurring}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      isRecurring: e.target.checked,
                    }))
                  }
                />
                <span className="font-medium">Mark as Recurring Expense</span>
              </label>

              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.generateVoucher}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      generateVoucher: e.target.checked,
                      authorizedBy: e.target.checked ? prev.authorizedBy : "",
                    }))
                  }
                />
                <span className="font-medium">Generate Voucher</span>
              </label>

              {form.generateVoucher && (
                <div className="sm:col-span-2 grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col text-sm">
                    <span className="mb-1 font-medium">Authorized By</span>
                    <input
                      type="text"
                      value={form.authorizedBy}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          authorizedBy: e.target.value,
                        }))
                      }
                      className="rounded border border-border bg-white px-3 py-2"
                      placeholder="Name of approver"
                    />
                  </label>
                  {form.serverVoucherNumber && (
                    <div className="text-sm text-muted-foreground self-center">
                      Voucher No.:{" "}
                      <span className="font-medium text-foreground/80">
                        {form.serverVoucherNumber}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {form.isRecurring && (
                <>
                  <label className="flex flex-col text-sm">
                    <span className="mb-1 font-medium">Frequency</span>
                    <select
                      value={form.frequency}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          frequency: e.target.value,
                        }))
                      }
                      className="rounded border border-border bg-white px-3 py-2"
                    >
                      {FREQUENCIES.map((freq) => (
                        <option key={freq.value} value={freq.value}>
                          {freq.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col text-sm">
                    <span className="mb-1 font-medium">Start Date</span>
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          startDate: e.target.value,
                        }))
                      }
                      className="rounded border border-border bg-white px-3 py-2"
                    />
                  </label>
                  <label className="flex flex-col text-sm">
                    <span className="mb-1 font-medium">Reminder</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        value={form.reminderDaysBefore}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            reminderDaysBefore: Math.max(
                              0,
                              Number(e.target.value) || 0,
                            ),
                          }))
                        }
                        className="w-24 rounded border border-border bg-white px-3 py-2"
                      />
                      <span className="text-sm text-muted-foreground">
                        day(s) before due date
                      </span>
                    </div>
                  </label>
                  <div className="sm:col-span-2 text-sm text-muted-foreground">
                    Next Due Date:{" "}
                    <span className="font-medium">
                      {nextDuePreview ? formatDate(nextDuePreview) : "-"}
                    </span>
                  </div>
                </>
              )}

              <label className="flex flex-col text-sm sm:col-span-2">
                <span className="mb-1 font-medium">Additional Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  rows={3}
                  className="rounded border border-border bg-white px-3 py-2"
                />
              </label>
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              {form.id && (
                <button
                  onClick={resetForm}
                  className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleSaveExpense}
                disabled={savingExpense}
                className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {savingExpense ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                {form.id ? "Update Expense" : "Save Expense"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Expense Categories</h3>
            </div>
            {categoryError && (
              <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {categoryError}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                placeholder="New category"
                className="flex-1 rounded border border-border bg-white px-3 py-2 text-sm"
              />
              <button
                onClick={addCategory}
                className="inline-flex items-center gap-1 rounded bg-primary px-3 py-2 text-sm font-semibold text-white"
              >
                <Plus size={16} />
                Add
              </button>
            </div>
            <div className="mt-4 max-h-72 overflow-y-auto">
              {loadingCategories ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="animate-spin" size={16} /> Loading...
                </div>
              ) : categories.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No categories yet.
                </div>
              ) : (
                <ul className="space-y-2 text-sm">
                  {categories.map((cat) => (
                    <li
                      key={cat._id}
                      className="flex items-center justify-between rounded border border-border px-3 py-2"
                    >
                      <span>{cat.name}</span>
                      <button
                        onClick={() => removeCategory(cat._id)}
                        className="inline-flex items-center gap-1 text-red-600"
                      >
                        <Trash2 size={14} />
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Tracked Expenses</h3>
          </div>
          {loadingExpenses ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" size={16} /> Loading expenses...
            </div>
          ) : expenses.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No expenses recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/20">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">
                      Category
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-left font-medium">Paid By</th>
                    <th className="px-3 py-2 text-left font-medium">
                      Recurring
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {expenses.map((expense) => {
                    const categoryLabel =
                      expense.category?.name || expense.categoryName;
                    const amountFormatted = expense.amount.toLocaleString(
                      "en-IN",
                      {
                        style: "currency",
                        currency: "INR",
                        minimumFractionDigits: 2,
                      },
                    );
                    return (
                      <tr key={expense._id} className="hover:bg-muted/10">
                        <td className="px-3 py-2 align-top w-32">
                          {formatDate(expense.date)}
                        </td>
                        <td className="px-3 py-2 align-top">{categoryLabel}</td>
                        {/* <td className="px-3 py-2 align-top max-w-[200px]">
                        <div className="text-sm font-medium text-foreground/90">
                          {expense.description || "-"}
                        </div>
                        {expense.notes && (
                          <div className="text-xs text-muted-foreground">
                            {expense.notes}
                          </div>
                        )}
                      </td> */}
                        <td className="px-3 py-2 align-top text-right font-semibold">
                          {amountFormatted}
                        </td>
                        <td className="px-3 py-2 align-top uppercase">
                          {expense.paidBy}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {expense.isRecurring ? (
                            <div className="space-y-1">
                              <div className="text-xs font-semibold text-emerald-600">
                                {expense.recurring?.frequency || "-"}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Next:{" "}
                                {formatDate(expense.recurring?.nextDueDate)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              No
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setSelectedExpense(expense)}
                              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"
                              title="View Details"
                            >
                              <EyeIcon size={14} />
                            </button>
                            {/* <button
                            onClick={() => downloadExpense(expense)}
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"
                            title="Download"
                          >
                            <Download size={14} />
                          </button> */}
                            <button
                              onClick={() => printExpense(expense)}
                              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"
                              title="Print"
                            >
                              <Printer size={14} />
                            </button>
                            {expense.isRecurring && (
                              <button
                                onClick={() => endRecurring(expense)}
                                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-amber-600"
                                title="End Recurring"
                              >
                                <RefreshCwOff size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => startEdit(expense)}
                              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"
                              title="Edit"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => deleteExpense(expense._id)}
                              className="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs text-red-600"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {selectedExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl rounded-lg border border-border bg-surface text-sm shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h4 className="text-lg font-semibold">Expense Details</h4>
                <p className="text-xs text-muted-foreground">
                  Recorded on {formatDate(selectedExpense.date)}
                </p>
              </div>
              <button
                onClick={() => setSelectedExpense(null)}
                className="text-sm text-accent hover:text-secondary"
              >
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-4 py-4 space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">Category</span>
                  <div className="font-medium">
                    {selectedExpense.category?.name ||
                      selectedExpense.categoryName}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Amount</span>
                  <div className="font-medium">
                    {selectedExpense.amount.toLocaleString("en-IN", {
                      style: "currency",
                      currency: "INR",
                      minimumFractionDigits: 2,
                    })}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Paid By</span>
                  <div className="font-medium uppercase">
                    {selectedExpense.paidBy}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Created</span>
                  <div>{formatDate(selectedExpense.createdAt)}</div>
                </div>
              </div>

              <div>
                <span className="text-muted-foreground">Description</span>
                <div className="whitespace-pre-wrap">
                  {selectedExpense.description || "—"}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Notes</span>
                <div className="whitespace-pre-wrap">
                  {selectedExpense.notes || "—"}
                </div>
              </div>

              {selectedExpense.isRecurring && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">Frequency</span>
                    <div className="font-medium">
                      {selectedExpense.recurring?.frequency || "—"}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Next Due</span>
                    <div>
                      {formatDate(selectedExpense.recurring?.nextDueDate)}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Start Date</span>
                    <div>
                      {formatDate(selectedExpense.recurring?.startDate)}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Reminder</span>
                    <div>
                      {selectedExpense.recurring?.reminderDaysBefore ?? 0}{" "}
                      day(s) before
                    </div>
                  </div>
                </div>
              )}

              {selectedExpense.hasVoucher &&
                selectedExpense.voucher?.number && (
                  <div className="space-y-2">
                    <div className="font-medium">Voucher</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <span className="text-muted-foreground">
                          Voucher No.
                        </span>
                        <div className="font-medium">
                          {selectedExpense.voucher.number}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Authorized By
                        </span>
                        <div>{selectedExpense.voucher.authorizedBy || "—"}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Generated</span>
                        <div>
                          {selectedExpense.voucher.generatedAt
                            ? formatDate(selectedExpense.voucher.generatedAt)
                            : "—"}
                        </div>
                      </div>
                    </div>
                    {selectedExpense.voucher.pdfFile && (
                      <a
                        href={resolveMediaUrl(selectedExpense.voucher.pdfFile) || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-accent hover:text-secondary"
                      >
                        <Download size={14} /> Download Voucher PDF
                      </a>
                    )}
                  </div>
                )}

              <div>
                <span className="text-muted-foreground">Attachments</span>
                {selectedExpense.attachments?.length ? (
                  <ul className="mt-1 space-y-1">
                    {selectedExpense.attachments.map((file) => (
                      <li key={file}>
                        <a
                          href={resolveMediaUrl(file) || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:text-secondary"
                        >
                          {file}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div>None</div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                onClick={() => setSelectedExpense(null)}
                className="rounded border border-border px-3 py-1.5 text-sm"
              >
                Close
              </button>
              {selectedExpense.isRecurring && (
                <button
                  onClick={async () => {
                    await endRecurring(selectedExpense);
                    setSelectedExpense(null);
                  }}
                  className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm text-amber-600"
                >
                  End Recurring
                </button>
              )}
              <button
                onClick={() => {
                  startEdit(selectedExpense);
                  setSelectedExpense(null);
                }}
                className="inline-flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-sm text-white"
              >
                Edit Expense
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
