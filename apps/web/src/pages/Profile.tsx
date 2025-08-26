import { useEffect, useState, FormEvent } from "react";
import { api } from "../lib/api";

interface FormState {
  aadharNumber: string;
  panNumber: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
}

export default function Profile() {
  const [form, setForm] = useState<FormState>({
    aadharNumber: "",
    panNumber: "",
    bankName: "",
    bankAccountNumber: "",
    bankIfsc: "",
  });
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/auth/me");
        const emp = res.data.employee || {};
        setForm({
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
      await api.put("/auth/me", {
        aadharNumber: form.aadharNumber,
        panNumber: form.panNumber,
        bankName: form.bankName,
        bankAccountNumber: form.bankAccountNumber,
        bankIfsc: form.bankIfsc,
      });
      setOk("Profile updated");
    } catch {
      setErr("Failed to update profile");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Profile</h2>
        <p className="text-sm text-muted">Update your details.</p>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-red-50 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}
      {ok && (
        <div className="rounded-md border border-success/20 bg-green-50 px-4 py-2 text-sm text-success">
          {ok}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Personal Information</h3>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-5">
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
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

