import { FormEvent, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";

export default function RegisterCompany() {
  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      await api.post("/companies/register", {
        companyName: companyName.trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
      });
      setSuccess(
        "Thanks! Your registration was submitted. A superadmin will review it shortly."
      );
      setCompanyName("");
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to submit registration");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-bg text-text">
      {/* Hero */}
      <header className="sticky top-0 z-30 bg-surface/70 backdrop-blur border-b border-border">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
          <Link to="/" className="text-xl font-extrabold tracking-wide">
            HRMS
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link
              to="/login"
              className="inline-flex h-9 items-center justify-center rounded-md px-3 border border-border hover:bg-bg"
            >
              Login
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 md:py-16">
        <div className="flex items-center justify-center">
          <section className="bg-white rounded-lg border border-border shadow-sm p-6">
            <h2 className="text-xl font-semibold">Register your company</h2>
            <p className="text-sm text-muted mt-1">
              Submit your details and we’ll notify your admin after approval.
            </p>

            {error && (
              <div className="mt-4 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                {error}
              </div>
            )}
            {success && (
              <div className="mt-4 rounded-md border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">
                {success}
              </div>
            )}

            <form onSubmit={submit} className="mt-6 space-y-4">
              <Field
                label="Company Name"
                placeholder="Peracto Corporation"
                value={companyName}
                onChange={setCompanyName}
              />
              <div className="grid sm:grid-cols-2 gap-4">
                <Field
                  label="Admin Name"
                  placeholder="Jane Doe"
                  value={adminName}
                  onChange={setAdminName}
                />
                <Field
                  label="Admin Email"
                  placeholder="jane@Peracto.com"
                  type="email"
                  value={adminEmail}
                  onChange={setAdminEmail}
                />
              </div>
              <Field
                label="Admin Password"
                placeholder="••••••••"
                type="password"
                value={adminPassword}
                onChange={setAdminPassword}
              />

              <button
                type="submit"
                disabled={
                  loading ||
                  !companyName ||
                  !adminName ||
                  !adminEmail ||
                  !adminPassword
                }
                className="w-full inline-flex items-center justify-center rounded-md bg-primary text-white h-10 disabled:opacity-60"
              >
                {loading ? "Submitting…" : "Submit Registration"}
              </button>
              <p className="text-xs text-muted text-center">
                Already approved?{" "}
                <Link to="/login" className="underline">
                  Login
                </Link>
              </p>
            </form>
          </section>
        </div>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted">
        © {new Date().getFullYear()} HRMS — All rights reserved.
      </footer>
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
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <input
        className="w-full rounded-md border border-border bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Check() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
