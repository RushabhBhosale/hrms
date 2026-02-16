import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { Field } from "../../components/utils/Field";
import ReportingPersonMultiSelect from "../../components/ReportingPersonMultiSelect";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import type { RoleDefinition } from "../../types/roles";
import { Button } from "../../components/ui/button";

type EmpLite = { id: string; name: string };

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

const schema = z.object({
  name: z.string().min(2, "Enter full name").max(120, "Too long"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Min 6 characters"),
  role: z.string().min(1, "Select a role"),
  address: z.string().min(3, "Too short").max(200, "Too long"),
  phone: z.string().regex(/^\d{10}$/, "Must be 10 digits"),
  personalEmail: z
    .union([z.literal(""), z.string().trim().email("Invalid personal email")])
    .default(""),
  dob: z
    .string()
    .min(1, "DOB is required")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date")
    .refine((v) => new Date(v) < new Date(), "DOB must be in the past"),
  attendanceStartDate: z
    .string()
    .refine(
      (v) => !v || v.trim() === "" || !Number.isNaN(Date.parse(v)),
      "Invalid attendance start date",
    )
    .default(""),
  joiningDate: z
    .string()
    .min(1, "Joining date is required")
    .refine(
      (v) => !v || v.trim() === "" || !Number.isNaN(Date.parse(v)),
      "Invalid joining date",
    )
    .default(""),
  bloodGroup: z.union([z.literal(""), z.enum(BLOOD_GROUP_OPTIONS)]).default(""),
  reportingPersons: z
    .array(z.string().min(1))
    .default([])
    .transform((vals) =>
      Array.from(
        new Set(
          (vals || []).map((val) => val.trim()).filter((val) => val.length > 0),
        ),
      ),
    ),
  employeeId: z.string().min(1, "Employee Id is required"),
  ctc: z
    .string()
    .min(1, "CTC is required")
    .refine(
      (v) => !Number.isNaN(Number(v)) && Number(v) >= 0,
      "Enter a valid number",
    ),
  ctcMode: z.enum(["monthly", "annual"]),
  aadharNumber: z
    .string()
    .regex(/^\d{12}$/, "Aadhaar must be exactly 12 digits"),
  panNumber: z.string().refine((v) => {
    if (!v) return true;
    return /^[A-Za-z0-9]{8,20}$/.test(v.trim());
  }, "PAN should be 8–20 alphanumerics"),
  uan: z
    .string()
    .regex(/^\d{12}$/, "UAN must be 12 digits")
    .or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

export default function AddEmployee() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmpLite[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [defaultRole, setDefaultRole] = useState("");
  const [docs, setDocs] = useState<FileList | null>(null);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "",
      address: "",
      phone: "",
      personalEmail: "",
      dob: "",
      joiningDate: "",
      attendanceStartDate: "",
      bloodGroup: "",
      reportingPersons: [],
      employeeId: "",
      ctc: "",
      ctcMode: "annual",
      aadharNumber: "",
      panNumber: "",
      uan: "",
    },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors },
    watch,
  } = form;

  const ctc = watch("ctc");
  const ctcMode = watch("ctcMode");
  const joiningDate = watch("joiningDate");
  const attendanceStartDate = watch("attendanceStartDate");

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
        const fallback =
          defs.find((item) => !item.system)?.name || defs[0]?.name || "";
        setDefaultRole(fallback);
        if (fallback) setValue("role", fallback, { shouldValidate: true });
      } catch {}
    })();
  }, [setValue]);

  useEffect(() => {
    if (joiningDate && !attendanceStartDate) {
      setValue("attendanceStartDate", joiningDate, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [attendanceStartDate, joiningDate, setValue]);

  const onSubmit = async (data: FormValues) => {
    setOk(null);
    setErr(null);
    try {
      setSubmitting(true);

      const monthlyCtc =
        data.ctcMode === "annual" ? Number(data.ctc) / 12 : Number(data.ctc);

      if (docs) {
        const tooBig = Array.from(docs).some((f) => f.size > 10 * 1024 * 1024);
        if (tooBig) {
          setErr("Each document must be ≤ 10MB");
          setSubmitting(false);
          return;
        }
      }

      const fd = new FormData();
      const normalizedAadhaar = (data.aadharNumber || "").replace(/\D/g, "");
      const normalizedPan = (data.panNumber || "").trim().toUpperCase();
      const normalizedUan = (data.uan || "").replace(/\D/g, "");
      const normalizedAttendanceStart =
        data.attendanceStartDate || data.joiningDate;
      const payload = {
        ...data,
        attendanceStartDate: normalizedAttendanceStart,
        aadharNumber: normalizedAadhaar,
        panNumber: normalizedPan,
        uan: normalizedUan,
        ctc: String(monthlyCtc),
      };
      const { ctcMode: _omit, reportingPersons, ...rest } = payload as any;
      Object.entries(rest).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        fd.append(k, String(v));
      });
      if (Array.isArray(reportingPersons)) {
        reportingPersons.forEach((id: string) => {
          if (id) fd.append("reportingPersons", id);
        });
      }
      if (docs) Array.from(docs).forEach((f) => fd.append("documents", f));

      await api.post("/companies/employees", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      reset({
        name: "",
        email: "",
        password: "",
        role: defaultRole || "",
        address: "",
        phone: "",
        personalEmail: "",
        dob: "",
        joiningDate: "",
        attendanceStartDate: "",
        bloodGroup: "",
        reportingPersons: [],
        employeeId: "",
        ctc: "",
        ctcMode: "annual",
        aadharNumber: "",
        panNumber: "",
      });
      setDocs(null);
      setOk("Employee added");
      navigate("/admin/employees");
      toast.success("Employee saved successfully");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to add employee");
      toast.error(e?.response?.data?.error || "Failed to add employee");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold">Add Employee</h2>
          <p className="text-sm text-muted-foreground">
            Create an employee and upload documents.
          </p>
        </div>
        <div>
          <Button
            variant="outline"
            className="h-10"
            onClick={() => navigate("/admin/employees")}
          >
            back to list
          </Button>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Employee Details</h3>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="px-6 py-5 space-y-5"
          encType="multipart/form-data"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name" required>
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="Jane Doe"
                {...register("name")}
              />
              {errors.name && (
                <p className="text-xs text-error mt-1">{errors.name.message}</p>
              )}
            </Field>
            <Field label="Email" required>
              <input
                type="email"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="jane@peracto.com"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-xs text-error mt-1">
                  {errors.email.message}
                </p>
              )}
            </Field>
            <Field label="Personal Email">
              <input
                type="email"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="jane.doe@gmail.com"
                {...register("personalEmail")}
              />
              {errors.personalEmail && (
                <p className="text-xs text-error mt-1">
                  {errors.personalEmail.message}
                </p>
              )}
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Password" required>
              <input
                type="password"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="••••••••"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-xs text-error mt-1">
                  {errors.password.message}
                </p>
              )}
            </Field>

            <Field label="Role" required>
              <select
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("role")}
              >
                <option value="">Select role</option>
                {roles.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.label}
                  </option>
                ))}
              </select>
              {errors.role && (
                <p className="text-xs text-error mt-1">{errors.role.message}</p>
              )}
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Reporting Persons">
              <Controller
                name="reportingPersons"
                control={control}
                render={({ field }) => (
                  <ReportingPersonMultiSelect
                    options={employees.map((emp) => ({
                      value: emp.id,
                      label: emp.name,
                    }))}
                    value={field.value || []}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Choose one or more managers who should receive updates.
              </p>
            </Field>
            <Field label="Employee ID" required>
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="EMP001"
                {...register("employeeId")}
              />
              {errors.employeeId && (
                <p className="text-xs text-error mt-1">
                  {errors.employeeId.message}
                </p>
              )}
            </Field>
            <Field label="CTC" required>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  type="number"
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                  placeholder={
                    ctcMode === "annual" ? "e.g. 600000" : "e.g. 50000"
                  }
                  {...register("ctc")}
                  min={0}
                  step="0.01"
                />
                <select
                  className="rounded-md border border-border bg-surface px-2"
                  {...register("ctcMode")}
                >
                  <option value="annual">Per Annum</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              {ctc && (
                <div className="text-xs text-muted-foreground mt-1">
                  {ctcMode === "annual"
                    ? `≈ Monthly: ${(Number(ctc) / 12 || 0).toFixed(2)}`
                    : `≈ Annual: ${(Number(ctc) * 12 || 0).toFixed(2)}`}
                </div>
              )}
              {errors.ctc && (
                <p className="text-xs text-error mt-1">{errors.ctc.message}</p>
              )}
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Address" required>
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="Street, City, ZIP"
                {...register("address")}
              />
              {errors.address && (
                <p className="text-xs text-error mt-1">
                  {errors.address.message}
                </p>
              )}
            </Field>
            <Field label="Phone" required>
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="9876543210"
                maxLength={10}
                {...register("phone")}
              />
              {errors.phone && (
                <p className="text-xs text-error mt-1">
                  {errors.phone.message}
                </p>
              )}
            </Field>
            <Field label="Blood Group">
              <select
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("bloodGroup")}
              >
                <option value="">Select</option>
                {BLOOD_GROUP_OPTIONS.map((bg) => (
                  <option key={bg} value={bg}>
                    {bg}
                  </option>
                ))}
              </select>
              {errors.bloodGroup && (
                <p className="text-xs text-error mt-1">
                  {errors.bloodGroup.message}
                </p>
              )}
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Aadhaar Number" required>
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="123456789012"
                inputMode="numeric"
                maxLength={12}
                {...register("aadharNumber")}
              />
              {errors.aadharNumber && (
                <p className="text-xs text-error mt-1">
                  {errors.aadharNumber.message as string}
                </p>
              )}
            </Field>
            <Field label="PAN Number" required>
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 uppercase outline-none focus:ring-2 focus:ring-primary"
                placeholder="ABCDE1234F"
                maxLength={20}
                {...register("panNumber")}
              />
              {errors.panNumber && (
                <p className="text-xs text-error mt-1">
                  {errors.panNumber.message as string}
                </p>
              )}
            </Field>
            <Field label="UAN">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="12-digit UAN"
                inputMode="numeric"
                maxLength={12}
                {...register("uan")}
              />
              {errors.uan && (
                <p className="text-xs text-error mt-1">
                  {errors.uan.message as string}
                </p>
              )}
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Date of Birth" required>
              <input
                type="date"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("dob")}
              />
              {errors.dob && (
                <p className="text-xs text-error mt-1">{errors.dob.message}</p>
              )}
            </Field>
            <Field label="Joining Date" required>
              <input
                type="date"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("joiningDate")}
              />
              {errors.joiningDate && (
                <p className="text-xs text-error mt-1">
                  {errors.joiningDate.message}
                </p>
              )}
            </Field>
            <Field label="Attendance Start Date">
              <input
                type="date"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("attendanceStartDate")}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Defaults to the joining date if left blank.
              </p>
              {errors.attendanceStartDate && (
                <p className="text-xs text-error mt-1">
                  {errors.attendanceStartDate.message}
                </p>
              )}
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Documents">
              <label className="flex h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-bg px-3 text-sm text-muted-foreground hover:bg-bg/70">
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => setDocs(e.target.files)}
                />
                <span>Click to upload or drag & drop</span>
                <span className="text-xs">PNG, JPG, PDF up to 10MB each</span>
              </label>
              {!!docs && (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {Array.from(docs).map((f, i) => (
                    <li key={i} className="truncate">
                      {f.name}
                    </li>
                  ))}
                </ul>
              )}
            </Field>
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

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {submitting ? "Creating…" : "Add Employee"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
