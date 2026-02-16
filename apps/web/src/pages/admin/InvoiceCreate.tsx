import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { z, ZodError } from "zod";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

type LineItem = {
  description: string;
  quantity: number;
  rate: number;
  amountMode: "time" | "flat";
  flatAmount: number;
};

type ProjectLite = { _id: string; title: string; clientId?: string };
type Client = { _id: string; name: string; email?: string };

const fmtMoney = (n: number, currency = "INR", locale = "en-IN") =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);

// ---------------- ZOD SCHEMAS ----------------
const isDate = (s?: string) => !!s && !Number.isNaN(new Date(s).getTime());

const LineItemSchema = z
  .object({
    description: z.string().trim().min(1, "Line description is required"),
    amountMode: z.enum(["time", "flat"]),
    quantity: z.number().nonnegative("Hours must be ≥ 0"),
    rate: z.number().nonnegative("Rate must be ≥ 0"),
    flatAmount: z.number().nonnegative("Flat amount must be ≥ 0"),
  })
  .superRefine((li, ctx) => {
    if (li.amountMode === "time") {
      if (!Number.isFinite(li.quantity) || !Number.isFinite(li.rate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rate"],
          message: "Enter valid hours and rate",
        });
      }
    } else {
      if (!Number.isFinite(li.flatAmount)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["flatAmount"],
          message: "Enter a valid flat amount",
        });
      }
    }
  });

const BaseInvoice = z.object({
  partyType: z.enum(["client", "employee", "vendor"]),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  partyName: z.string().optional(),
  partyEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  issueDate: z.string().refine(isDate, "Issue date is required"),
  dueDate: z
    .string()
    .optional()
    .refine((v) => !v || isDate(v), "Invalid due date"),
  paymentTerms: z.string().max(200, "Payment terms too long").optional(),
  notes: z.string().max(2000, "Notes too long").optional(),
});

const ReceivableSchema = BaseInvoice.extend({
  type: z.literal("receivable"),
  lineItems: z.array(LineItemSchema).min(1, "Add at least one line item"),
  taxPercent: z
    .number()
    .min(0, "Tax must be ≥ 0")
    .max(100, "Tax must be ≤ 100")
    .default(0),
})
  .refine(
    (d) =>
      !!d.projectId || !!d.clientId || !!(d.partyName && d.partyName.trim()),
    {
      message: "Provide a project or a party name",
      path: ["partyName"],
    },
  )
  .refine(
    (d) =>
      !d.dueDate ||
      new Date(d.dueDate).getTime() >= new Date(d.issueDate).getTime(),
    { message: "Due date must be on/after issue date", path: ["dueDate"] },
  )
  .superRefine((d, ctx) => {
    const anyNonEmpty = d.lineItems.some(
      (l) => l.description && l.description.trim().length > 0,
    );
    if (!anyNonEmpty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lineItems"],
        message: "At least one line must have a description",
      });
    }
  });

const PayableSchema = BaseInvoice.extend({
  type: z.literal("payable"),
  invoiceAmount: z.number().positive("Invoice amount must be greater than 0"),
})
  .refine(
    (d) =>
      !d.dueDate ||
      new Date(d.dueDate).getTime() >= new Date(d.issueDate).getTime(),
    { message: "Due date must be on/after issue date", path: ["dueDate"] },
  )
  .refine(
    (d) =>
      !!d.projectId || !!d.clientId || !!(d.partyName && d.partyName.trim()),
    {
      message: "Provide a project or a party name",
      path: ["partyName"],
    },
  );

// -------- error helpers --------
type FieldErrors = Record<string, string>;
const pathKey: any = (path: (string | number)[]) => path.map(String).join(".");
const mapZodErrors = (error: ZodError): FieldErrors =>
  error.issues.reduce((acc, issue) => {
    const key = pathKey(issue.path);
    if (!acc[key]) acc[key] = issue.message;
    return acc;
  }, {} as FieldErrors);

export default function InvoiceCreate() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const initialType =
    (searchParams.get("type") as "receivable" | "payable" | null) ||
    "receivable";

  const [type, setType] = useState<"receivable" | "payable">(initialType);
  const [partyType, setPartyType] = useState<"client" | "employee" | "vendor">(
    initialType === "payable" ? "vendor" : "client",
  );
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [clientChoiceManual, setClientChoiceManual] = useState(false);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [partyName, setPartyName] = useState("");
  const [partyEmail, setPartyEmail] = useState("");
  const [issueDate, setIssueDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = useState<string>("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    {
      description: "",
      quantity: 1,
      rate: 0,
      amountMode: "time",
      flatAmount: 0,
    },
  ]);

  const [saving, setSaving] = useState(false);
  const [apiErr, setApiErr] = useState<string | null>(null); // only API errors up top
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({}); // inline

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
    // clear errors when switching type
    setFieldErrors({});
  }, [type]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/clients");
        setClients(res.data.clients || []);
      } catch (error) {
        console.error("clients load failed", error);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/projects", { params: { active: "true" } });
        setProjects(
          (res.data.projects || []).map((p: any) => ({
            _id: p._id,
            title: p.title,
            clientId: p.client || undefined,
          })),
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

  useEffect(() => {
    if (partyType !== "client") return;
    if (clientChoiceManual) return;
    const proj = projects.find((p) => p._id === projectId);
    if (proj?.clientId) {
      setClientId(proj.clientId);
      const cli = clients.find((c) => c._id === proj.clientId);
      if (cli) {
        setPartyName(cli.name || "");
        setPartyEmail(cli.email || "");
      }
    } else {
      setClientId("");
    }
  }, [projectId, projects, clients, partyType, clientChoiceManual]);

  useEffect(() => {
    if (partyType !== "client") {
      setClientId("");
      setClientChoiceManual(false);
    }
  }, [partyType]);

  useEffect(() => {
    if (partyType !== "client") return;
    if (!clientId) return;
    const cli = clients.find((c) => c._id === clientId);
    if (cli) {
      setPartyName(cli.name || "");
      setPartyEmail(cli.email || "");
    }
  }, [clientId, clients, partyType]);

  // ---- local helpers to manage errors + inputs ----
  const setLine = (idx: number, patch: Partial<LineItem>) => {
    setLineItems((prev) =>
      prev.map((li, i) => (i === idx ? { ...li, ...patch } : li)),
    );
    // clear inline errors for changed fields
    Object.keys(patch).forEach((k) =>
      clearFieldError(`lineItems.${idx}.${k as keyof LineItem}`),
    );
    clearFieldError("lineItems"); // clear block-level lineItems error if any
  };

  const addLine = () => {
    setLineItems((prev) => [
      ...prev,
      {
        description: "",
        quantity: 1,
        rate: 0,
        amountMode: "time",
        flatAmount: 0,
      },
    ]);
    clearFieldError("lineItems");
  };

  const rmLine = (idx: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
    clearFieldError(`lineItems.${idx}.description`);
    clearFieldError(`lineItems.${idx}.quantity`);
    clearFieldError(`lineItems.${idx}.rate`);
    clearFieldError(`lineItems.${idx}.flatAmount`);
    clearFieldError("lineItems");
  };

  const changeAmountMode = (idx: number, mode: "time" | "flat") => {
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
      }),
    );
    clearFieldError(`lineItems.${idx}.rate`);
    clearFieldError(`lineItems.${idx}.quantity`);
    clearFieldError(`lineItems.${idx}.flatAmount`);
  };

  function toggleTask(id: string) {
    setSelectedTaskIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
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
    clearFieldError("lineItems");
  }

  // ---- validation ----
  const clearFieldError = (key: string) =>
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _omit, ...rest } = prev;
      return rest;
    });

  const validateSilent = (): boolean => {
    if (isReceivable) {
      const payload = {
        type: "receivable" as const,
        partyType,
        projectId: projectId || undefined,
        clientId: clientId || undefined,
        partyName: partyName || undefined,
        partyEmail: partyEmail || undefined,
        issueDate,
        dueDate: dueDate || undefined,
        paymentTerms: paymentTerms || undefined,
        notes: notes || undefined,
        lineItems: lineItems.map((li) => ({
          ...li,
          quantity: Number(li.quantity || 0),
          rate: Number(li.rate || 0),
          flatAmount: Number(li.flatAmount || 0),
        })),
        taxPercent: Number(taxPercent || 0),
      };
      return ReceivableSchema.safeParse(payload).success;
    } else {
      const payload = {
        type: "payable" as const,
        partyType,
        projectId: projectId || undefined,
        clientId: clientId || undefined,
        partyName: partyName || undefined,
        partyEmail: partyEmail || undefined,
        issueDate,
        dueDate: dueDate || undefined,
        paymentTerms: paymentTerms || undefined,
        notes: notes || undefined,
        invoiceAmount: Number(invoiceAmount || 0),
      };
      return PayableSchema.safeParse(payload).success;
    }
  };

  const validateAndSetErrors = () => {
    if (isReceivable) {
      const payload = {
        type: "receivable" as const,
        partyType,
        projectId: projectId || undefined,
        clientId: clientId || undefined,
        partyName: partyName || undefined,
        partyEmail: partyEmail || undefined,
        issueDate,
        dueDate: dueDate || undefined,
        paymentTerms: paymentTerms || undefined,
        notes: notes || undefined,
        lineItems: lineItems.map((li) => ({
          ...li,
          quantity: Number(li.quantity || 0),
          rate: Number(li.rate || 0),
          flatAmount: Number(li.flatAmount || 0),
        })),
        taxPercent: Number(taxPercent || 0),
      };
      const r = ReceivableSchema.safeParse(payload);
      if (!r.success) {
        setFieldErrors(mapZodErrors(r.error));
        return null;
      }
      setFieldErrors({});
      return r.data;
    } else {
      const payload = {
        type: "payable" as const,
        partyType,
        projectId: projectId || undefined,
        clientId: clientId || undefined,
        partyName: partyName || undefined,
        partyEmail: partyEmail || undefined,
        issueDate,
        dueDate: dueDate || undefined,
        paymentTerms: paymentTerms || undefined,
        notes: notes || undefined,
        invoiceAmount: Number(invoiceAmount || 0),
      };
      const r = PayableSchema.safeParse(payload);
      if (!r.success) {
        setFieldErrors(mapZodErrors(r.error));
        return null;
      }
      setFieldErrors({});
      return r.data;
    }
  };

  const canSave = validateSilent();

  // ---- totals ----
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
      100,
    );
    const tax = subtotal * (normalizedTaxPercent / 100);
    return {
      subtotal,
      tax,
      total: subtotal + tax,
      taxPercent: normalizedTaxPercent,
    };
  }, [lineItems, taxPercent]);

  // ---- API submit ----
  async function createInvoice() {
    try {
      setSaving(true);
      setApiErr(null);

      const validated: any = validateAndSetErrors();
      if (!validated) return; // inline errors shown

      if (isPayable) {
        const res = await api.post("/invoices", {
          type: "payable",
          partyType: validated.partyType,
          projectId: validated.projectId,
          clientId: validated.clientId,
          partyName: validated.partyName,
          partyEmail: validated.partyEmail || undefined,
          issueDate: validated.issueDate,
          dueDate: validated.dueDate,
          paymentTerms: validated.paymentTerms,
          lineItems: [
            {
              description: "Invoice Amount",
              quantity: 1,
              rate: validated.invoiceAmount,
              taxPercent: 0,
            },
          ],
          notes: validated.notes,
          status: "draft",
        });
        const invId = res?.data?.invoice?._id;
        if (invId && attachments.length) {
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
        nav(invId ? `/admin/invoices/${invId}` : "/admin/invoices");
      } else {
        const normalizedTaxPercent = (validated as any).taxPercent ?? 0;
        const res = await api.post("/invoices", {
          type: "receivable",
          partyType: validated.partyType,
          projectId: validated.projectId,
          clientId: validated.clientId,
          partyName: validated.partyName,
          partyEmail: validated.partyEmail || undefined,
          issueDate: validated.issueDate,
          dueDate: validated.dueDate,
          paymentTerms: validated.paymentTerms,
          lineItems: (validated as any).lineItems.map((li: LineItem) => {
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
          notes: validated.notes,
          status: "draft",
        });
        const invId = res?.data?.invoice?._id;
        nav(invId ? `/admin/invoices/${invId}` : "/admin/invoices");
      }
    } catch (e: any) {
      setApiErr(e?.response?.data?.error || "Failed to create invoice");
    } finally {
      setSaving(false);
    }
  }

  // ---- UI helpers ----
  const inputClass = (key: string) =>
    `w-full rounded-md border bg-surface px-3 py-2 ${
      fieldErrors[key] ? "border-error" : "border-border"
    }`;

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
          <p className="text-sm text-muted-foreground">
            Create an invoice with detailed line items and rich descriptions.
          </p>
        </div>
        <Button asChild variant="outline" className="h-10">
          <Link to="/admin/invoices">Back to invoices</Link>
        </Button>
      </div>

      {/* Only API errors at top */}
      {apiErr && <div className="text-error text-sm">{apiErr}</div>}

      <div className="flex flex-wrap gap-2">
        <Button
          variant={type === "receivable" ? "default" : "outline"}
          size="sm"
          onClick={() => setType("receivable")}
        >
          Outgoing
        </Button>
        <Button
          variant={type === "payable" ? "default" : "outline"}
          size="sm"
          onClick={() => setType("payable")}
        >
          Incoming
        </Button>
      </div>

      <div className="border border-border rounded-xl p-5 space-y-4 bg-surface/50">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {!isPayable && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Party Type
              </div>
              <Select
                value={partyType}
                onValueChange={(v) => setPartyType(v as any)}
              >
                <SelectTrigger className={inputClass("partyType")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <div className="text-xs text-muted-foreground mb-1">
              Project (Client)
            </div>
            <Select
              value={projectId}
              onValueChange={async (v) => {
                const val = v;
                setClientChoiceManual(false);
                setProjectId(val);
                clearFieldError("partyName"); // condition could be satisfied by project
                if (val) {
                  const proj = projects.find((p) => p._id === val);
                  if (proj && !partyName) setPartyName(proj.title);
                  await loadTasksForProject(val);
                } else {
                  setTasks([]);
                }
              }}
            >
              <SelectTrigger className={inputClass("projectId")}>
                <SelectValue placeholder="— Select Project —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— Select Project —</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* if the schema put "Provide a project or a party name" on partyName, we show it below partyName field instead */}
          </div>

          {partyType === "client" && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Client</div>
              <Select
                value={clientId}
                onValueChange={(v) => {
                  setClientChoiceManual(true);
                  setClientId(v);
                  if (!v) return;
                  clearFieldError("partyName");
                }}
              >
                <SelectTrigger className={inputClass("clientId")}>
                  <SelectValue placeholder="— Custom recipient —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— Custom recipient —</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name} {c.email ? `(${c.email})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Pick a saved client or choose custom to send to another contact.
              </p>
            </div>
          )}

          <div>
            <div className="text-xs text-muted-foreground mb-1">Party Name</div>
            <input
              placeholder="Company or person e.g. Acme Ltd."
              value={partyName}
              onChange={(e) => {
                setPartyName(e.target.value);
                clearFieldError("partyName");
              }}
              className={inputClass("partyName")}
            />
            {fieldErrors["partyName"] && (
              <p className="text-xs text-error mt-1">
                {fieldErrors["partyName"]}
              </p>
            )}
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">
              Party Email
            </div>
            <input
              type="email"
              placeholder="billing@acme.com"
              value={partyEmail}
              onChange={(e) => {
                setPartyEmail(e.target.value);
                clearFieldError("partyEmail");
              }}
              className={inputClass("partyEmail")}
            />
            {fieldErrors["partyEmail"] && (
              <p className="text-xs text-error mt-1">
                {fieldErrors["partyEmail"]}
              </p>
            )}
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">Issue Date</div>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => {
                setIssueDate(e.target.value);
                clearFieldError("issueDate");
                clearFieldError("dueDate");
              }}
              className={inputClass("issueDate")}
            />
            {fieldErrors["issueDate"] && (
              <p className="text-xs text-error mt-1">
                {fieldErrors["issueDate"]}
              </p>
            )}
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">Due Date</div>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                clearFieldError("dueDate");
              }}
              className={inputClass("dueDate")}
            />
            {fieldErrors["dueDate"] && (
              <p className="text-xs text-error mt-1">
                {fieldErrors["dueDate"]}
              </p>
            )}
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">
              Payment Terms
            </div>
            <input
              placeholder="Net 15 / Net 30 / On receipt"
              value={paymentTerms}
              onChange={(e) => {
                setPaymentTerms(e.target.value);
                clearFieldError("paymentTerms");
              }}
              className={inputClass("paymentTerms")}
            />
            {fieldErrors["paymentTerms"] && (
              <p className="text-xs text-error mt-1">
                {fieldErrors["paymentTerms"]}
              </p>
            )}
          </div>
        </div>

        {isReceivable && (
          <div>
            <div className="text-sm font-semibold">Line Items</div>
            {fieldErrors["lineItems"] && (
              <div className="text-xs text-error mt-1">
                {fieldErrors["lineItems"]}
              </div>
            )}
            <div className="space-y-3 mt-2">
              {lineItems.length === 0 && (
                <div className="border border-dashed border-border rounded-md p-4 text-sm text-muted-foreground">
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
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
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
                      onChange={(e) =>
                        setLine(idx, { description: e.target.value })
                      }
                      className={`w-full rounded-md border bg-surface px-3 py-2 ${
                        fieldErrors[`lineItems.${idx}.description`]
                          ? "border-error"
                          : "border-border"
                      }`}
                      rows={3}
                    />
                    {fieldErrors[`lineItems.${idx}.description`] && (
                      <p className="text-xs text-error mt-1">
                        {fieldErrors[`lineItems.${idx}.description`]}
                      </p>
                    )}

                    <div className="flex gap-2 text-xs text-muted-foreground flex-wrap">
                      <button
                        type="button"
                        className="px-2 py-1 border rounded"
                        onClick={() =>
                          setLine(idx, {
                            description:
                              (li.description || "") +
                              (li.description?.endsWith("\n") || !li.description
                                ? ""
                                : "\n") +
                              "• ",
                          })
                        }
                      >
                        • Bullet
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 border rounded"
                        onClick={() => {
                          const current = li.description || "";
                          const lines = current
                            .split(/\n/)
                            .map((line) => line.trim())
                            .filter((line) => /^\d+\./.test(line));
                          const lastNumber = lines.length
                            ? parseInt(
                                lines[lines.length - 1].split(".")[0],
                                10,
                              )
                            : 0;
                          const nextNumber = Number.isFinite(lastNumber)
                            ? lastNumber + 1
                            : 1;
                          const needsNewline =
                            current.length > 0 && !current.endsWith("\n");
                          const nextValue = `${current}${
                            needsNewline ? "\n" : ""
                          }${nextNumber}. `;
                          setLine(idx, { description: nextValue });
                        }}
                      >
                        1. Numbered
                      </button>
                      <span className="inline-flex items-center">
                        Lists supported via Enter
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-xs text-muted-foreground">
                        Amount type
                      </span>
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
                            className={`w-full rounded-md border bg-surface pl-3 pr-8 py-2 ${
                              fieldErrors[`lineItems.${idx}.quantity`]
                                ? "border-error"
                                : "border-border"
                            }`}
                          />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            hrs
                          </span>
                          {fieldErrors[`lineItems.${idx}.quantity`] && (
                            <p className="text-xs text-error mt-1">
                              {fieldErrors[`lineItems.${idx}.quantity`]}
                            </p>
                          )}
                        </div>

                        <div className="relative w-full md:w-36">
                          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
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
                            className={`w-full rounded-md border bg-surface pl-5 pr-3 py-2 ${
                              fieldErrors[`lineItems.${idx}.rate`]
                                ? "border-error"
                                : "border-border"
                            }`}
                          />
                          {fieldErrors[`lineItems.${idx}.rate`] && (
                            <p className="text-xs text-error mt-1">
                              {fieldErrors[`lineItems.${idx}.rate`]}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="relative w-full md:w-48">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
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
                          className={`w-full rounded-md border bg-surface pl-5 pr-3 py-2 ${
                            fieldErrors[`lineItems.${idx}.flatAmount`]
                              ? "border-error"
                              : "border-border"
                          }`}
                        />
                        {fieldErrors[`lineItems.${idx}.flatAmount`] && (
                          <p className="text-xs text-error mt-1">
                            {fieldErrors[`lineItems.${idx}.flatAmount`]}
                          </p>
                        )}
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
                {/* ... task picker unchanged ... */}
                {/* keep your existing table/picker code */}
              </div>
            )}
          </div>
        )}

        {isPayable && (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Invoice Amount
              </div>
              <input
                type="number"
                value={invoiceAmount}
                onChange={(e) => {
                  setInvoiceAmount(e.target.value);
                  clearFieldError("invoiceAmount");
                }}
                placeholder="0.00"
                className={inputClass("invoiceAmount")}
                min={0}
              />
              {fieldErrors["invoiceAmount"] && (
                <p className="text-xs text-error mt-1">
                  {fieldErrors["invoiceAmount"]}
                </p>
              )}
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Attachments
              </div>
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
                            prev.filter((_, i) => i !== idx),
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
            <div className="text-xs text-muted-foreground">Notes</div>
            <textarea
              placeholder="Thank you for your business. UPI/Bank details, late fee policy, or PO reference can go here."
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                clearFieldError("notes");
              }}
              className={inputClass("notes") + " h-24"}
            />
            {fieldErrors["notes"] && (
              <p className="text-xs text-error mt-1">{fieldErrors["notes"]}</p>
            )}
          </div>

          <div className="border rounded-md p-3 bg-bg space-y-3">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>
                {fmtMoney(
                  isPayable ? Number(invoiceAmount || 0) : totals.subtotal,
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
                    onChange={(e) => {
                      setTaxPercent(Number(e.target.value));
                      clearFieldError("taxPercent");
                    }}
                    className={`w-24 rounded-md border bg-surface px-2 py-1 text-right ${
                      fieldErrors["taxPercent"]
                        ? "border-error"
                        : "border-border"
                    }`}
                  />
                </div>
                {fieldErrors["taxPercent"] && (
                  <p className="text-xs text-error mt-1">
                    {fieldErrors["taxPercent"]}
                  </p>
                )}
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
                  isPayable ? Number(invoiceAmount || 0) : totals.total,
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            disabled={saving}
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
