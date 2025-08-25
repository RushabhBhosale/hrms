import { useEffect, useMemo, useState, FormEvent } from "react";
import { api } from "../../lib/api";

type Company = {
  _id: string;
  name: string;
  admin?: { name: string; email: string };
};

export default function AddCompany() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submittingExisting, setSubmittingExisting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [existingCompany, setExistingCompany] = useState("");
  const [newAdminName, setNewAdminName] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");

  function resetAlerts() {
    setErr(null);
    setOk(null);
  }

  async function load() {
    try {
      setLoading(true);
      const res = await api.get("/companies");
      setCompanies(res.data.companies);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load companies");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const companiesWithoutAdmin = useMemo(
    () => companies.filter((c) => !c.admin),
    [companies]
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    resetAlerts();
    setSubmitting(true);
    try {
      await api.post("/companies", {
        companyName: companyName.trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
      });
      setCompanyName("");
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
      setOk("Company and admin created");
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to create company");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitExisting(e: FormEvent) {
    e.preventDefault();
    resetAlerts();
    setSubmittingExisting(true);
    try {
      await api.post(`/companies/${existingCompany}/admin`, {
        adminName: newAdminName.trim(),
        adminEmail: newAdminEmail.trim(),
        adminPassword: newAdminPassword,
      });
      setExistingCompany("");
      setNewAdminName("");
      setNewAdminEmail("");
      setNewAdminPassword("");
      setOk("Admin assigned to company");
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to assign admin");
    } finally {
      setSubmittingExisting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Companies</h2>
        <p className="text-sm text-muted">
          Create a company or assign an admin.
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

      <div className="grid gap-8 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface shadow-sm">
          <div className="border-b border-border px-6 py-4">
            <h3 className="text-lg font-semibold">Create Company</h3>
          </div>
          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            <Field
              label="Company Name"
              value={companyName}
              onChange={setCompanyName}
              placeholder="Acme Corp"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Admin Name"
                value={adminName}
                onChange={setAdminName}
                placeholder="Jane Doe"
              />
              <Field
                label="Admin Email"
                type="email"
                value={adminEmail}
                onChange={setAdminEmail}
                placeholder="jane@acme.com"
              />
            </div>
            <Field
              label="Admin Password"
              type="password"
              value={adminPassword}
              onChange={setAdminPassword}
              placeholder="••••••••"
            />
            <div className="pt-2">
              <button
                type="submit"
                disabled={
                  submitting ||
                  !companyName ||
                  !adminName ||
                  !adminEmail ||
                  !adminPassword
                }
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
              >
                {submitting ? "Creating…" : "Add Company"}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-border bg-surface shadow-sm">
          <div className="border-b border-border px-6 py-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Assign Admin</h3>
            <span className="text-xs text-muted">
              {loading
                ? "Loading…"
                : `${companiesWithoutAdmin.length} without admin`}
            </span>
          </div>
          <form onSubmit={submitExisting} className="px-6 py-5 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Company</label>
              <select
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={existingCompany}
                onChange={(e) => setExistingCompany(e.target.value)}
              >
                <option value="">Select Company</option>
                {companiesWithoutAdmin.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Admin Name"
                value={newAdminName}
                onChange={setNewAdminName}
                placeholder="John Smith"
              />
              <Field
                label="Admin Email"
                type="email"
                value={newAdminEmail}
                onChange={setNewAdminEmail}
                placeholder="john@acme.com"
              />
            </div>
            <Field
              label="Admin Password"
              type="password"
              value={newAdminPassword}
              onChange={setNewAdminPassword}
              placeholder="••••••••"
            />
            <div className="pt-2">
              <button
                type="submit"
                disabled={
                  submittingExisting ||
                  !existingCompany ||
                  !newAdminName ||
                  !newAdminEmail ||
                  !newAdminPassword
                }
                className="inline-flex items-center justify-center rounded-md bg-secondary px-4 py-2 text-white disabled:opacity-60"
              >
                {submittingExisting ? "Assigning…" : "Add Admin"}
              </button>
            </div>
          </form>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">All Companies</h3>
        </div>
        <div className="divide-y divide-border">
          {loading ? (
            <div className="px-6 py-4 text-sm text-muted">Loading…</div>
          ) : companies.length === 0 ? (
            <div className="px-6 py-4 text-sm text-muted">
              No companies yet.
            </div>
          ) : (
            companies.map((c) => (
              <div
                key={c._id}
                className="px-6 py-3 flex items-center justify-between"
              >
                <div className="font-medium">{c.name}</div>
                <div className="text-sm text-muted">
                  {c.admin
                    ? `Admin: ${c.admin.name} (${c.admin.email})`
                    : "No admin"}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <input
        className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
