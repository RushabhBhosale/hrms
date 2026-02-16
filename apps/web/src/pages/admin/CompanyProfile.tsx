import { useEffect, useState, FormEvent } from "react";
import { api } from "../../lib/api";
import { resolveMediaUrl } from "../../lib/utils";
import { applyTheme, resetTheme } from "../../lib/theme";
import { toast } from "react-hot-toast";
import { Field } from "../../components/utils/Field";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

const NameSchema = z.object({
  name: z.string().min(2, "Min 2 characters").max(120, "Max 120 characters"),
});
type NameInput = z.infer<typeof NameSchema>;

const ThemeSchema = z.object({
  primary: z.string().regex(HEX, "Use hex like #2563eb"),
  secondary: z.string().regex(HEX, "Use hex like #10b981"),
  accent: z.string().regex(HEX, "Use hex like #f59e0b"),
  success: z.string().regex(HEX, "Use hex like #16a34a"),
  warning: z.string().regex(HEX, "Use hex like #f59e0b"),
  error: z.string().regex(HEX, "Use hex like #dc2626"),
});
type ThemeInput = z.infer<typeof ThemeSchema>;

const DEFAULT_THEME: ThemeInput = {
  primary: "#2563eb",
  secondary: "#10b981",
  accent: "#f59e0b",
  success: "#16a34a",
  warning: "#f59e0b",
  error: "#dc2626",
};

const SmtpSchema = z
  .object({
    enabled: z.boolean(),
    host: z.string(),
    port: z
      .number()
      .int("Port must be an integer")
      .min(1, "Port must be between 1 and 65535")
      .max(65535, "Port must be between 1 and 65535"),
    secure: z.boolean(),
    user: z.string(),
    password: z.string(),
    from: z.string(),
    replyTo: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.enabled && !data.host.trim()) {
      ctx.addIssue({
        path: ["host"],
        code: z.ZodIssueCode.custom,
        message: "Host is required when SMTP is enabled",
      });
    }
  });

type SmtpInput = z.infer<typeof SmtpSchema>;

const DEFAULT_SMTP: SmtpInput = {
  enabled: false,
  host: "",
  port: 587,
  secure: false,
  user: "",
  password: "",
  from: "",
  replyTo: "",
};

type LeavePolicySnapshot = {
  totalAnnual: number;
  ratePerMonth: number;
  probationRatePerMonth: number;
  accrualStrategy: "ACCRUAL" | "LUMP_SUM";
  typeCaps: {
    paid: number;
    casual: number;
    sick: number;
  };
};

function normalizeLeavePolicy(lp: any): LeavePolicySnapshot {
  return {
    totalAnnual: Number(lp?.totalAnnual ?? 0),
    ratePerMonth: Number(lp?.ratePerMonth ?? 0),
    probationRatePerMonth: Number(lp?.probationRatePerMonth ?? 0),
    accrualStrategy: (lp?.accrualStrategy || "ACCRUAL") as
      | "ACCRUAL"
      | "LUMP_SUM",
    typeCaps: {
      paid: Number(lp?.typeCaps?.paid ?? 0),
      casual: Number(lp?.typeCaps?.casual ?? 0),
      sick: Number(lp?.typeCaps?.sick ?? 0),
    },
  };
}

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

export default function CompanyProfile() {
  // logos & upload state
  const [logoSquare, setLogoSquare] = useState<string | null>(null);
  const [logoHorizontal, setLogoHorizontal] = useState<string | null>(null);
  const [squareFile, setSquareFile] = useState<File | null>(null);
  const [wideFile, setWideFile] = useState<File | null>(null);
  const [uploadingSquare, setUploadingSquare] = useState(false);
  const [uploadingWide, setUploadingWide] = useState(false);

  // global banners
  const [loading, setLoading] = useState(true);
  const [savingTheme, setSavingTheme] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [leaveApplicableFrom, setLeaveApplicableFrom] = useState("");
  const [leavePolicySnapshot, setLeavePolicySnapshot] =
    useState<LeavePolicySnapshot>({
      totalAnnual: 0,
      ratePerMonth: 0,
      probationRatePerMonth: 0,
      accrualStrategy: "ACCRUAL",
      typeCaps: { paid: 0, casual: 0, sick: 0 },
    });
  const [savingLeaveApplicable, setSavingLeaveApplicable] = useState(false);

  // forms
  const {
    register: registerName,
    handleSubmit: handleSubmitName,
    reset: resetName,
    formState: { errors: nameErrors, isSubmitting: savingName },
  } = useForm<NameInput>({
    resolver: zodResolver(NameSchema),
    defaultValues: { name: "" },
    mode: "onSubmit",
  });

  const {
    register: registerTheme,
    handleSubmit: handleSubmitTheme,
    reset: resetThemeForm,
    watch: watchTheme,
    formState: { errors: themeErrors },
  } = useForm<ThemeInput>({
    resolver: zodResolver(ThemeSchema),
    defaultValues: DEFAULT_THEME,
    mode: "onChange",
  });

  const {
    register: registerSmtp,
    handleSubmit: handleSubmitSmtp,
    reset: resetSmtp,
    setValue: setSmtpValue,
    watch: watchSmtp,
    formState: {
      errors: smtpErrors,
      isSubmitting: savingSmtp,
      dirtyFields: smtpDirty,
    },
  } = useForm<SmtpInput>({
    resolver: zodResolver(SmtpSchema),
    defaultValues: DEFAULT_SMTP,
    mode: "onSubmit",
  });

  const smtpValues = watchSmtp();
  const [smtpPasswordSet, setSmtpPasswordSet] = useState(false);
  const [clearSmtpPassword, setClearSmtpPassword] = useState(false);

  // live-preview theme on change (local only)
  const themeWatchValues = watchTheme();
  useEffect(() => {
    applyTheme(themeWatchValues);
  }, [themeWatchValues]);

  // load initial data
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/profile");
        const name = res.data?.company?.name || "";
        const square = res.data?.company?.logoSquare || null;
        const horiz = res.data?.company?.logoHorizontal || null;
        resetName({ name });
        setLogoSquare(square);
        setLogoHorizontal(horiz);

        const themeRes = await api.get("/companies/theme");
        if (themeRes?.data?.theme) {
          const merged = { ...DEFAULT_THEME, ...themeRes.data.theme };
          resetThemeForm(merged);
          applyTheme(merged);
        } else {
          resetThemeForm(DEFAULT_THEME);
          applyTheme(DEFAULT_THEME);
        }

        try {
          const smtpRes = await api.get("/companies/smtp");
          const smtp = smtpRes?.data?.smtp;
          if (smtp) {
            resetSmtp({
              enabled: !!smtp.enabled,
              host: smtp.host || "",
              port: typeof smtp.port === "number" ? smtp.port : 587,
              secure: !!smtp.secure,
              user: smtp.user || "",
              password: "",
              from: smtp.from || "",
              replyTo: smtp.replyTo || "",
            });
            setSmtpPasswordSet(!!smtp.passwordSet);
          } else {
            resetSmtp(DEFAULT_SMTP);
            setSmtpPasswordSet(false);
          }
        } catch (smtpErr) {
          console.warn("[CompanyProfile] failed to load SMTP config", smtpErr);
          resetSmtp(DEFAULT_SMTP);
          setSmtpPasswordSet(false);
        }
        try {
          const leaveRes = await api.get("/companies/leave-policy");
          const lp = leaveRes?.data?.leavePolicy || {};
          setLeaveApplicableFrom(lp.applicableFrom || "");
          setLeavePolicySnapshot(normalizeLeavePolicy(lp));
        } catch (lpErr) {
          console.warn("[CompanyProfile] failed to load leave policy", lpErr);
        }
        setClearSmtpPassword(false);
      } catch (e: any) {
        const msg = e?.response?.data?.error || "Failed to load company";
        setErr(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!smtpValues.enabled) {
      setClearSmtpPassword(false);
    }
  }, [smtpValues.enabled]);

  // helpers
  const resolveLogoUrl = (value: string | null) => {
    return resolveMediaUrl(value);
  };
  const validateImageFile = (file: File | null) => {
    if (!file) return "No file selected";
    if (!file.type.startsWith("image/")) return "Only image files allowed";
    if (file.size > MAX_FILE_BYTES) return "File must be ≤ 10MB";
    return null;
  };

  // submit handlers
  const onSaveName = async (data: NameInput) => {
    setOk(null);
    setErr(null);
    try {
      await api.put("/companies/profile", { name: data.name.trim() });
      setOk("Company name updated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update company name";
      setErr(msg);
      toast.error(msg);
    }
  };

  const onSaveLeaveApplicable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOk(null);
    setErr(null);
    try {
      setSavingLeaveApplicable(true);
      const res = await api.put("/companies/leave-policy", {
        totalAnnual: leavePolicySnapshot.totalAnnual,
        ratePerMonth: leavePolicySnapshot.ratePerMonth,
        probationRatePerMonth: leavePolicySnapshot.probationRatePerMonth,
        accrualStrategy: leavePolicySnapshot.accrualStrategy,
        typeCaps: leavePolicySnapshot.typeCaps,
        applicableFrom: leaveApplicableFrom,
      });
      const lp = res.data?.leavePolicy || {};
      setLeaveApplicableFrom(lp.applicableFrom || "");
      setLeavePolicySnapshot(normalizeLeavePolicy(lp));
      const next = lp.applicableFrom || "";
      setOk(
        next
          ? "Leave applicable month updated"
          : "Leave applicable month cleared",
      );
    } catch (e: any) {
      const msg =
        e?.response?.data?.error || "Failed to update leave applicable month";
      setErr(msg);
      toast.error(msg);
    } finally {
      setSavingLeaveApplicable(false);
    }
  };

  const onSaveTheme = async (data: ThemeInput) => {
    setOk(null);
    setErr(null);
    try {
      setSavingTheme(true);
      await api.put("/companies/theme", data);
      setOk("Theme updated");
      applyTheme(data);
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update theme";
      setErr(msg);
      toast.error(msg);
    } finally {
      setSavingTheme(false);
    }
  };

  const onResetTheme = async () => {
    if (!window.confirm("Reset theme to default colors?")) return;
    setOk(null);
    setErr(null);
    try {
      setSavingTheme(true);
      await api.delete("/companies/theme");
      resetTheme(); // reset CSS vars
      resetThemeForm(DEFAULT_THEME);
      applyTheme(DEFAULT_THEME);
      setOk("Theme reset to defaults");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to reset theme";
      setErr(msg);
      toast.error(msg);
    } finally {
      setSavingTheme(false);
    }
  };

  const onSaveSmtp = async (data: SmtpInput) => {
    setOk(null);
    setErr(null);
    try {
      const payload: Record<string, unknown> = { enabled: data.enabled };

      if (data.enabled) {
        const hostTrimmed = data.host.trim();
        const userTrimmed = data.user.trim();
        const fromTrimmed = data.from.trim();
        const replyTrimmed = data.replyTo.trim();
        payload.host = hostTrimmed;
        payload.port = data.port;
        payload.secure = data.secure;
        if (smtpDirty.user) payload.user = userTrimmed;
        if (smtpDirty.from) payload.from = fromTrimmed;
        if (smtpDirty.replyTo) payload.replyTo = replyTrimmed;
      }

      if (clearSmtpPassword) {
        payload.password = "";
      } else if (smtpDirty.password && data.password.trim()) {
        payload.password = data.password;
      }

      const res = await api.put("/companies/smtp", payload);
      const smtp = res.data?.smtp;
      resetSmtp({
        enabled: !!smtp?.enabled,
        host: smtp?.host || "",
        port: typeof smtp?.port === "number" ? smtp.port : 587,
        secure: !!smtp?.secure,
        user: smtp?.user || "",
        password: "",
        from: smtp?.from || "",
        replyTo: smtp?.replyTo || "",
      });
      setSmtpPasswordSet(!!smtp?.passwordSet);
      setClearSmtpPassword(false);
      setOk(smtp?.enabled ? "SMTP settings updated" : "SMTP disabled");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update SMTP settings";
      setErr(msg);
      toast.error(msg);
    }
  };

  // uploads
  const uploadSquare = async () => {
    setOk(null);
    setErr(null);
    const v = validateImageFile(squareFile);
    if (v) {
      setErr(v);
      toast.error(v);
      return;
    }
    try {
      setUploadingSquare(true);
      const fd = new FormData();
      fd.append("logo", squareFile as File);
      const res = await api.post("/companies/logo-square", fd);
      setLogoSquare(res.data?.logoSquare || null);
      setSquareFile(null);
      setOk("Square logo updated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to upload square logo";
      setErr(msg);
      toast.error(msg);
    } finally {
      setUploadingSquare(false);
    }
  };

  const uploadHorizontal = async () => {
    setOk(null);
    setErr(null);
    const v = validateImageFile(wideFile);
    if (v) {
      setErr(v);
      toast.error(v);
      return;
    }
    try {
      setUploadingWide(true);
      const fd = new FormData();
      fd.append("logo", wideFile as File);
      const res = await api.post("/companies/logo-horizontal", fd);
      setLogoHorizontal(res.data?.logoHorizontal || null);
      setWideFile(null);
      setOk("Horizontal logo updated");
    } catch (e: any) {
      const msg =
        e?.response?.data?.error || "Failed to upload horizontal logo";
      setErr(msg);
      toast.error(msg);
    } finally {
      setUploadingWide(false);
    }
  };

  const squareUrl = resolveLogoUrl(logoSquare);
  const wideUrl = resolveLogoUrl(logoHorizontal);

  if (loading) return <div>Loading…</div>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Company Profile</h2>
        <p className="text-sm text-muted-foreground">
          Update your company name, logos, SMTP, and theme.
        </p>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}
      {ok && (
        <div className="rounded-md border border-success/20 bg-success/10 px-4 py-2 text-sm text-success">
          {ok}
        </div>
      )}

      {/* Name */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">General</h3>
        </div>
        <form
          onSubmit={handleSubmitName(onSaveName)}
          className="px-6 py-5 space-y-5"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Company Name" required>
              <input
                type="text"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="Acme Corp"
                {...registerName("name")}
              />
              {nameErrors.name && (
                <p className="text-xs text-error mt-1">
                  {nameErrors.name.message}
                </p>
              )}
            </Field>
          </div>
          <div className="pt-2">
            <button
              type="submit"
              disabled={savingName}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {savingName ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </section>

      {/* Leave accrual */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Leave Accrual</h3>
          <p className="text-xs text-muted-foreground">
            Choose the month from which leave accrual should be calculated.
          </p>
        </div>
        <form onSubmit={onSaveLeaveApplicable} className="px-6 py-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Leave Applicable From">
              <>
                <input
                  type="month"
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                  value={leaveApplicableFrom}
                  onChange={(e) => setLeaveApplicableFrom(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Employees accrue from their joining month; selecting an
                  earlier month backfills balances company wide.
                </p>
              </>
            </Field>
            <div className="md:col-span-2 rounded-md border border-border/60 bg-muted/10 p-4 text-xs text-muted-foreground">
              {leavePolicySnapshot.accrualStrategy === "LUMP_SUM" ? (
                <>
                  <div>
                    Leaves are granted upfront: employees receive a pool of{" "}
                    <strong>{leavePolicySnapshot.totalAnnual}</strong> leave(s)
                    for the year.
                  </div>
                  <div className="mt-1">
                    Probation status does not change balances while this mode is
                    active.
                  </div>
                </>
              ) : (
                <>
                  <div>
                    Permanent staff accrue{" "}
                    <strong>{leavePolicySnapshot.ratePerMonth}</strong> leave(s)
                    per month, capped at{" "}
                    <strong>{leavePolicySnapshot.totalAnnual}</strong> annually.
                  </div>
                  <div className="mt-1">
                    Probation rate:{" "}
                    <strong>{leavePolicySnapshot.probationRatePerMonth}</strong>{" "}
                    leave(s) per month.
                  </div>
                </>
              )}
              <div className="mt-2">
                Type caps — Paid: {leavePolicySnapshot.typeCaps.paid}, Casual:{" "}
                {leavePolicySnapshot.typeCaps.casual}, Sick:{" "}
                {leavePolicySnapshot.typeCaps.sick}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={savingLeaveApplicable}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {savingLeaveApplicable ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
              onClick={() => setLeaveApplicableFrom("")}
              disabled={savingLeaveApplicable || !leaveApplicableFrom}
            >
              Clear
            </button>
          </div>
        </form>
      </section>

      {/* Logos upload */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold">Company Logos</h3>
            <p className="text-xs text-muted-foreground">
              Upload square and horizontal variants
            </p>
          </div>
        </div>

        <div className="px-6 py-6 space-y-10">
          {/* Square logo */}
          <div className="grid gap-6 md:grid-cols-[auto_1fr] items-start">
            <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-md border border-border bg-bg shadow-sm">
              {squareUrl ? (
                <img
                  src={squareUrl}
                  alt="Square logo"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  No square logo
                </span>
              )}
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium">Square Logo (1:1)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setSquareFile(e.target.files?.[0] || null)}
                className="block text-sm"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={uploadSquare}
                  disabled={uploadingSquare || !squareFile}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
                >
                  {uploadingSquare ? "Uploading…" : "Upload"}
                </button>
                <p className="text-xs text-muted-foreground">
                  PNG/JPG • ≤10MB • 256×256+ recommended
                </p>
              </div>
            </div>
          </div>

          {/* Horizontal logo */}
          <div className="grid gap-6 md:grid-cols-[auto_1fr] items-start">
            <div className="flex h-20 w-52 items-center justify-center overflow-hidden rounded-md border border-border bg-bg shadow-sm">
              {wideUrl ? (
                <img
                  src={wideUrl}
                  alt="Horizontal logo"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  No horizontal logo
                </span>
              )}
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium">
                Horizontal Logo (wide)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setWideFile(e.target.files?.[0] || null)}
                className="block text-sm"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={uploadHorizontal}
                  disabled={uploadingWide || !wideFile}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
                >
                  {uploadingWide ? "Uploading…" : "Upload"}
                </button>
                <p className="text-xs text-muted-foreground">
                  PNG/JPG • ≤10MB • 512×128+ recommended
                </p>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            If a variant is missing, the app will use the available logo or
            default.
          </p>
        </div>
      </section>

      {/* SMTP settings */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold">SMTP Settings</h3>
            <p className="text-xs text-muted-foreground">
              Deliver company emails with your own SMTP credentials.
            </p>
          </div>
        </div>
        <form
          onSubmit={handleSubmitSmtp(onSaveSmtp)}
          className="px-6 py-5 space-y-5"
        >
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" {...registerSmtp("enabled")} />
            <span>Enable custom SMTP for this company</span>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="SMTP Host" required={smtpValues.enabled}>
              <input
                type="text"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="smtp.example.com"
                disabled={!smtpValues.enabled}
                {...registerSmtp("host")}
              />
              {smtpErrors.host && (
                <p className="mt-1 text-xs text-error">
                  {smtpErrors.host.message}
                </p>
              )}
            </Field>
            <Field label="SMTP Port">
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                disabled={!smtpValues.enabled}
                {...registerSmtp("port", { valueAsNumber: true })}
              />
              {smtpErrors.port && (
                <p className="mt-1 text-xs text-error">
                  {smtpErrors.port.message}
                </p>
              )}
            </Field>
            <Field label="SMTP User">
              <input
                type="text"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                disabled={!smtpValues.enabled}
                {...registerSmtp("user")}
              />
              {smtpErrors.user && (
                <p className="mt-1 text-xs text-error">
                  {smtpErrors.user.message}
                </p>
              )}
            </Field>
            <Field label="From Address">
              <input
                type="text"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="HRMS <no-reply@company.com>"
                disabled={!smtpValues.enabled}
                {...registerSmtp("from")}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Optional display name and email shown to recipients.
              </p>
              {smtpErrors.from && (
                <p className="mt-1 text-xs text-error">
                  {smtpErrors.from.message}
                </p>
              )}
            </Field>
            <Field label="Reply-to Address">
              <input
                type="text"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="support@company.com"
                disabled={!smtpValues.enabled}
                {...registerSmtp("replyTo")}
              />
              {smtpErrors.replyTo && (
                <p className="mt-1 text-xs text-error">
                  {smtpErrors.replyTo.message}
                </p>
              )}
            </Field>
          </div>

          <div className="space-y-1 text-sm">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                {...registerSmtp("secure")}
                disabled={!smtpValues.enabled}
              />
              <span>Use secure connection (TLS/SSL)</span>
            </label>
            <p className="text-xs text-muted-foreground">
              Port 465 typically requires SSL. Ports 587/25 usually use
              STARTTLS.
            </p>
          </div>

          <Field label="SMTP Password">
            <div className="space-y-2">
              <input
                type="password"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder={
                  smtpPasswordSet && !clearSmtpPassword
                    ? "Leave blank to keep existing"
                    : ""
                }
                disabled={!smtpValues.enabled || clearSmtpPassword}
                {...registerSmtp("password")}
              />
              {smtpPasswordSet && !clearSmtpPassword && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Password is stored securely.</span>
                  <button
                    type="button"
                    className="text-primary underline"
                    onClick={() => {
                      setClearSmtpPassword(true);
                      setSmtpValue("password", "");
                    }}
                  >
                    Clear password
                  </button>
                </div>
              )}
              {clearSmtpPassword && (
                <div className="flex items-center justify-between text-xs text-amber-600">
                  <span>Password will be removed on save.</span>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setClearSmtpPassword(false)}
                  >
                    Undo
                  </button>
                </div>
              )}
              {smtpErrors.password && (
                <p className="mt-1 text-xs text-error">
                  {smtpErrors.password.message}
                </p>
              )}
            </div>
          </Field>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-xs text-muted-foreground">
              {smtpValues.enabled
                ? "Automated emails for this company will use these credentials."
                : "When disabled, the platform-level SMTP configuration is used."}
            </p>
            <button
              type="submit"
              disabled={savingSmtp}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {savingSmtp ? "Saving..." : "Save SMTP"}
            </button>
          </div>
        </form>
      </section>

      {/* Theme customization */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Theme Colors</h3>
          <span className="text-xs text-muted-foreground">
            Company-specific
          </span>
        </div>

        <form
          onSubmit={handleSubmitTheme(onSaveTheme)}
          className="px-6 py-5 space-y-5"
        >
          <div className="grid gap-6 md:grid-cols-3">
            {(
              [
                "primary",
                "secondary",
                "accent",
                "success",
                "warning",
                "error",
              ] as const
            ).map((key) => (
              <div key={key} className="space-y-2">
                <label className="text-sm font-medium capitalize">{key}</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    className="h-10 w-16 rounded-md border border-border bg-surface cursor-pointer"
                    aria-label={`${key} color`}
                    {...registerTheme(key)}
                  />
                  <input
                    type="text"
                    className="flex-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm"
                    placeholder="#000000"
                    {...registerTheme(key)}
                  />
                </div>
                {themeErrors[key] && (
                  <p className="text-xs text-error mt-1">
                    {themeErrors[key]?.message as string}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={savingTheme}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {savingTheme ? "Saving…" : "Save Theme"}
            </button>
            <button
              type="button"
              onClick={onResetTheme}
              disabled={savingTheme}
              className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-[color:rgb(var(--color-text))] disabled:opacity-60"
            >
              Reset to Default
            </button>
            <span className="text-xs text-muted-foreground">
              Changes apply immediately in this session.
            </span>
          </div>
        </form>
      </section>
    </div>
  );
}
