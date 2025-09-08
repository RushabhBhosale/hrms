import { useEffect, useState, FormEvent } from "react";
import { api } from "../lib/api";
import { setAuth } from "../lib/auth";
import { isValidEmail, isValidPassword, isValidPhone } from "../lib/validate";
import { Field } from "../components/ui/Field";

interface FormState {
  name: string;
  email: string;
  phone: string;
  address: string;
  dob: string; // yyyy-mm-dd
  aadharNumber: string;
  panNumber: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
}

export default function Profile() {
  const [form, setForm] = useState<FormState>({
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
  });
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwLoading, setPwLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/auth/me");
        const emp = res.data.employee || {};
        setForm({
          name: emp.name || "",
          email: emp.email || "",
          phone: emp.phone || "",
          address: emp.address || "",
          dob: emp.dob ? new Date(emp.dob).toISOString().slice(0, 10) : "",
          aadharNumber: emp.aadharNumber || "",
          panNumber: emp.panNumber || "",
          bankName: emp.bankDetails?.bankName || "",
          bankAccountNumber: emp.bankDetails?.accountNumber || "",
          bankIfsc: emp.bankDetails?.ifsc || "",
        });
      } catch {
        // ignore
      }
    })();
  }, []);

  function onChange<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setOk(null);
    setErr(null);
    try {
      if (!isValidEmail(form.email)) {
        setErr("Please enter a valid email");
        return;
      }
      if (form.phone && !isValidPhone(form.phone)) {
        setErr("Phone must be exactly 10 digits");
        return;
      }
      await api.put("/auth/me", {
        name: form.name,
        email: form.email,
        phone: form.phone,
        address: form.address,
        dob: form.dob,
        aadharNumber: form.aadharNumber,
        panNumber: form.panNumber,
        bankName: form.bankName,
        bankAccountNumber: form.bankAccountNumber,
        bankIfsc: form.bankIfsc,
      });
      // Refresh local auth cache with latest profile
      const me = await api.get("/auth/me");
      const token = localStorage.getItem("token") || "";
      if (token && me.data?.employee) setAuth(token, me.data.employee);
      setOk("Profile updated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update profile";
      setErr(msg);
    }
  }

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

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Personal Information</h3>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Full Name">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.name}
                onChange={(e) => onChange("name", e.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.email}
                onChange={(e) => onChange("email", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Phone">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.phone}
                onChange={(e) => onChange("phone", e.target.value)}
              />
            </Field>
            <Field label="Address">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.address}
                onChange={(e) => onChange("address", e.target.value)}
              />
            </Field>
            <Field label="Date of Birth">
              <input
                type="date"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.dob}
                onChange={(e) => onChange("dob", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Aadhar Number">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.aadharNumber}
                onChange={(e) => onChange("aadharNumber", e.target.value)}
              />
            </Field>
            <Field label="PAN Number">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.panNumber}
                onChange={(e) => onChange("panNumber", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Bank Name">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.bankName}
                onChange={(e) => onChange("bankName", e.target.value)}
              />
            </Field>
            <Field label="Account Number">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.bankAccountNumber}
                onChange={(e) => onChange("bankAccountNumber", e.target.value)}
              />
            </Field>
            <Field label="IFSC Code">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.bankIfsc}
                onChange={(e) => onChange("bankIfsc", e.target.value)}
              />
            </Field>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white"
            >
              Save
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Change Password</h3>
        </div>
        {pwErr && (
          <div className="mx-6 mt-4 rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
            {pwErr}
          </div>
        )}
        {pwOk && (
          <div className="mx-6 mt-4 rounded-md border border-success/20 bg-success/10 px-4 py-2 text-sm text-success">
            {pwOk}
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPwErr(null);
            setPwOk(null);
            if (newPassword !== confirmPassword) {
              setPwErr("Passwords do not match");
              return;
            }
            setPwLoading(true);
            try {
              await api.post("/auth/change-password", {
                currentPassword,
                newPassword,
              });
              setPwOk("Password updated");
              setCurrentPassword("");
              setNewPassword("");
              setConfirmPassword("");
            } catch (e: any) {
              setPwErr(e?.response?.data?.error || "Failed to change password");
            } finally {
              setPwLoading(false);
            }
          }}
          className="px-6 py-5 space-y-5"
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Current password">
              <input
                type="password"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </Field>
            <Field label="New password (min 6 chars)">
              <input
                type="password"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                required
              />
            </Field>
            <Field label="Confirm password">
              <input
                type="password"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={6}
                required
              />
            </Field>
          </div>
          <div className="pt-2">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white"
              disabled={pwLoading}
            >
              {pwLoading ? "..." : "Update password"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
