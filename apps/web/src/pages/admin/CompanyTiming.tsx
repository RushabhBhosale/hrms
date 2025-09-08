import { useEffect, useState, FormEvent } from "react";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";
import { Field } from "../../components/ui/Field";

type WorkHours = {
  start: string; // HH:mm
  end: string; // HH:mm
  graceMinutes: number;
};

export default function CompanyTiming() {
  const [form, setForm] = useState<WorkHours>({
    start: "09:30",
    end: "18:30",
    graceMinutes: 0,
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/work-hours");
        const wh = res.data.workHours || {};
        setForm({
          start: wh.start || "",
          end: wh.end || "",
          graceMinutes: wh.graceMinutes ?? 0,
        });
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn(e?.response?.data?.error || e?.message || e);
        toast.error(e?.response?.data?.error || "Failed to load work hours");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function onChange<K extends keyof WorkHours>(key: K, value: WorkHours[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setOk(null);
    setErr(null);
    try {
      setSubmitting(true);
      await api.put("/companies/work-hours", {
        start: form.start,
        end: form.end,
        graceMinutes: Number(form.graceMinutes) || 0,
      });
      setOk("Company work hours updated");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to update work hours";
      setErr(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div>Loading…</div>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Company Timing</h2>
        <p className="text-sm text-muted">
          Configure default work hours and grace period.
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

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Work Hours</h3>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Start Time">
              <input
                type="time"
                value={form.start}
                onChange={(e) => onChange("start", e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </Field>
            <Field label="End Time">
              <input
                type="time"
                value={form.end}
                onChange={(e) => onChange("end", e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </Field>
            <Field label="Grace Minutes">
              <input
                type="number"
                min={0}
                value={form.graceMinutes}
                onChange={(e) =>
                  onChange("graceMinutes", Number(e.target.value))
                }
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
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
