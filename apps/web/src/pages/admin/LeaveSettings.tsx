import { useState, useEffect, FormEvent } from "react";
import { api } from "../../lib/api";

type FormState = {
  casual: string;
  paid: string;
  sick: string;
};

export default function LeaveSettings() {
  const [form, setForm] = useState<FormState>({
    casual: "0",
    paid: "0",
    sick: "0",
  });
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/leave-policy");
        const p = res.data.leavePolicy || {};
        setForm({
          casual: String(p.casual ?? 0),
          paid: String(p.paid ?? 0),
          sick: String(p.sick ?? 0),
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
      setSubmitting(true);
      await api.put("/companies/leave-policy", {
        casual: parseInt(form.casual, 10) || 0,
        paid: parseInt(form.paid, 10) || 0,
        sick: parseInt(form.sick, 10) || 0,
      });
      setOk("Leave policy updated");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to update leave policy");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Leave Settings</h2>
        <p className="text-sm text-muted">Manage default leave allocation.</p>
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
          <h3 className="text-lg font-semibold">Leave Policy</h3>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Casual Leaves">
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.casual}
                onChange={(e) => onChange("casual", e.target.value)}
              />
            </Field>
            <Field label="Paid Leaves">
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.paid}
                onChange={(e) => onChange("paid", e.target.value)}
              />
            </Field>
            <Field label="Sick Leaves">
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.sick}
                onChange={(e) => onChange("sick", e.target.value)}
              />
            </Field>
          </div>
          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Save"}
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

