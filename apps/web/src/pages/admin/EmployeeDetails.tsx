import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RoleDefinition } from "../../types/roles";

type Employee = {
  id: string;
  name: string;
  email: string;
  dob?: string;
  documents: string[];
  reportingPerson?: { id: string; name: string } | null;
  reportingPersons?: { id: string; name: string }[];
  subRoles: string[];
  address?: string;
  phone?: string;
  personalEmail?: string;
  bloodGroup?: string;
  joiningDate?: string;
  employeeId?: string;
  ctc?: number;
  aadharNumber?: string;
  panNumber?: string;
  bankDetails?: { accountNumber?: string; bankName?: string; ifsc?: string };
  leaveBalances?: {
    paid?: number;
    casual?: number;
    sick?: number;
    unpaid?: number;
  };
  totalLeaveAvailable?: number;
  employmentStatus?: "PERMANENT" | "PROBATION";
  probationSince?: string | null;
};

const BLOOD_GROUP_OPTIONS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;

const detailsSchema = z.object({
  phone: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? "")
    .refine((v) => v === "" || /^\d{10}$/.test(v), {
      message: "Phone must be exactly 10 digits",
    }),
  dob: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? "")
    .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), {
      message: "Invalid date",
    }),
  email: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? "")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "Invalid email",
    }),
  personalEmail: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? "")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "Invalid personal email",
    }),
  address: z
    .string()
    .optional()
    .transform((v) => v ?? ""),
  joiningDate: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? "")
    .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), {
      message: "Invalid date",
    }),
  bloodGroup: z
    .string()
    .optional()
    .transform((v) => v ?? "")
    .refine(
      (v) => v === "" || (BLOOD_GROUP_OPTIONS as readonly string[]).includes(v),
      {
        message: "Invalid blood group",
      }
    ),
  aadharNumber: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? "")
    .refine((v) => v === "" || /^[0-9]{8,16}$/.test(v), {
      message: "Aadhar should be 8–16 digits",
    }),
  panNumber: z
    .string()
    .optional()
    .transform((v) => v?.trim().toUpperCase() ?? "")
    .refine((v) => v === "" || /^[A-Z0-9]{8,20}$/.test(v), {
      message: "PAN should be 8–20 alphanumerics",
    }),
  bankAcc: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? ""),
  bankName: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? ""),
  ifsc: z
    .string()
    .optional()
    .transform((v) => v?.trim().toUpperCase() ?? "")
    .refine(
      (v) => v === "" || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v) || v.length === 0,
      { message: "Invalid IFSC" }
    ),
  ctc: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? 0 : Number(v)),
    z.number().min(0, "CTC must be ≥ 0")
  ),
});

type DetailsForm = z.infer<typeof detailsSchema>;

export default function EmployeeDetails() {
  const { id } = useParams();
  const nav = useNavigate();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<{
    workedDays: number;
    leaveDays: number;
  } | null>(null);
  const [rLoading, setRLoading] = useState(false);
  const [rErr, setRErr] = useState<string | null>(null);

  const [employees, setEmployees] = useState<{ id: string; name: string }[]>(
    []
  );
  const [reportingPersons, setReportingPersons] = useState<string[]>([]);
  const [uLoading, setULoading] = useState(false);
  const [uErr, setUErr] = useState<string | null>(null);
  const [uOk, setUOk] = useState<string | null>(null);

  const [role, setRole] = useState("");
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleErr, setRoleErr] = useState<string | null>(null);
  const [roleOk, setRoleOk] = useState<string | null>(null);
  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: r.name, label: r.label })),
    [roles]
  );

  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [adjustErr, setAdjustErr] = useState<string | null>(null);
  const [adjustOk, setAdjustOk] = useState<string | null>(null);

  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusOk, setStatusOk] = useState<string | null>(null);

  const [ctcMode, setCtcMode] = useState<"monthly" | "annual">("annual");

  const employmentStatus = employee?.employmentStatus || "PROBATION";
  const isOnProbation = employmentStatus === "PROBATION";
  const probationSinceLabel = (() => {
    if (!employee?.probationSince) return "—";
    const d = new Date(employee.probationSince);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString();
  })();

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(detailsSchema),
    mode: "onChange",
    defaultValues: {
      phone: "",
      dob: "",
      email: "",
      personalEmail: "",
      address: "",
      joiningDate: "",
      bloodGroup: "",
      aadharNumber: "",
      panNumber: "",
      bankAcc: "",
      bankName: "",
      ifsc: "",
      ctc: 0,
    },
  });

  const formValues = watch();

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await api.get(`/documents/${id}`);
        const e: Employee = res.data.employee;
        setEmployee(e);
        const initialReporting = e?.reportingPersons?.length
          ? e.reportingPersons.map((rp) => rp.id)
          : e?.reportingPerson?.id
          ? [e.reportingPerson.id]
          : [];
        setReportingPersons(initialReporting);
        setRole(e?.subRoles?.[0] || "");
        setStatusErr(null);
        setStatusOk(null);

        reset({
          phone: e.phone || "",
          dob: e.dob ? String(e.dob).slice(0, 10) : "",
          email: e.email || "",
          personalEmail: e.personalEmail || "",
          address: e.address || "",
          joiningDate: e.joiningDate ? String(e.joiningDate).slice(0, 10) : "",
          bloodGroup: e.bloodGroup || "",
          aadharNumber: e.aadharNumber || "",
          panNumber: e.panNumber || "",
          bankAcc: e.bankDetails?.accountNumber || "",
          bankName: e.bankDetails?.bankName || "",
          ifsc: e.bankDetails?.ifsc || "",
          ctc: Number.isFinite(e.ctc) ? e.ctc! : 0, // backend monthly
        });
        setCtcMode("monthly");
      } catch (e: any) {
        const msg = e?.response?.data?.error || "Failed to load employee";
        setErr(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, reset]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/employees");
        setEmployees(res.data.employees || []);
      } catch {}
      try {
        const r = await api.get("/companies/roles");
        const defs: RoleDefinition[] = r.data.roles || [];
        setRoles(defs);
        if (!role) {
          const fallback =
            defs.find((item) => !item.system)?.name || defs[0]?.name || "";
          if (fallback) setRole(fallback);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    async function loadReport() {
      if (!id) return;
      try {
        setRLoading(true);
        const res = await api.get(`/attendance/report/${id}`, {
          params: { month },
        });
        setReport(res.data.report);
      } catch (e: any) {
        setRErr(e?.response?.data?.error || "Failed to load report");
      } finally {
        setRLoading(false);
      }
    }
    loadReport();
  }, [id, month]);

  useEffect(() => {
    if (!role && roleOptions.length) {
      const fallback =
        roleOptions.find((opt) => {
          const meta = roles.find((r) => r.name === opt.value);
          return meta ? !meta.system : false;
        })?.value || roleOptions[0]?.value || "";
      if (fallback) setRole(fallback);
    }
  }, [role, roleOptions, roles]);

  async function updateReporting(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    try {
      setULoading(true);
      setUErr(null);
      setUOk(null);
      const res = await api.put(`/companies/employees/${id}/reporting`, {
        reportingPersons,
      });
      const serverReporting = res?.data?.employee?.reportingPersons;
      let updated: { id: string; name: string }[] = Array.isArray(
        serverReporting
      )
        ? serverReporting
        : [];
      if (serverReporting === undefined) {
        updated = reportingPersons.length
          ? employees
              .filter((emp) => reportingPersons.includes(emp.id))
              .map((emp) => ({ id: emp.id, name: emp.name }))
          : [];
      }
      setReportingPersons(
        updated.length ? updated.map((rp) => rp.id) : []
      );
      setEmployee((prev) =>
        prev
          ? {
              ...prev,
              reportingPersons: updated,
              reportingPerson: updated[0] || null,
            }
          : prev
      );
      setUOk("Reporting persons updated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update";
      setUErr(msg);
      toast.error(msg);
    } finally {
      setULoading(false);
    }
  }

  async function updateRole(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    try {
      setRoleLoading(true);
      setRoleErr(null);
      setRoleOk(null);
      await api.put(`/companies/employees/${id}/role`, { role });
      setRoleOk("Role updated");
      setEmployee((prev) => (prev ? { ...prev, subRoles: [role] } : prev));
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update role";
      setRoleErr(msg);
      toast.error(msg);
    } finally {
      setRoleLoading(false);
    }
  }

  async function adjustLeaveBalance(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    const trimmed = adjustAmount.trim();
    if (!trimmed) {
      setAdjustErr("Enter an amount to adjust");
      setAdjustOk(null);
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setAdjustErr("Amount must be a number (use negative to deduct)");
      setAdjustOk(null);
      return;
    }
    try {
      setAdjustLoading(true);
      setAdjustErr(null);
      setAdjustOk(null);
      const res = await api.post(`/companies/employees/${id}/leave-adjust`, {
        amount: value,
      });
      const updated = res.data?.employee || {};
      setEmployee((prev) =>
        prev
          ? {
              ...prev,
              totalLeaveAvailable:
                updated.totalLeaveAvailable ?? prev.totalLeaveAvailable,
              leaveBalances: {
                paid:
                  updated.leaveBalances?.paid ?? prev.leaveBalances?.paid ?? 0,
                casual:
                  updated.leaveBalances?.casual ??
                  prev.leaveBalances?.casual ??
                  0,
                sick:
                  updated.leaveBalances?.sick ?? prev.leaveBalances?.sick ?? 0,
                unpaid:
                  updated.leaveBalances?.unpaid ??
                  prev.leaveBalances?.unpaid ??
                  0,
              },
            }
          : prev
      );
      const abs = Math.abs(value);
      const suffix = abs === 1 ? " leave" : " leaves";
      setAdjustOk(
        value >= 0 ? `Added ${abs}${suffix}` : `Deducted ${abs}${suffix}`
      );
      setAdjustAmount("");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to adjust leave balance";
      setAdjustErr(msg);
      toast.error(msg);
    } finally {
      setAdjustLoading(false);
    }
  }

  async function changeEmploymentStatus(
    next: "PERMANENT" | "PROBATION"
  ) {
    if (!id) return;
    try {
      setStatusUpdating(true);
      setStatusErr(null);
      setStatusOk(null);
      const res = await api.put(`/companies/employees/${id}/probation`, {
        status: next,
      });
      const payload = res.data?.employee;
      setEmployee((prev) =>
        prev
          ? {
              ...prev,
              employmentStatus:
                (payload?.employmentStatus as Employee["employmentStatus"]) ||
                next,
              probationSince: payload?.probationSince || null,
              totalLeaveAvailable:
                payload?.totalLeaveAvailable ?? prev.totalLeaveAvailable,
              leaveBalances: payload?.leaveBalances || prev.leaveBalances,
            }
          : prev
      );
      setStatusOk(
        next === "PROBATION"
          ? "Employee marked as probation"
          : "Employee marked permanent"
      );
      toast.success(
        next === "PROBATION"
          ? "Employee moved to probation"
          : "Employee is now permanent"
      );
    } catch (e: any) {
      const msg =
        e?.response?.data?.error || "Failed to update employment status";
      setStatusErr(msg);
      toast.error(msg);
    } finally {
      setStatusUpdating(false);
    }
  }

  async function onSaveDetails(values: DetailsForm) {
    if (!id) return;
    try {
      const monthlyCtc =
        ctcMode === "annual"
          ? Number(values.ctc || 0) / 12
          : Number(values.ctc || 0);
      const payload = {
        address: values.address || undefined,
        phone: values.phone || undefined,
        dob: values.dob || undefined,
        joiningDate: values.joiningDate || undefined,
        email: values.email || undefined,
        personalEmail: values.personalEmail || undefined,
        bloodGroup: values.bloodGroup || undefined,
        ctc: monthlyCtc,
        aadharNumber: values.aadharNumber || undefined,
        panNumber: values.panNumber || undefined,
        bankDetails: {
          accountNumber: values.bankAcc || "",
          bankName: values.bankName || "",
          ifsc: values.ifsc || "",
        },
      };
      await api.put(`/companies/employees/${id}`, payload);
      setEmployee((prev) =>
        prev
          ? {
              ...prev,
              address: payload.address,
              phone: payload.phone,
              dob: payload.dob,
              joiningDate: payload.joiningDate,
              email: payload.email ?? prev.email,
              personalEmail: payload.personalEmail,
              bloodGroup: payload.bloodGroup,
              ctc: monthlyCtc,
              aadharNumber: payload.aadharNumber,
              panNumber: payload.panNumber,
              bankDetails: payload.bankDetails,
            }
          : prev
      );
      toast.success("Details updated");
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to save details");
    }
  }

  async function deleteEmployee() {
    if (!id) return;
    const yes = window.confirm(
      "Delete this employee? This cannot be undone and may be blocked if they have linked data."
    );
    if (!yes) return;
    try {
      await api.delete(`/companies/employees/${id}`);
      nav("/admin/employees");
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to delete employee");
    }
  }

  const base = import.meta.env.VITE_API_URL || "http://localhost:4000";

  if (loading) return <div>Loading…</div>;
  if (err) return <div className="text-error">{err}</div>;
  if (!employee) return <div>Not found</div>;

  const joiningDateLabel =
    employee.joiningDate &&
    !Number.isNaN(new Date(employee.joiningDate).getTime())
      ? new Date(employee.joiningDate).toLocaleDateString()
      : "";
  const leaveBalances = {
    paid: employee.leaveBalances?.paid ?? 0,
    casual: employee.leaveBalances?.casual ?? 0,
    sick: employee.leaveBalances?.sick ?? 0,
    unpaid: employee.leaveBalances?.unpaid ?? 0,
  };
  const totalLeaveBalance = employee.totalLeaveAvailable ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{employee?.name}</h2>
          <div className="text-sm text-muted">{employee?.email}</div>
          {/* {employee?.employeeId && (
            <div className="text-xs text-muted mt-1">
              Employee ID: {employee?.employeeId}
            </div>
          )}
          {employee?.personalEmail && (
            <div className="text-xs text-muted mt-1">
              Personal Email: {employee.personalEmail}
            </div>
          )}
          {joiningDateLabel && (
            <div className="text-xs text-muted mt-1">
              Joining Date: {joiningDateLabel}
            </div>
          )}
          {employee?.bloodGroup && (
            <div className="text-xs text-muted mt-1">
              Blood Group: {employee.bloodGroup}
            </div>
          )} */}
        </div>
        {/* <button
          onClick={deleteEmployee}
          className="h-9 px-3 rounded-md border border-error text-error hover:bg-error/10"
        >
          Delete Employee
        </button> */}
      </div>

      {/* Personal & Job Details (order adjusted: phone, dob → email, personal email → others) */}
      <form
        onSubmit={handleSubmit(onSaveDetails)}
        className="space-y-4 bg-surface border border-border rounded-md p-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Personal & Job Details</h3>
          <div className="text-xs text-muted">
            {isDirty ? "Unsaved changes" : ""}
          </div>
        </div>

        {/* Row 1: Phone, DOB */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Phone</label>
            <input
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.phone ? "border-error" : "border-border"
              }`}
              placeholder="10-digit number"
              {...register("phone")}
            />
            {errors.phone && (
              <p className="text-xs text-error">{errors.phone.message}</p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1">Date of Birth</label>
            <input
              type="date"
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.dob ? "border-error" : "border-border"
              }`}
              {...register("dob")}
            />
            {errors.dob && (
              <p className="text-xs text-error">{errors.dob.message}</p>
            )}
          </div>
        </div>

        {/* Row 2: Work Email, Personal Email */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Work Email</label>
            <input
              type="email"
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.email ? "border-error" : "border-border"
              }`}
              placeholder="name@company.com"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-xs text-error">{errors.email.message}</p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1">Personal Email</label>
            <input
              type="email"
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.personalEmail ? "border-error" : "border-border"
              }`}
              placeholder="name@gmail.com"
              {...register("personalEmail")}
            />
            {errors.personalEmail && (
              <p className="text-xs text-error">
                {errors.personalEmail.message}
              </p>
            )}
          </div>
        </div>

        {/* Others */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Address</label>
            <input
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.address ? "border-error" : "border-border"
              }`}
              {...register("address")}
            />
            {errors.address && (
              <p className="text-xs text-error">{errors.address.message}</p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1">Joining Date</label>
            <input
              type="date"
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.joiningDate ? "border-error" : "border-border"
              }`}
              {...register("joiningDate")}
            />
            {errors.joiningDate && (
              <p className="text-xs text-error">{errors.joiningDate.message}</p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1">Blood Group</label>
            <Controller
              control={control}
              name="bloodGroup"
              render={({ field }) => (
                <select
                  className={`w-full h-10 rounded border px-3 bg-bg ${
                    errors.bloodGroup ? "border-error" : "border-border"
                  }`}
                  {...field}
                >
                  <option value="">Select</option>
                  {BLOOD_GROUP_OPTIONS.map((bg) => (
                    <option key={bg} value={bg}>
                      {bg}
                    </option>
                  ))}
                </select>
              )}
            />
            {errors.bloodGroup && (
              <p className="text-xs text-error">{errors.bloodGroup.message}</p>
            )}
          </div>

          {/* CTC + Mode */}
          <div>
            <label className="block text-sm mb-1">CTC</label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                type="number"
                step="0.01"
                className={`w-full h-10 rounded border px-3 bg-bg ${
                  errors.ctc ? "border-error" : "border-border"
                }`}
                placeholder={
                  ctcMode === "annual" ? "Annual CTC" : "Monthly CTC"
                }
                {...register("ctc")}
              />
              <select
                className="h-10 rounded border border-border bg-bg px-2"
                value={ctcMode}
                onChange={(e) => {
                  const next = e.target.value as "monthly" | "annual";
                  const n = Number(formValues.ctc || 0);
                  if (Number.isFinite(n)) {
                    if (ctcMode === "monthly" && next === "annual") {
                      // push converted value into RHF
                      const val = (n * 12).toFixed(2);
                      (document.activeElement as HTMLElement)?.blur();
                      // quick set via reset to preserve other values
                      reset(
                        { ...formValues, ctc: Number(val) },
                        { keepDirty: true }
                      );
                    }
                    if (ctcMode === "annual" && next === "monthly") {
                      const val = (n / 12).toFixed(2);
                      (document.activeElement as HTMLElement)?.blur();
                      reset(
                        { ...formValues, ctc: Number(val) },
                        { keepDirty: true }
                      );
                    }
                  }
                  setCtcMode(next);
                }}
              >
                <option value="annual">Per Annum</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {errors.ctc && (
              <p className="text-xs text-error">
                {errors.ctc.message as string}
              </p>
            )}
            {formValues.ctc !== undefined && (
              <div className="text-xs text-muted mt-1">
                {ctcMode === "annual"
                  ? `≈ Monthly: ${((Number(formValues.ctc) || 0) / 12).toFixed(
                      2
                    )}`
                  : `≈ Annual: ${(Number(formValues.ctc) * 12 || 0).toFixed(
                      2
                    )}`}
              </div>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm mb-1">Aadhar Number</label>
            <input
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.aadharNumber ? "border-error" : "border-border"
              }`}
              {...register("aadharNumber")}
            />
            {errors.aadharNumber && (
              <p className="text-xs text-error">
                {errors.aadharNumber.message}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1">PAN Number</label>
            <input
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.panNumber ? "border-error" : "border-border"
              }`}
              {...register("panNumber")}
            />
            {errors.panNumber && (
              <p className="text-xs text-error">{errors.panNumber.message}</p>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm mb-1">Bank Account</label>
            <input
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.bankAcc ? "border-error" : "border-border"
              }`}
              {...register("bankAcc")}
            />
            {errors.bankAcc && (
              <p className="text-xs text-error">
                {errors.bankAcc.message as string}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1">Bank Name</label>
            <input
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.bankName ? "border-error" : "border-border"
              }`}
              {...register("bankName")}
            />
            {errors.bankName && (
              <p className="text-xs text-error">
                {errors.bankName.message as string}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1">IFSC</label>
            <input
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.ifsc ? "border-error" : "border-border"
              }`}
              {...register("ifsc")}
            />
            {errors.ifsc && (
              <p className="text-xs text-error">{errors.ifsc.message}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-white disabled:opacity-50"
          >
            {isSubmitting ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>

      <section className="space-y-4 bg-surface border border-border rounded-md p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">Employment Status</h3>
          {statusErr && <div className="text-sm text-error">{statusErr}</div>}
          {statusOk && <div className="text-sm text-success">{statusOk}</div>}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-border/60 bg-muted/10 p-4 space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted">
              Current Status
            </div>
            <div className="text-2xl font-semibold">
              {isOnProbation ? "Probation" : "Permanent"}
            </div>
            <div className="text-sm text-muted">
              Probation since: {probationSinceLabel}
            </div>
          </div>
          <div className="rounded-md border border-border/60 bg-bg p-4 space-y-3 text-sm">
            <p>
              Toggle between permanent and probation to adjust the accrual rate
              applied to this employee. Changes take effect immediately for
              future accruals.
            </p>
            <button
              type="button"
              disabled={statusUpdating}
              onClick={() =>
                changeEmploymentStatus(isOnProbation ? "PERMANENT" : "PROBATION")
              }
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white text-sm font-medium disabled:opacity-60"
            >
              {statusUpdating
                ? "Updating…"
                : isOnProbation
                ? "Mark as Permanent"
                : "Set to Probation"}
            </button>
          </div>
        </div>
      </section>

      {/* Leave Balance */}
      <section className="space-y-4 bg-surface border border-border rounded-md p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Leave Balance</h3>
          {adjustErr && <div className="text-sm text-error">{adjustErr}</div>}
          {adjustOk && <div className="text-sm text-success">{adjustOk}</div>}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-border/60 bg-muted/10 p-4">
            <div className="text-xs uppercase tracking-wide text-muted">
              Total Available
            </div>
            <div className="text-3xl font-semibold mt-1">
              {totalLeaveBalance}
            </div>
            {totalLeaveBalance < 0 && (
              <div className="text-xs text-error mt-2">
                Negative balance indicates overuse.
              </div>
            )}
          </div>
          <div className="rounded-md border border-border/60 bg-bg p-4 text-sm space-y-2">
            <div className="flex items-center justify-between">
              <span>Paid remaining</span>
              <span>{leaveBalances.paid}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Casual remaining</span>
              <span>{leaveBalances.casual}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Sick remaining</span>
              <span>{leaveBalances.sick}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted pt-2 border-t border-border/40">
              <span>Unpaid taken</span>
              <span>{leaveBalances.unpaid}</span>
            </div>
          </div>
        </div>
        <form
          onSubmit={adjustLeaveBalance}
          className="flex flex-wrap items-center gap-3"
        >
          <input
            type="number"
            step="0.5"
            className="h-10 rounded-md border border-border bg-bg px-3"
            placeholder="e.g. 2 or -1.5"
            value={adjustAmount}
            onChange={(e) => {
              setAdjustAmount(e.target.value);
              if (adjustErr) setAdjustErr(null);
              if (adjustOk) setAdjustOk(null);
            }}
          />
          <button
            type="submit"
            disabled={adjustLoading}
            className="inline-flex items-center justify-center h-10 rounded-md bg-primary px-4 text-white disabled:opacity-60"
          >
            {adjustLoading ? "Updating…" : "Apply"}
          </button>
          <button
            type="button"
            onClick={() => setAdjustAmount("")}
            disabled={adjustLoading || !adjustAmount}
            className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50"
          >
            Clear
          </button>
        </form>
        <div className="text-xs text-muted">
          Use positive to credit, negative to deduct.
        </div>
      </section>

      {/* Role */}
      <section className="space-y-3 bg-surface border border-border rounded-md p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Role</h3>
          {roleErr && <div className="text-sm text-error">{roleErr}</div>}
          {roleOk && <div className="text-sm text-success">{roleOk}</div>}
        </div>
        <form onSubmit={updateRole} className="flex items-center gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-md border border-border bg-bg px-3 h-10 outline-none focus:ring-2 focus:ring-primary"
          >
            {roleOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={roleLoading}
            className="rounded-md bg-primary px-4 h-10 text-white disabled:opacity-50"
          >
            {roleLoading ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      {/* Reporting Persons */}
      <section className="space-y-3 bg-surface border border-border rounded-md p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Reporting Persons</h3>
          {uErr && <div className="text-sm text-error">{uErr}</div>}
          {uOk && <div className="text-sm text-success">{uOk}</div>}
        </div>
        <form onSubmit={updateReporting} className="flex items-center gap-2">
          <select
            multiple
            value={reportingPersons}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions).map(
                (opt) => opt.value
              );
              setReportingPersons(selected);
            }}
            className="rounded-md border border-border bg-bg px-3 py-2 min-h-[2.5rem] outline-none focus:ring-2 focus:ring-primary"
          >
            {employees
              .filter((e) => e.id !== id)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={() => setReportingPersons([])}
            className="h-10 rounded-md border border-border px-3 text-sm"
            disabled={uLoading || reportingPersons.length === 0}
          >
            Clear
          </button>
          <button
            type="submit"
            disabled={uLoading}
            className="rounded-md bg-primary px-4 h-10 text-white disabled:opacity-50"
          >
            {uLoading ? "Saving…" : "Save"}
          </button>
        </form>
        <p className="text-xs text-muted">
          Hold Ctrl (or Cmd on Mac) to select multiple managers.
        </p>
      </section>

      {/* Documents */}
      <section className="bg-surface border border-border rounded-md p-4">
        <h3 className="font-semibold mb-2">Documents</h3>
        {employee?.documents?.length === 0 ? (
          <div className="text-sm text-muted">No documents uploaded.</div>
        ) : (
          <ul className="list-disc pl-6 space-y-1">
            {employee?.documents?.map((d) => (
              <li key={d}>
                <a
                  href={`${base}/uploads/${d}`}
                  target="_blank"
                  className="text-primary underline"
                >
                  {d}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Monthly report */}
      <section className="space-y-3 bg-surface border border-border rounded-md p-4">
        <h3 className="font-semibold">Monthly Report</h3>
        {rErr && <div className="text-sm text-error">{rErr}</div>}
        <div className="flex items-center gap-4">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border border-border bg-bg px-3 h-10 outline-none focus:ring-2 focus:ring-primary"
          />
          {rLoading && <div className="text-sm text-muted">Loading…</div>}
        </div>
        {report && !rLoading && (
          <div className="text-sm">
            Worked Days: {report.workedDays}, Leave Days: {report.leaveDays}
          </div>
        )}
      </section>
    </div>
  );
}
