import { useState, FormEvent, ChangeEvent, useMemo, useEffect } from "react";
import { api } from "../../lib/api";

type FormState = {
  name: string;
  email: string;
  password: string;
  role: string;
  address: string;
  phone: string;
  dob: string;
  reportingPerson: string;
  employeeId: string;
  ctc: string; // monthly CTC
};

export default function AddEmployee() {
  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    password: "",
    role: "",
    address: "",
    phone: "",
    dob: "",
    reportingPerson: "",
    employeeId: "",
    ctc: "",
  });
  const [docs, setDocs] = useState<FileList | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>(
    []
  );
  const [roles, setRoles] = useState<string[]>([]);

  const canSubmit = useMemo(() => {
    return (
      form.name.trim() &&
      form.email.trim() &&
      form.password &&
      form.role &&
      form.address.trim() &&
      form.phone.trim() &&
      form.employeeId.trim() &&
      form.ctc.trim() && !isNaN(Number(form.ctc)) && Number(form.ctc) >= 0
    );
  }, [form]);

  function onChange<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/employees");
        setEmployees(res.data.employees || []);
      } catch {
        // ignore
      }
      try {
        const r = await api.get("/companies/roles");
        setRoles(r.data.roles || []);
        if (r.data.roles?.length)
          setForm((f) => ({ ...f, role: r.data.roles[0] }));
      } catch {
        // ignore
      }
    })();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setOk(null);
    setErr(null);
    if (!canSubmit) return;
    try {
      setSubmitting(true);
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)));
      if (docs) Array.from(docs).forEach((f) => fd.append("documents", f));
      await api.post("/companies/employees", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setForm({
        name: "",
        email: "",
        password: "",
        role: roles[0] || "",
        address: "",
        phone: "",
        dob: "",
        reportingPerson: "",
        employeeId: "",
        ctc: "",
      });
      setDocs(null);
      setOk("Employee added");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to add employee");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Add Employee</h2>
        <p className="text-sm text-muted">
          Create an employee and upload documents.
        </p>
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
          <h3 className="text-lg font-semibold">Employee Details</h3>
        </div>

        <form
          onSubmit={submit}
          className="px-6 py-5 space-y-5"
          encType="multipart/form-data"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="Jane Doe"
                value={form.name}
                onChange={(e) => onChange("name", e.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="jane@Peracto.com"
                value={form.email}
                onChange={(e) => onChange("email", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Password">
              <input
                type="password"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => onChange("password", e.target.value)}
              />
            </Field>

            <Field label="Role">
              <select
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.role}
                onChange={(e) => onChange("role", e.target.value)}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Reporting Person">
              <select
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.reportingPerson}
                onChange={(e) => onChange("reportingPerson", e.target.value)}
              >
                <option value="">None</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Employee ID">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="EMP001"
                value={form.employeeId}
                onChange={(e) => onChange("employeeId", e.target.value)}
              />
            </Field>
            <Field label="CTC (Monthly)">
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. 50000"
                value={form.ctc}
                onChange={(e) => onChange("ctc", e.target.value)}
                min={0}
                step="0.01"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Address">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="Street, City, ZIP"
                value={form.address}
                onChange={(e) => onChange("address", e.target.value)}
              />
            </Field>
            <Field label="Phone">
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="+91 98765 43210"
                value={form.phone}
                onChange={(e) => onChange("phone", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
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
            <Field label="Documents">
              <label className="flex h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-bg px-3 text-sm text-muted hover:bg-bg/70">
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setDocs(e.target.files)
                  }
                />
                <span>Click to upload or drag & drop</span>
                <span className="text-xs">PNG, JPG, PDF up to 10MB each</span>
              </label>
              {!!docs && (
                <ul className="mt-2 space-y-1 text-sm text-muted">
                  {Array.from(docs).map((f, i) => (
                    <li key={i} className="truncate">
                      {f.name}
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={!canSubmit || submitting}
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
