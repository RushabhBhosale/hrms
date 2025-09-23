import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { setAuth } from "../lib/auth";
import { Field } from "../components/ui/Field";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

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
  phone: z
    .string()
    .transform(strip)
    .refine(
      (v) => v === "" || /^\d{10}$/.test(v),
      "Phone must be exactly 10 digits"
    )
    .default(""),
  address: z.string().default(""),
  dob: z
    .string()
    .transform(strip)
    .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "Invalid date")
    .refine(
      (v) => v === "" || new Date(v) < new Date(),
      "DOB must be in the past"
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
      "Enter 7–18 digits"
    )
    .default(""),
  bankIfsc: z
    .string()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === "" || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "Invalid IFSC")
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
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
        console.log("hdsgdswkc", res);
        const emp = res.data.employee || {};
        reset({
          name: emp.name || "",
          email: emp.email || "",
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
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to change password");
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
        <p className="text-sm text-muted">Update your details.</p>
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

      {/* Personal Information */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Personal Information</h3>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Full Name">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("name")}
              />
              {errors.name && (
                <p className="text-xs text-error mt-1">{errors.name.message}</p>
              )}
            </Field>
            <Field label="Email">
              <input
                type="email"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-xs text-error mt-1">
                  {errors.email.message}
                </p>
              )}
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

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Aadhaar Number">
              <Controller
                control={control}
                name="aadharNumber"
                render={({ field }) => (
                  <input
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                    value={formatAadhaar(field.value || "")}
                    onChange={(e) => field.onChange(e.target.value)}
                    inputMode="numeric"
                    maxLength={14}
                    placeholder="1234 5678 9012"
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
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                maxLength={10}
                {...register("panNumber")}
              />
              {errors.panNumber && (
                <p className="text-xs text-error mt-1">
                  {errors.panNumber.message}
                </p>
              )}
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Bank Name">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("bankName")}
              />
              {errors.bankName && (
                <p className="text-xs text-error mt-1">
                  {errors.bankName.message}
                </p>
              )}
            </Field>
            <Field label="Account Number">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                inputMode="numeric"
                {...register("bankAccountNumber")}
              />
              {errors.bankAccountNumber && (
                <p className="text-xs text-error mt-1">
                  {errors.bankAccountNumber.message}
                </p>
              )}
            </Field>
            <Field label="IFSC Code">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...register("bankIfsc")}
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
            <Field label="Current password">
              <input
                type="password"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...registerPw("currentPassword")}
              />
              {pwErrors.currentPassword && (
                <p className="text-xs text-error mt-1">
                  {pwErrors.currentPassword.message}
                </p>
              )}
            </Field>
            <Field label="New password (min 6 chars)">
              <input
                type="password"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...registerPw("newPassword")}
              />
              {pwErrors.newPassword && (
                <p className="text-xs text-error mt-1">
                  {pwErrors.newPassword.message}
                </p>
              )}
            </Field>
            <Field label="Confirm password">
              <input
                type="password"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                {...registerPw("confirmPassword")}
              />
              {pwErrors.confirmPassword && (
                <p className="text-xs text-error mt-1">
                  {pwErrors.confirmPassword.message}
                </p>
              )}
            </Field>
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
