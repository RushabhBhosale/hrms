import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { resolveMediaUrl } from "../lib/utils";
import { clearAuth, setAuth } from "../lib/auth";
import { Field } from "../components/utils/Field";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { PasswordField } from "../components/utils/PasswordInput";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

// ---------- Helpers ----------
const strip = (v: string) => v.trim();
const formatAadhaar = (v: string) =>
  v
    .replace(/\D/g, "")
    .slice(0, 12)
    .replace(/(\d{4})(?=\d)/g, "$1 ");

// ---------- Schemas (all fields -> definite string outputs) ----------
const ProfileSchema = z.object({
  name: z.string().min(2, "Enter full name").max(120, "Too long"),
  email: z.string().email("Invalid email"),
  personalEmail: z
    .string()
    .transform(strip)
    .refine(
      (v) => v === "" || z.string().email().safeParse(v).success,
      "Invalid personal email",
    )
    .default(""),
  phone: z
    .string()
    .transform(strip)
    .refine(
      (v) => v === "" || /^\d{10}$/.test(v),
      "Phone must be exactly 10 digits",
    )
    .default(""),
  address: z.string().default(""),
  dob: z
    .string()
    .transform(strip)
    .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "Invalid date")
    .refine(
      (v) => v === "" || new Date(v) < new Date(),
      "DOB must be in the past",
    )
    .default(""),
  aadharNumber: z
    .string()
    .transform((v) => v.replace(/\D/g, "")) // keep only digits
    .refine((v) => v === "" || /^\d{12}$/.test(v), "Aadhaar must be 12 digits")
    .default(""),
  panNumber: z
    .string()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === "" || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), "Invalid PAN")
    .default(""),
  bankName: z.string().default(""),
  bankAccountNumber: z
    .string()
    .transform(strip)
    .refine(
      (v) => v === "" || /^[0-9]{7,18}$/.test(v.replace(/\s+/g, "")),
      "Enter 7–18 digits",
    )
    .default(""),
  bankIfsc: z
    .string()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === "" || v.length > 10, "Must be exactly 11 characters")
    .default(""),
});
type ProfileValues = z.output<typeof ProfileSchema>;

const PasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Required"),
    newPassword: z.string().min(6, "Min 6 characters"),
    confirmPassword: z.string().min(6, "Min 6 characters"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
type PasswordValues = z.output<typeof PasswordSchema>;

export default function Profile() {
  const nav = useNavigate();
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [canEditProtected, setCanEditProtected] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [roleText, setRoleText] = useState<string>("");
  const [uan, setUan] = useState<string>("");
  const [bankLocked, setBankLocked] = useState(false);
  const resolveImageUrl = (value: string | null) => resolveMediaUrl(value);
  const validateImageFile = (file: File | null) => {
    if (!file) return "No file selected";
    if (!file.type.startsWith("image/")) return "Only image files allowed";
    if (file.size > 10 * 1024 * 1024) return "File must be ≤ 10MB";
    return null;
  };

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
    watch,
    control,
  } = useForm({
    resolver: zodResolver(ProfileSchema),
    defaultValues: {
      name: "",
      email: "",
      personalEmail: "",
      phone: "",
      address: "",
      dob: "",
      aadharNumber: "",
      panNumber: "",
      bankName: "",
      bankAccountNumber: "",
      bankIfsc: "",
    },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const {
    register: registerPw,
    handleSubmit: submitPw,
    reset: resetPw,
    formState: { errors: pwErrors, isSubmitting: pwLoading },
  } = useForm<PasswordValues>({
    resolver: zodResolver(PasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  // Load profile
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/auth/me");
        const emp = res.data.employee || {};
        setCanEditProtected(
          ["ADMIN", "SUPERADMIN"].includes(emp.primaryRole || ""),
        );
        setAvatar(emp.profileImage || null);
        setEmployeeId(emp.employeeId || "");
        const primary = emp.primaryRole ? String(emp.primaryRole) : "";
        const subs =
          Array.isArray(emp.subRoles) && emp.subRoles.length
            ? emp.subRoles.map((r: string) => String(r)).join(", ")
            : "";
        const roleLine = [subs].filter(Boolean).join(" · ");
        setRoleText(roleLine || "Not set");
        setUan(emp.uan || "");
        const existingBank =
          (emp.bankDetails?.bankName ||
            emp.bankDetails?.accountNumber ||
            emp.bankDetails?.ifsc) &&
          !["ADMIN", "SUPERADMIN"].includes(emp.primaryRole || "");
        setBankLocked(!!existingBank);
        reset({
          name: emp.name || "",
          email: emp.email || "",
          personalEmail: emp.personalEmail || "",
          phone: emp.phone || "",
          address: emp.address || "",
          dob: emp.dob ? new Date(emp.dob).toISOString().slice(0, 10) : "",
          aadharNumber: emp.aadharNumber || "",
          panNumber: (emp.panNumber || "").toUpperCase(),
          bankName: emp.bankDetails?.bankName || "",
          bankAccountNumber: emp.bankDetails?.accountNumber || "",
          bankIfsc: (emp.bankDetails?.ifsc || "").toUpperCase(),
        });
      } catch {
        // ignore
      }
    })();
  }, [reset]);

  // Submit profile
  const onSubmit = async (data: ProfileValues) => {
    setOk(null);
    setErr(null);
    try {
      await api.put("/auth/me", {
        ...data,
        bankAccountNumber: (data.bankAccountNumber || "").replace(/\s+/g, ""),
      });
      const me = await api.get("/auth/me");
      const token = localStorage.getItem("token") || "";
      if (token && me.data?.employee) setAuth(token, me.data.employee);
      setUan(me?.data?.employee?.uan || "");
      setOk("Profile updated");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to update profile");
    }
  };

  // Submit password
  const onChangePassword = async (data: PasswordValues) => {
    setErr(null);
    setOk(null);
    try {
      await api.post("/auth/change-password", {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      resetPw();
      setOk("Password updated");
      clearAuth();
      nav("/login");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to change password");
      toast.error(e?.response?.data?.error || "Failed to change password");
    }
  };

  const onUploadAvatar = async () => {
    setOk(null);
    setErr(null);
    const validation = validateImageFile(avatarFile);
    if (validation) {
      setErr(validation);
      toast.error(validation);
      return;
    }
    try {
      setAvatarUploading(true);
      const fd = new FormData();
      fd.append("photo", avatarFile as File);
      const res = await api.post("/auth/me/photo", fd);
      const stored = res.data?.profileImage || null;
      setAvatar(stored);
      setAvatarFile(null);
      const token = localStorage.getItem("token") || "";
      if (token) {
        try {
          const me = await api.get("/auth/me");
          if (me?.data?.employee) setAuth(token, me.data.employee);
        } catch (_) {}
      }
      setOk("Profile photo updated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to upload photo";
      setErr(msg);
      toast.error(msg);
    } finally {
      setAvatarUploading(false);
    }
  };

  // Live UI uppercase PAN/IFSC (schema already uppercases; this only improves UX)
  const pan = watch("panNumber");
  useEffect(() => {
    if (pan && pan !== pan.toUpperCase())
      setValue("panNumber", pan.toUpperCase(), { shouldValidate: true });
  }, [pan, setValue]);

  const ifsc = watch("bankIfsc");
  useEffect(() => {
    if (ifsc && ifsc !== ifsc.toUpperCase())
      setValue("bankIfsc", ifsc.toUpperCase(), { shouldValidate: true });
  }, [ifsc, setValue]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Profile</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Employee ID: {employeeId || "Not set"}
        </p>
        <p className="text-xs text-muted-foreground capitalize">
          Role: {roleText || "Not set"}
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

      {/* Profile photo */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Profile Photo</h3>
          <p className="text-xs text-muted-foreground">
            This image is used across the app where your profile appears.
          </p>
        </div>
        <div className="flex flex-col gap-4 px-6 py-5 md:flex-row md:items-center">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-border bg-muted/40">
            {avatar ? (
              <img
                src={resolveImageUrl(avatar) || ""}
                alt="Profile"
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
              onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
              className="block text-sm"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onUploadAvatar}
                disabled={avatarUploading || !avatarFile}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
              >
                {avatarUploading ? "Uploading…" : "Upload Photo"}
              </button>
              <p className="text-xs text-muted-foreground">PNG/JPG • ≤10MB</p>
            </div>
          </div>
        </div>
      </section>

      {/* Personal Information */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Personal Information</h3>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Full Name" required>
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("name")}
              />
              {errors.name && (
                <p className="text-xs text-error mt-1">{errors.name.message}</p>
              )}
            </Field>
            <Field label="Email" required>
              <input
                type="email"
                className={`w-full rounded-md border border-border px-3 py-2 outline-none focus:ring-2 focus:ring-primary ${
                  canEditProtected
                    ? "bg-surface"
                    : "bg-muted/10 text-muted-foreground cursor-not-allowed"
                }`}
                {...register("email")}
                readOnly={!canEditProtected}
                aria-readonly={!canEditProtected}
              />
              {errors.email && (
                <p className="text-xs text-error mt-1">
                  {errors.email.message}
                </p>
              )}
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Personal Email">
              <input
                type="email"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("personalEmail")}
              />
              {errors.personalEmail && (
                <p className="text-xs text-error mt-1">
                  {errors.personalEmail.message}
                </p>
              )}
            </Field>
            <Field label="Employee ID">
              <input
                className="w-full rounded-md border border-border bg-muted/10 px-3 py-2 text-muted-foreground cursor-not-allowed"
                value={employeeId || "Not set"}
                readOnly
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Phone">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                maxLength={10}
                type="number"
                inputMode="numeric"
                {...register("phone")}
              />
              {errors.phone && (
                <p className="text-xs text-error mt-1">
                  {errors.phone.message}
                </p>
              )}
            </Field>
            <Field label="Address">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("address")}
              />
              {errors.address && (
                <p className="text-xs text-error mt-1">
                  {errors.address.message}
                </p>
              )}
            </Field>
            <Field label="Date of Birth">
              <input
                type="date"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("dob")}
              />
              {errors.dob && (
                <p className="text-xs text-error mt-1">{errors.dob.message}</p>
              )}
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Aadhaar Number">
              <Controller
                control={control}
                name="aadharNumber"
                render={({ field }) => (
                  <input
                    className={`w-full rounded-md border border-border px-3 py-2 outline-none focus:ring-2 focus:ring-primary ${
                      canEditProtected
                        ? "bg-surface"
                        : "bg-muted/10 text-muted-foreground cursor-not-allowed"
                    }`}
                    value={formatAadhaar(field.value || "")}
                    onChange={(e) => field.onChange(e.target.value)}
                    inputMode="numeric"
                    maxLength={14}
                    placeholder="1234 5678 9012"
                    readOnly={!canEditProtected}
                    aria-readonly={!canEditProtected}
                  />
                )}
              />
              {errors.aadharNumber && (
                <p className="text-xs text-error mt-1">
                  {errors.aadharNumber.message}
                </p>
              )}
            </Field>
            <Field label="PAN Number">
              <input
                className={`w-full rounded-md border border-border px-3 py-2 uppercase outline-none focus:ring-2 focus:ring-primary ${
                  canEditProtected
                    ? "bg-surface"
                    : "bg-muted/10 text-muted-foreground cursor-not-allowed"
                }`}
                maxLength={10}
                {...register("panNumber")}
                readOnly={!canEditProtected}
                aria-readonly={!canEditProtected}
              />
              {errors.panNumber && (
                <p className="text-xs text-error mt-1">
                  {errors.panNumber.message}
                </p>
              )}
            </Field>
            <Field label="UAN">
              <input
                className="w-full rounded-md border border-border bg-muted/10 px-3 py-2 text-muted-foreground cursor-not-allowed"
                value={uan || ""}
                placeholder="Not set"
                readOnly
                aria-readonly={true}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Contact your administrator to update your UAN.
              </p>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Bank Name">
              <input
                className={`w-full rounded-md border border-border px-3 py-2 outline-none focus:ring-2 focus:ring-primary ${
                  bankLocked
                    ? "bg-muted/10 text-muted-foreground cursor-not-allowed"
                    : "bg-surface"
                }`}
                {...register("bankName")}
                readOnly={bankLocked}
              />
              {errors.bankName && (
                <p className="text-xs text-error mt-1">
                  {errors.bankName.message}
                </p>
              )}
            </Field>
            <Field label="Account Number">
              <input
                className={`w-full rounded-md border border-border px-3 py-2 outline-none focus:ring-2 focus:ring-primary ${
                  bankLocked
                    ? "bg-muted/10 text-muted-foreground cursor-not-allowed"
                    : "bg-surface"
                }`}
                inputMode="numeric"
                {...register("bankAccountNumber")}
                readOnly={bankLocked}
              />
              {errors.bankAccountNumber && (
                <p className="text-xs text-error mt-1">
                  {errors.bankAccountNumber.message}
                </p>
              )}
            </Field>
            <Field label="IFSC Code">
              <input
                maxLength={11}
                className={`w-full rounded-md border border-border px-3 py-2 outline-none focus:ring-2 focus:ring-primary ${
                  bankLocked
                    ? "bg-muted/10 text-muted-foreground cursor-not-allowed"
                    : "bg-surface"
                }`}
                {...register("bankIfsc")}
                readOnly={bankLocked}
              />
              {errors.bankIfsc && (
                <p className="text-xs text-error mt-1">
                  {errors.bankIfsc.message}
                </p>
              )}
            </Field>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {isSubmitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </section>

      {/* Change Password */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Change Password</h3>
        </div>

        <form
          onSubmit={submitPw(onChangePassword)}
          className="px-6 py-5 space-y-5"
        >
          <div className="grid gap-4 md:grid-cols-3">
            <PasswordField
              label="Current password"
              registration={registerPw("currentPassword")}
              error={pwErrors.currentPassword}
            />
            <PasswordField
              label="New password (min 6 chars)"
              registration={registerPw("newPassword")}
              error={pwErrors.newPassword}
            />
            <PasswordField
              label="Confirm password"
              registration={registerPw("confirmPassword")}
              error={pwErrors.confirmPassword}
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
              disabled={pwLoading}
            >
              {pwLoading ? "…" : "Update password"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
