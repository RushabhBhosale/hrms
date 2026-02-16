import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { resolveMediaUrl } from "../../lib/utils";
import { toast } from "react-hot-toast";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import ReportingPersonMultiSelect from "../../components/ReportingPersonMultiSelect";
import type { RoleDefinition } from "../../types/roles";
import { getEmployee } from "../../lib/auth";
import { confirmToast } from "../../lib/confirmToast";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Calendar } from "../../components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";

type Employee = {
  id: string;
  name: string;
  email: string;
  isDeleted?: boolean;
  isActive?: boolean;
  offboarding?: {
    lastWorkingDay?: string | null;
    reason?: string | null;
    note?: string | null;
    recordedBy?: { id: string; name?: string } | string | null;
    recordedAt?: string | null;
  } | null;
  hasTds?: boolean;
  profileImage?: string | null;
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
  attendanceStartDate?: string;
  employeeId?: string;
  ctc?: number;
  aadharNumber?: string;
  panNumber?: string;
  uan?: string;
  bankDetails?: { accountNumber?: string; bankName?: string; ifsc?: string };
  leaveBalances?: {
    paid?: number;
    casual?: number;
    sick?: number;
    unpaid?: number;
  };
  leaveUsage?: {
    paid?: number;
    casual?: number;
    sick?: number;
    unpaid?: number;
  };
  totalLeaveAvailable?: number;
  employmentStatus?: "PERMANENT" | "PROBATION";
  probationSince?: string | null;
};

type InventoryItem = {
  _id?: string;
  id?: string;
  name: string;
  category?: string;
  cost?: number;
  status?: "AVAILABLE" | "ASSIGNED" | "REPAIR" | "RETIRED";
  assignedTo?: { id?: string; _id?: string; name: string; email?: string };
  purchaseDate?: string;
  notes?: string;
};

type LeaveCaps = {
  paid: number | null;
  casual: number | null;
  sick: number | null;
  totalAnnual: number | null;
  ratePerMonth: number | null;
  applicableFrom: string | null;
};

function startOfUtcMonth(date: Date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(1);
  return d;
}

function parseApplicableMonth(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

function monthsInclusive(start: Date, end: Date) {
  const diff =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  return diff >= 0 ? diff + 1 : 0;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function parseInputDate(value?: string | null) {
  if (!value) return undefined;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3) return undefined;
  const [year, month, day] = parts;
  if (!year || !month || !day) return undefined;
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return undefined;
  }
  return parsed;
}

function formatInputDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computeProratedAnnual({
  joiningDate,
  policyStart,
  totalAnnual,
  ratePerMonth,
}: {
  joiningDate?: string;
  policyStart: Date | null;
  totalAnnual: number | null;
  ratePerMonth: number | null;
}) {
  if (typeof totalAnnual !== "number" || totalAnnual <= 0) return null;
  if (!policyStart || typeof ratePerMonth !== "number" || ratePerMonth <= 0) {
    return totalAnnual;
  }
  if (!joiningDate) return totalAnnual;
  const join = new Date(joiningDate);
  if (Number.isNaN(join.getTime())) return totalAnnual;
  const joinMonth = startOfUtcMonth(join);
  const fyStart = startOfUtcMonth(policyStart);
  if (joinMonth <= fyStart) return totalAnnual as number;
  const fyEnd = new Date(
    Date.UTC(fyStart.getUTCFullYear() + 1, fyStart.getUTCMonth() - 1, 1),
  );
  if (joinMonth > fyEnd) return 0;
  const months = monthsInclusive(joinMonth, fyEnd);
  const prorated = Math.min(totalAnnual, ratePerMonth * months);
  return Math.max(0, prorated);
}

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

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const OFFBOARDING_REASONS = [
  { value: "resignation", label: "Resignation" },
  { value: "termination", label: "Termination" },
  { value: "layoff", label: "Layoff" },
  { value: "contract_end", label: "Contract ended" },
  { value: "absconded", label: "Absconded" },
  { value: "other", label: "Other" },
] as const;

const detailsSchema = z.object({
  employeeId: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? ""),
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
  attendanceStartDate: z
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
      },
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
  uan: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? "")
    .refine((v) => v === "" || /^[0-9]{12}$/.test(v), {
      message: "UAN should be 12 digits",
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
      { message: "Invalid IFSC" },
    ),
  ctc: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? 0 : Number(v)),
    z.number().min(0, "CTC must be ≥ 0"),
  ),
  hasTds: z.boolean().optional(),
  offboardingNote: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? ""),
  offboardingReason: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? ""),
  offboardingLastDay: z
    .string()
    .optional()
    .transform((v) => v?.trim() ?? "")
    .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), {
      message: "Invalid last working day",
    }),
});

type DetailsForm = z.infer<typeof detailsSchema>;

export default function EmployeeDetails() {
  const { id } = useParams();
  const nav = useNavigate();
  const viewer = getEmployee();
  const canDeleteEmployee =
    viewer?.primaryRole === "ADMIN" || viewer?.primaryRole === "SUPERADMIN";

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<{
    workedDays: number;
    leaveDays: number;
    halfDayLeaves?: number;
  } | null>(null);
  const [rLoading, setRLoading] = useState(false);
  const [rErr, setRErr] = useState<string | null>(null);

  const [employees, setEmployees] = useState<
    { id: string; name: string; employeeId?: string }[]
  >([]);
  const [reportingPersons, setReportingPersons] = useState<string[]>([]);
  const [uLoading, setULoading] = useState(false);
  const [uErr, setUErr] = useState<string | null>(null);
  const [uOk, setUOk] = useState<string | null>(null);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryErr, setInventoryErr] = useState<string | null>(null);

  const [role, setRole] = useState("");
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleErr, setRoleErr] = useState<string | null>(null);
  const [roleOk, setRoleOk] = useState<string | null>(null);
  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: r.name, label: r.label })),
    [roles],
  );
  const [leaveCaps, setLeaveCaps] = useState<LeaveCaps>({
    paid: null,
    casual: null,
    sick: null,
    totalAnnual: null,
    ratePerMonth: null,
    applicableFrom: null,
  });

  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [adjustErr, setAdjustErr] = useState<string | null>(null);
  const [adjustOk, setAdjustOk] = useState<string | null>(null);
  const [unpaidTakenInput, setUnpaidTakenInput] = useState("");
  const [unpaidTakenSaving, setUnpaidTakenSaving] = useState(false);
  const [unpaidTakenErr, setUnpaidTakenErr] = useState<string | null>(null);
  const [unpaidTakenOk, setUnpaidTakenOk] = useState<string | null>(null);

  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusOk, setStatusOk] = useState<string | null>(null);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disableReason, setDisableReason] = useState("resignation");
  const [disableLastDay, setDisableLastDay] = useState("");
  const [disableNote, setDisableNote] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disableLoading, setDisableLoading] = useState(false);

  const [ctcMode, setCtcMode] = useState<"monthly" | "annual">("annual");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [photoOk, setPhotoOk] = useState<string | null>(null);
  const [docFiles, setDocFiles] = useState<FileList | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const [docErr, setDocErr] = useState<string | null>(null);
  const [docOk, setDocOk] = useState<string | null>(null);
  const [docInputKey, setDocInputKey] = useState(0);
  const resolveImageUrl = (value?: string | null) => {
    return resolveMediaUrl(value || null);
  };
  const validateImageFile = (file: File | null) => {
    if (!file) return "No file selected";
    if (!file.type.startsWith("image/")) return "Only image files allowed";
    if (file.size > 10 * 1024 * 1024) return "File must be ≤ 10MB";
    return null;
  };

  const employmentStatus = employee?.employmentStatus || "PROBATION";
  const isOnProbation = employmentStatus === "PROBATION";
  const probationSinceLabel = (() => {
    if (!employee?.probationSince) return "—";
    const d = new Date(employee.probationSince);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString();
  })();
  const profileImageUrl = resolveImageUrl(employee?.profileImage || null);

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(detailsSchema),
    mode: "onChange",
    defaultValues: {
      employeeId: "",
      phone: "",
      dob: "",
      email: "",
      personalEmail: "",
      address: "",
      joiningDate: "",
      attendanceStartDate: "",
      bloodGroup: "",
      aadharNumber: "",
      panNumber: "",
      uan: "",
      bankAcc: "",
      bankName: "",
      ifsc: "",
      ctc: 0,
      hasTds: false,
      offboardingNote: "",
      offboardingReason: "",
      offboardingLastDay: "",
    },
  });

  const formValues = watch();
  const joiningDate = watch("joiningDate");
  const attendanceStartDate = watch("attendanceStartDate");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [docRes, listRes] = await Promise.all([
          api.get(`/documents/${id}`),
          api.get("/companies/employees").catch(() => null),
        ]);
        const e: Employee = docRes.data.employee;
        const list = (listRes?.data?.employees as any[]) || [];
        if (Array.isArray(list) && list.length) setEmployees(list);
        const listMatch = list.find(
          (emp: any) => emp?.id === e?.id || emp?.id === id,
        );
        const normalizedEmployeeId =
          e.employeeId ||
          listMatch?.employeeId ||
          (e as any)?.employee_id ||
          (e as any)?.employeeID ||
          (listMatch as any)?.employee_id ||
          (listMatch as any)?.employeeID ||
          "";
        const normalized = { ...e, employeeId: normalizedEmployeeId };
        setEmployee(normalized);
        setUnpaidTakenInput(String(e.leaveBalances?.unpaid ?? 0));
        setUnpaidTakenErr(null);
        setUnpaidTakenOk(null);
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
          employeeId: normalizedEmployeeId || "",
          joiningDate: e.joiningDate ? String(e.joiningDate).slice(0, 10) : "",
          attendanceStartDate: e.attendanceStartDate
            ? String(e.attendanceStartDate).slice(0, 10)
            : e.joiningDate
              ? String(e.joiningDate).slice(0, 10)
              : "",
          bloodGroup: e.bloodGroup || "",
          aadharNumber: e.aadharNumber || "",
          panNumber: e.panNumber || "",
          uan: e.uan || "",
          bankAcc: e.bankDetails?.accountNumber || "",
          bankName: e.bankDetails?.bankName || "",
          ifsc: e.bankDetails?.ifsc || "",
          ctc: Number.isFinite(e.ctc) ? e.ctc! : 0, // backend monthly
          hasTds: !!e.hasTds,
          offboardingNote: e.offboarding?.note || "",
          offboardingReason: e.offboarding?.reason || "",
          offboardingLastDay: e.offboarding?.lastWorkingDay
            ? String(e.offboarding.lastWorkingDay).slice(0, 10)
            : "",
        });
        setCtcMode("monthly");
        setDisableReason(e.offboarding?.reason || "resignation");
        setDisableNote(e.offboarding?.note || "");
        setDisableLastDay(
          e.offboarding?.lastWorkingDay
            ? String(e.offboarding.lastWorkingDay).slice(0, 10)
            : "",
        );
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
    if (!id) return;
    (async () => {
      try {
        setInventoryLoading(true);
        setInventoryErr(null);
        const res = await api.get("/companies/inventory", {
          params: { employeeId: id },
        });
        setInventoryItems(res.data.items || []);
      } catch (e: any) {
        setInventoryErr(
          e?.response?.data?.error || "Failed to load assigned assets",
        );
      } finally {
        setInventoryLoading(false);
      }
    })();
  }, [id]);

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
      try {
        const policyRes = await api.get("/companies/leave-policy");
        const lp = policyRes.data?.leavePolicy || {};
        const caps = lp.typeCaps || {};
        setLeaveCaps({
          paid: typeof caps.paid === "number" ? caps.paid : null,
          casual: typeof caps.casual === "number" ? caps.casual : null,
          sick: typeof caps.sick === "number" ? caps.sick : null,
          totalAnnual:
            typeof lp.totalAnnual === "number" ? lp.totalAnnual : null,
          ratePerMonth:
            typeof lp.ratePerMonth === "number" ? lp.ratePerMonth : null,
          applicableFrom:
            typeof lp.applicableFrom === "string" && lp.applicableFrom.trim()
              ? lp.applicableFrom
              : null,
        });
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
    if (employee?.leaveBalances) {
      setUnpaidTakenInput(String(employee.leaveBalances.unpaid ?? 0));
    }
  }, [employee?.leaveBalances?.unpaid]);

  useEffect(() => {
    if (joiningDate && !attendanceStartDate) {
      setValue("attendanceStartDate", joiningDate, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [attendanceStartDate, joiningDate, setValue]);

  // Backfill employeeId once the employees list arrives (some APIs omit it on /documents/:id)
  useEffect(() => {
    if (!employee || employee.employeeId || !employees.length) return;
    const match = employees.find((emp) => emp.id === employee.id);
    const fallback =
      match?.employeeId ||
      (match as any)?.employee_id ||
      (match as any)?.employeeID ||
      "";
    if (!fallback) return;
    setEmployee((prev) => (prev ? { ...prev, employeeId: fallback } : prev));
    reset(
      (prev) => ({
        ...prev,
        employeeId: fallback,
      }),
      { keepDirty: true },
    );
  }, [employee, employees, reset]);

  useEffect(() => {
    if (!role && roleOptions.length) {
      const fallback =
        roleOptions.find((opt) => {
          const meta = roles.find((r) => r.name === opt.value);
          return meta ? !meta.system : false;
        })?.value ||
        roleOptions[0]?.value ||
        "";
      if (fallback) setRole(fallback);
    }
  }, [role, roleOptions, roles]);

  async function uploadPhoto() {
    if (!id) return;
    setPhotoErr(null);
    setPhotoOk(null);
    const validation = validateImageFile(photoFile);
    if (validation) {
      setPhotoErr(validation);
      toast.error(validation);
      return;
    }
    try {
      setPhotoUploading(true);
      const fd = new FormData();
      fd.append("photo", photoFile as File);
      const res = await api.post(`/companies/employees/${id}/photo`, fd);
      const img = res.data?.profileImage || null;
      setEmployee((prev) => (prev ? { ...prev, profileImage: img } : prev));
      setPhotoFile(null);
      setPhotoOk("Profile photo updated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to upload photo";
      setPhotoErr(msg);
      toast.error(msg);
    } finally {
      setPhotoUploading(false);
    }
  }

  async function uploadDocuments() {
    if (!id) return;
    setDocErr(null);
    setDocOk(null);
    const files = docFiles ? Array.from(docFiles) : [];
    if (!files.length) {
      setDocErr("Select one or more files");
      return;
    }
    try {
      setDocUploading(true);
      const fd = new FormData();
      files.forEach((file) => fd.append("documents", file));
      const res = await api.post(`/documents/${id}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const docs = res.data?.documents || [];
      setEmployee((prev) => (prev ? { ...prev, documents: docs } : prev));
      setDocOk("Documents uploaded");
      setDocFiles(null);
      setDocInputKey((k) => k + 1);
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to upload documents";
      setDocErr(msg);
      toast.error(msg);
    } finally {
      setDocUploading(false);
    }
  }

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
        serverReporting,
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
      setReportingPersons(updated.length ? updated.map((rp) => rp.id) : []);
      setEmployee((prev) =>
        prev
          ? {
              ...prev,
              reportingPersons: updated,
              reportingPerson: updated[0] || null,
            }
          : prev,
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
          : prev,
      );
      const abs = Math.abs(value);
      const suffix = abs === 1 ? " leave" : " leaves";
      setAdjustOk(
        value >= 0 ? `Added ${abs}${suffix}` : `Deducted ${abs}${suffix}`,
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

  async function saveUnpaidTaken() {
    if (!id) return;
    const numeric = Number(unpaidTakenInput || 0);
    if (!Number.isFinite(numeric) || numeric < 0) {
      setUnpaidTakenErr("Enter a non-negative number");
      setUnpaidTakenOk(null);
      return;
    }
    try {
      setUnpaidTakenSaving(true);
      setUnpaidTakenErr(null);
      setUnpaidTakenOk(null);
      const res = await api.post(`/companies/employees/${id}/unpaid-taken`, {
        unpaidTaken: numeric,
      });
      const updated = res.data?.employee || {};
      setEmployee((prev) =>
        prev
          ? {
              ...prev,
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
              leaveUsage: {
                paid:
                  updated.leaveUsage?.paid ??
                  prev.leaveUsage?.paid ??
                  undefined,
                casual:
                  updated.leaveUsage?.casual ??
                  prev.leaveUsage?.casual ??
                  undefined,
                sick:
                  updated.leaveUsage?.sick ??
                  prev.leaveUsage?.sick ??
                  undefined,
                unpaid:
                  updated.leaveUsage?.unpaid ??
                  numeric ??
                  prev.leaveUsage?.unpaid ??
                  0,
              },
            }
          : prev,
      );
      setUnpaidTakenInput(String(numeric));
      setUnpaidTakenOk("Unpaid taken updated");
    } catch (e: any) {
      const msg =
        e?.response?.data?.error || "Failed to update unpaid taken value";
      setUnpaidTakenErr(msg);
      toast.error(msg);
    } finally {
      setUnpaidTakenSaving(false);
    }
  }

  async function changeEmploymentStatus(next: "PERMANENT" | "PROBATION") {
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
          : prev,
      );
      setStatusOk(
        next === "PROBATION"
          ? "Employee marked as probation"
          : "Employee marked permanent",
      );
      toast.success(
        next === "PROBATION"
          ? "Employee moved to probation"
          : "Employee is now permanent",
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
      const normalizedUan = (values.uan || "").replace(/\D/g, "");
      const payload = {
        address: values.address || undefined,
        employeeId: values.employeeId || undefined,
        employeeID: values.employeeId || undefined, // fallback key if API expects different casing
        phone: values.phone || undefined,
        dob: values.dob || undefined,
        joiningDate: values.joiningDate || undefined,
        attendanceStartDate:
          values.attendanceStartDate || values.joiningDate || undefined,
        email: values.email || undefined,
        personalEmail: values.personalEmail || undefined,
        bloodGroup: values.bloodGroup || undefined,
        ctc: monthlyCtc,
        aadharNumber: values.aadharNumber || undefined,
        panNumber: values.panNumber || undefined,
        uan: normalizedUan,
        bankDetails: {
          accountNumber: values.bankAcc || "",
          bankName: values.bankName || "",
          ifsc: values.ifsc || "",
        },
        hasTds: !!values.hasTds,
      };
      const res = await api.put(`/companies/employees/${id}`, payload, {
        headers: { "X-Skip-Toast": "true" },
      });
      const serverEmployee: Employee | undefined = res?.data?.employee;
      const nextEmployeeId =
        serverEmployee?.employeeId || values.employeeId || undefined;
      setEmployee((prev) =>
        prev
          ? {
              ...prev,
              address: payload.address,
              employeeId: nextEmployeeId ?? prev.employeeId,
              phone: payload.phone,
              dob: payload.dob,
              joiningDate: payload.joiningDate,
              attendanceStartDate: payload.attendanceStartDate,
              email: payload.email ?? prev.email,
              personalEmail: payload.personalEmail,
              bloodGroup: payload.bloodGroup,
              ctc: monthlyCtc,
              aadharNumber: payload.aadharNumber,
              panNumber: payload.panNumber,
              uan: payload.uan,
              bankDetails: payload.bankDetails,
              hasTds: payload.hasTds,
            }
          : prev,
      );
      toast.success("Details updated");
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to save details");
    }
  }

  async function deleteEmployee() {
    if (!id) return;
    if (!canDeleteEmployee) {
      toast.error("Only admins can delete employees.");
      return;
    }
    const trimmedNote = disableNote.trim();
    const trimmedLastDay = disableLastDay.trim();
    if (trimmedLastDay) {
      if (!parseInputDate(trimmedLastDay)) {
        setDisableError("Enter a valid last working day");
        return;
      }
    }
    try {
      setDisableLoading(true);
      setDisableError(null);
      await api.delete(`/companies/employees/${id}`, {
        data: {
          lastWorkingDay: trimmedLastDay || undefined,
          reason: disableReason || undefined,
          note: trimmedNote || undefined,
        },
        headers: { "X-Skip-Toast": "true" },
        skipToast: true,
      });
      toast.success("Employee disabled");
      setEmployee((prev) =>
        prev
          ? {
              ...prev,
              isDeleted: true,
              isActive: false,
              offboarding: {
                ...(prev.offboarding || {}),
                lastWorkingDay: trimmedLastDay || null,
                reason: disableReason || "other",
                note: trimmedNote || "",
              },
            }
          : prev,
      );
      setDisableOpen(false);
    } catch (e: any) {
      setDisableError(
        e?.response?.data?.error || "Failed to disable employee",
      );
      toast.error(e?.response?.data?.error || "Failed to disable employee");
    } finally {
      setDisableLoading(false);
    }
  }

  async function restoreEmployee() {
    if (!id) return;
    if (!canDeleteEmployee) {
      toast.error("Only admins can restore employees.");
      return;
    }
    const yes = await confirmToast({
      title: "Restore this employee?",
      message:
        "This will re-enable login and include the employee in active lists.",
      confirmText: "Restore",
      cancelText: "Cancel",
    });
    if (!yes) return;
    try {
      await api.put(
        `/companies/employees/${id}/restore`,
        {},
        { headers: { "X-Skip-Toast": "true" }, skipToast: true },
      );
      toast.success("Employee restored");
      setEmployee((prev) =>
        prev
          ? { ...prev, isDeleted: false, isActive: true, offboarding: null }
          : prev,
      );
      setDisableLastDay("");
      setDisableReason("resignation");
      setDisableNote("");
      setDisableError(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to restore employee");
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
  const hasCaps = {
    paid: leaveCaps.paid !== null,
    casual: leaveCaps.casual !== null,
    sick: leaveCaps.sick !== null,
    totalAnnual: leaveCaps.totalAnnual !== null,
  };
  const totalLeaveBalance = employee.totalLeaveAvailable ?? 0;
  const caps = {
    paid: typeof leaveCaps.paid === "number" ? leaveCaps.paid : 0,
    casual: typeof leaveCaps.casual === "number" ? leaveCaps.casual : 0,
    sick: typeof leaveCaps.sick === "number" ? leaveCaps.sick : 0,
  };
  const usedByType = {
    paid: Math.max(0, caps.paid - (leaveBalances.paid || 0)),
    casual: Math.max(0, caps.casual - (leaveBalances.casual || 0)),
    sick: Math.max(0, caps.sick - (leaveBalances.sick || 0)),
  };
  const usedTotal = usedByType.paid + usedByType.casual + usedByType.sick;
  const proratedAnnual = computeProratedAnnual({
    joiningDate: employee.joiningDate,
    policyStart: parseApplicableMonth(leaveCaps.applicableFrom),
    totalAnnual: leaveCaps.totalAnnual,
    ratePerMonth: leaveCaps.ratePerMonth,
  });
  const capSum = caps.paid + caps.casual + caps.sick;
  const capScale =
    proratedAnnual !== null && capSum > 0
      ? Math.min(1, proratedAnnual / capSum)
      : 1;
  const displayCaps = {
    paid: round2(caps.paid * capScale),
    casual: round2(caps.casual * capScale),
    sick: round2(caps.sick * capScale),
  };
  const displayTotalAvailable =
    proratedAnnual !== null
      ? round2(Math.max(0, proratedAnnual - usedTotal))
      : totalLeaveBalance;
  const displayBalances = {
    paid: round2(Math.max(0, displayCaps.paid - usedByType.paid)),
    casual: round2(Math.max(0, displayCaps.casual - usedByType.casual)),
    sick: round2(Math.max(0, displayCaps.sick - usedByType.sick)),
    unpaid: leaveBalances.unpaid,
  };
  const displayAnnualAllocation =
    proratedAnnual !== null ? round2(proratedAnnual) : leaveCaps.totalAnnual;
  const inventoryTotalCost = inventoryItems.reduce(
    (sum, item) => sum + (Number.isFinite(item.cost) ? Number(item.cost) : 0),
    0,
  );
  const statusBadge = employee?.isDeleted
    ? { label: "Disabled", tone: "bg-error/10 text-error" }
    : employee?.isActive === false
      ? { label: "Inactive", tone: "bg-warning/10 text-warning" }
      : null;
  const disableLastDayDate = parseInputDate(disableLastDay);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{employee?.name}</h2>
          <div className="text-sm text-muted-foreground">{employee?.email}</div>
          <div className="text-xs text-muted-foreground mt-1">
            Employee ID: {employee?.employeeId || "Not set"}
          </div>
          {statusBadge ? (
            <div
              className={`mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusBadge.tone}`}
            >
              {statusBadge.label}
            </div>
          ) : null}
          {statusBadge && employee?.offboarding?.lastWorkingDay ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Last working day:{" "}
              {new Date(employee.offboarding.lastWorkingDay).toLocaleDateString()}{" "}
              {employee.offboarding.reason
                ? `• ${employee.offboarding.reason.replace(/_/g, " ")}`
                : ""}
            </div>
          ) : null}
          {statusBadge && employee?.offboarding?.note ? (
            <div className="text-xs text-muted-foreground">
              Note: {employee.offboarding.note}
            </div>
          ) : null}
        </div>
        {canDeleteEmployee ? (
          <div className="flex gap-2">
            {employee?.isDeleted ? (
              <button
                onClick={restoreEmployee}
                className="h-9 px-3 rounded-md border border-success/30 text-success hover:bg-success/10"
              >
                Restore
              </button>
            ) : (
              <button
                onClick={() => {
                  if (!disableLastDay) {
                    setDisableLastDay(formatInputDate(new Date()));
                  }
                  setDisableError(null);
                  setDisableOpen(true);
                }}
                className="h-9 px-3 rounded-md border border-error/30 text-error hover:bg-error/10"
              >
                Disable
              </button>
            )}
          </div>
        ) : null}
      </div>

      <section className="rounded-md border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Profile Image</h3>
            <p className="text-xs text-muted-foreground">
              Visible across the app for this employee.
            </p>
          </div>
        </div>
        {photoErr && (
          <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
            {photoErr}
          </div>
        )}
        {photoOk && (
          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
            {photoOk}
          </div>
        )}
        <div className="flex flex-col items-start gap-4 md:flex-row md:items-center">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-border bg-muted/40">
            {profileImageUrl ? (
              <img
                src={profileImageUrl}
                alt="Employee"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-xs text-muted-foreground">No photo</span>
            )}
          </div>
          <div className="space-y-3">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
              className="block text-sm"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={uploadPhoto}
                disabled={photoUploading || !photoFile}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
              >
                {photoUploading ? "Uploading…" : "Upload Photo"}
              </button>
              <p className="text-xs text-muted-foreground">PNG/JPG • ≤10MB</p>
            </div>
          </div>
        </div>
      </section>

      {/* Personal & Job Details (order adjusted: phone, dob → email, personal email → others) */}
      <form
        onSubmit={handleSubmit(onSaveDetails)}
        className="space-y-4 bg-surface border border-border rounded-md p-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Personal & Job Details</h3>
          <div className="text-xs text-muted-foreground">
            {isDirty ? "Unsaved changes" : ""}
          </div>
        </div>

        {/* Row 1: Employee ID, Phone, DOB */}
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm mb-1">Employee ID</label>
            <input
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.employeeId ? "border-error" : "border-border"
              }`}
              placeholder="e.g. EMP-102"
              {...register("employeeId")}
            />
            {errors.employeeId && (
              <p className="text-xs text-error">{errors.employeeId.message}</p>
            )}
          </div>
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
            <label className="block text-sm mb-1">Attendance Start Date</label>
            <input
              type="date"
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.attendanceStartDate ? "border-error" : "border-border"
              }`}
              {...register("attendanceStartDate")}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Defaults to the joining date if left blank.
            </p>
            {errors.attendanceStartDate && (
              <p className="text-xs text-error">
                {errors.attendanceStartDate.message}
              </p>
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
                        { keepDirty: true },
                      );
                    }
                    if (ctcMode === "annual" && next === "monthly") {
                      const val = (n / 12).toFixed(2);
                      (document.activeElement as HTMLElement)?.blur();
                      reset(
                        { ...formValues, ctc: Number(val) },
                        { keepDirty: true },
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
              <div className="text-xs text-muted-foreground mt-1">
                {ctcMode === "annual"
                  ? `≈ Monthly: ${((Number(formValues.ctc) || 0) / 12).toFixed(
                      2,
                    )}`
                  : `≈ Annual: ${(Number(formValues.ctc) * 12 || 0).toFixed(
                      2,
                    )}`}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...register("hasTds")}
              className="h-4 w-4 rounded border border-border bg-bg text-primary"
            />
            <span className="font-medium">This employee has TDS</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Enable this if payroll for the employee requires TDS to be tracked.
            A TDS note will be requested before generating salary slips.
          </p>
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
          <div>
            <label className="block text-sm mb-1">UAN</label>
            <input
              className={`w-full h-10 rounded border px-3 bg-bg ${
                errors.uan ? "border-error" : "border-border"
              }`}
              {...register("uan")}
            />
            {errors.uan && (
              <p className="text-xs text-error">{errors.uan.message}</p>
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
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Current Status
            </div>
            <div className="text-2xl font-semibold">
              {isOnProbation ? "Probation" : "Permanent"}
            </div>
            <div className="text-sm text-muted-foreground">
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
                changeEmploymentStatus(
                  isOnProbation ? "PERMANENT" : "PROBATION",
                )
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

      {/* Inventory */}
      <section className="space-y-4 bg-surface border border-border rounded-md p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Assigned Assets</h3>
            <p className="text-xs text-muted-foreground">
              Hardware or accessories allocated to this employee.
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            Total cost:{" "}
            <span className="font-semibold text-foreground">
              {currency.format(inventoryTotalCost || 0)}
            </span>
          </div>
        </div>
        {inventoryErr && (
          <div className="text-sm text-error">{inventoryErr}</div>
        )}
        {inventoryLoading ? (
          <div className="text-sm text-muted-foreground">Loading assets…</div>
        ) : inventoryItems.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No assets assigned.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-medium">Item</th>
                  <th className="py-2 pr-4 font-medium">Category</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Cost</th>
                  <th className="py-2 pr-4 font-medium">Purchase Date</th>
                </tr>
              </thead>
              <tbody>
                {inventoryItems.map((inv) => (
                  <tr
                    key={inv._id || inv.id || inv.name}
                    className="border-b border-border/60"
                  >
                    <td className="py-2 pr-4">
                      <div className="font-medium">{inv.name}</div>
                      {inv.notes ? (
                        <div className="text-xs text-muted-foreground">
                          {inv.notes}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">
                      {inv.category || "Uncategorized"}
                    </td>
                    <td className="py-2 pr-4">
                      {inv.status
                        ? inv.status
                            .toLowerCase()
                            .split("_")
                            .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
                            .join(" ")
                        : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {currency.format(Number(inv.cost || 0))}
                    </td>
                    <td className="py-2 pr-4">
                      {inv.purchaseDate
                        ? new Date(inv.purchaseDate).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Total Available
            </div>
            <div className="text-3xl font-semibold mt-1">
              {displayTotalAvailable}
            </div>
            {hasCaps.totalAnnual && displayAnnualAllocation !== null && (
              <div className="text-xs text-muted-foreground mt-2">
                Annual allocation: {displayAnnualAllocation}
              </div>
            )}
            {displayTotalAvailable < 0 && (
              <div className="text-xs text-error mt-2">
                Negative balance indicates overuse.
              </div>
            )}
          </div>
          <div className="rounded-md border border-border/60 bg-bg p-4 text-sm space-y-2">
            <div className="flex items-center justify-between">
              <span>Paid remaining</span>
              <span className="text-right">
                {displayBalances.paid}
                {hasCaps.paid && (
                  <span className="ml-1 text-xs text-muted-foreground whitespace-nowrap">
                    / {displayCaps.paid}
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Casual remaining</span>
              <span className="text-right">
                {displayBalances.casual}
                {hasCaps.casual && (
                  <span className="ml-1 text-xs text-muted-foreground whitespace-nowrap">
                    / {displayCaps.casual}
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Sick remaining</span>
              <span className="text-right">
                {displayBalances.sick}
                {hasCaps.sick && (
                  <span className="ml-1 text-xs text-muted-foreground whitespace-nowrap">
                    / {displayCaps.sick}
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/40">
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
        <div className="text-xs text-muted-foreground">
          Use positive to credit, negative to deduct.
        </div>
        <div className="mt-4 border-t border-border/50 pt-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Set unpaid taken</div>
              <div className="text-xs text-muted-foreground">
                Override the unpaid days already counted for this employee.
              </div>
            </div>
            {unpaidTakenErr && (
              <div className="text-xs text-error">{unpaidTakenErr}</div>
            )}
            {unpaidTakenOk && (
              <div className="text-xs text-success">{unpaidTakenOk}</div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="number"
              min="0"
              step="0.25"
              value={unpaidTakenInput}
              onChange={(e) => {
                setUnpaidTakenInput(e.target.value);
                if (unpaidTakenErr) setUnpaidTakenErr(null);
                if (unpaidTakenOk) setUnpaidTakenOk(null);
              }}
              className="h-10 rounded-md border border-border bg-bg px-3"
              placeholder="e.g. 0"
            />
            <button
              type="button"
              onClick={saveUnpaidTaken}
              disabled={unpaidTakenSaving}
              className="inline-flex items-center justify-center h-10 rounded-md bg-primary px-4 text-white disabled:opacity-60"
            >
              {unpaidTakenSaving ? "Saving…" : "Save unpaid taken"}
            </button>
            <button
              type="button"
              onClick={() => setUnpaidTakenInput(String(leaveBalances.unpaid))}
              disabled={unpaidTakenSaving}
              className="h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50"
            >
              Reset
            </button>
          </div>
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
        <form onSubmit={updateReporting} className="space-y-3">
          <ReportingPersonMultiSelect
            options={employees
              .filter((e) => e.id !== id)
              .map((e) => ({ value: e.id, label: e.name }))}
            value={reportingPersons}
            onChange={setReportingPersons}
          />
          <div className="flex items-center gap-2">
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
          </div>
        </form>
        <p className="text-xs text-muted-foreground">
          Select one or more managers to receive attendance and leave updates
          for this employee.
        </p>
      </section>

      {/* Documents */}
      <section className="bg-surface border border-border rounded-md p-4">
        <h3 className="font-semibold mb-2">Documents</h3>
        {docErr && (
          <div className="mb-2 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
            {docErr}
          </div>
        )}
        {docOk && (
          <div className="mb-2 rounded-md border border-success/20 bg-success/10 px-3 py-2 text-xs text-success">
            {docOk}
          </div>
        )}
        {employee?.documents?.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No documents uploaded.
          </div>
        ) : (
          <ul className="list-disc pl-6 space-y-1">
            {employee?.documents?.map((d) => (
              <li key={d}>
                <a
                  href={resolveMediaUrl(d) || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  {d}
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            key={docInputKey}
            type="file"
            multiple
            onChange={(e) => {
              setDocFiles(e.target.files);
              if (docErr) setDocErr(null);
              if (docOk) setDocOk(null);
            }}
            className="text-sm"
          />
          <button
            type="button"
            onClick={uploadDocuments}
            disabled={docUploading}
            className="inline-flex items-center justify-center h-10 rounded-md bg-primary px-4 text-white disabled:opacity-60"
          >
            {docUploading ? "Uploading…" : "Upload Documents"}
          </button>
          <span className="text-xs text-muted-foreground">
            PDF, images, etc.
          </span>
        </div>
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
          {rLoading && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}
        </div>
        {report && !rLoading && (
          <div className="text-sm">
            Worked Days: {report.workedDays}, Leave Days: {report.leaveDays}
            {typeof report.halfDayLeaves === "number" && (
              <> (Half Days: {report.halfDayLeaves})</>
            )}
          </div>
        )}
      </section>

      {disableOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDisableOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-xl space-y-4 z-[91]">
            <div>
              <h3 className="text-lg font-semibold">Disable employee</h3>
              <p className="text-xs text-muted-foreground">
                This is a soft disable: login will be blocked and the employee
                leaves active lists, but history stays.
              </p>
            </div>
            {disableError ? (
              <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
                {disableError}
              </div>
            ) : null}
            <div className="grid md:grid-cols-2 gap-3">
              <label className="text-sm space-y-1">
                <span className="block font-medium">Last working day</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {disableLastDayDate
                        ? disableLastDayDate.toLocaleDateString("en-GB")
                        : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="z-[95] p-0">
                    <Calendar
                      mode="single"
                      selected={disableLastDayDate}
                      onSelect={(day) =>
                        setDisableLastDay(day ? formatInputDate(day) : "")
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </label>
              <label className="text-sm space-y-1">
                <span className="block font-medium">Reason</span>
                <select
                  value={disableReason}
                  onChange={(e) => setDisableReason(e.target.value)}
                  className="w-full h-10 rounded border border-border bg-bg px-3"
                >
                  {OFFBOARDING_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="space-y-1 text-sm">
              <span className="block font-medium">Notes (optional)</span>
              <textarea
                value={disableNote}
                onChange={(e) => setDisableNote(e.target.value)}
                className="w-full min-h-[90px] rounded border border-border bg-bg px-3 py-2"
                placeholder="Exit remarks, asset collection, notice period etc."
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="h-10 px-4 rounded-md border border-border text-sm"
                onClick={() => setDisableOpen(false)}
                disabled={disableLoading}
              >
                Cancel
              </button>
              <button
                className="h-10 px-4 rounded-md bg-error text-white text-sm disabled:opacity-60"
                onClick={deleteEmployee}
                disabled={disableLoading}
              >
                {disableLoading ? "Disabling…" : "Disable employee"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtNumber(value: number | null | undefined) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  if (Math.abs(num % 1) < 1e-4) return String(Math.round(num));
  return num.toFixed(2);
}
