import { useState, useEffect, FormEvent } from "react";
import { api } from "../../lib/api";
import { toast } from 'react-hot-toast';

type FormState = {
  totalAnnual: string;
  ratePerMonth: string;
  capsPaid: string;
  capsCasual: string;
  capsSick: string;
};

type Holiday = {
  date: string;
  name?: string;
};

type DayOverride = {
  date: string; // yyyy-mm-dd
  type: 'WORKING' | 'HOLIDAY' | 'HALF_DAY';
  note?: string;
};

export default function LeaveSettings() {
  const [form, setForm] = useState<FormState>({ totalAnnual: "0", ratePerMonth: "0", capsPaid: "0", capsCasual: "0", capsSick: "0" });
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [hForm, setHForm] = useState<Holiday>({ date: "", name: "" });
  const [hSubmitting, setHSubmitting] = useState(false);
  const [hErr, setHErr] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  // Company Day Overrides
  const [ovMonth, setOvMonth] = useState<string>(new Date().toISOString().slice(0,7));
  const [overrides, setOverrides] = useState<DayOverride[]>([]);
  const [ovForm, setOvForm] = useState<DayOverride>({ date: "", type: 'WORKING', note: '' });
  const [ovSubmitting, setOvSubmitting] = useState(false);
  const [ovErr, setOvErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/leave-policy");
        const p = res.data.leavePolicy || {};
        setForm({
          totalAnnual: String(p.totalAnnual ?? 0),
          ratePerMonth: String(p.ratePerMonth ?? 0),
          capsPaid: String(p.typeCaps?.paid ?? 0),
          capsCasual: String(p.typeCaps?.casual ?? 0),
          capsSick: String(p.typeCaps?.sick ?? 0),
        });
      } catch {
        // ignore
      }
      try {
        const res = await api.get("/companies/bank-holidays");
        setHolidays(res.data.bankHolidays || []);
      } catch {
        // ignore
      }
      try {
        const m = new Date().toISOString().slice(0,7);
        const res = await api.get("/companies/day-overrides", { params: { month: m } });
        setOverrides(res.data.overrides || []);
        setOvMonth(m);
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
        totalAnnual: parseInt(form.totalAnnual, 10) || 0,
        ratePerMonth: parseFloat(form.ratePerMonth) || 0,
        typeCaps: {
          paid: parseInt(form.capsPaid, 10) || 0,
          casual: parseInt(form.capsCasual, 10) || 0,
          sick: parseInt(form.capsSick, 10) || 0,
        },
      });
      setOk("Leave policy updated");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to update leave policy");
    } finally {
      setSubmitting(false);
    }
  }

  function onHolidayChange<K extends keyof Holiday>(key: K, value: Holiday[K]) {
    setHForm((prev) => ({ ...prev, [key]: value }));
  }

  async function addHoliday(e: FormEvent) {
    e.preventDefault();
    setHErr(null);
    try {
      setHSubmitting(true);
      const res = await api.post("/companies/bank-holidays", {
        date: hForm.date,
        name: hForm.name,
      });
      setHolidays(res.data.bankHolidays || []);
      setHForm({ date: "", name: "" });
    } catch (e: any) {
      setHErr(e?.response?.data?.error || "Failed to add bank holiday");
    } finally {
      setHSubmitting(false);
    }
  }

  async function loadOverrides(month: string) {
    try {
      const res = await api.get("/companies/day-overrides", { params: { month } });
      setOverrides(res.data.overrides || []);
    } catch (e) {
      // ignore
    }
  }

  function onOvChange<K extends keyof DayOverride>(key: K, value: DayOverride[K]) {
    setOvForm((prev) => ({ ...prev, [key]: value }));
  }

  async function addOverride(e: FormEvent) {
    e.preventDefault();
    setOvErr(null);
    try {
      setOvSubmitting(true);
      const res = await api.post("/companies/day-overrides", {
        date: ovForm.date,
        type: ovForm.type,
        note: ovForm.note,
      });
      setOverrides(res.data.overrides || []);
      setOvForm({ date: "", type: 'WORKING', note: '' });
    } catch (e: any) {
      setOvErr(e?.response?.data?.error || "Failed to save override");
    } finally {
      setOvSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Leave Settings</h2>
        <p className="text-sm text-muted">Manage default leave allocation.</p>
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
          <h3 className="text-lg font-semibold">Leave Policy</h3>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Total Annual Leaves">
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.totalAnnual}
                onChange={(e) => onChange("totalAnnual", e.target.value)}
              />
            </Field>
            <Field label="Accrual Per Month">
              <input
                type="number" step="0.5"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.ratePerMonth}
                onChange={(e) => onChange("ratePerMonth", e.target.value)}
              />
            </Field>
            <div />
          </div>

          <div className="grid gap-4 md:grid-cols-3 border-t border-border pt-5 mt-2">
            <Field label="Paid Cap (from total)">
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.capsPaid}
                onChange={(e) => onChange("capsPaid", e.target.value)}
              />
            </Field>
            <Field label="Casual Cap (from total)">
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.capsCasual}
                onChange={(e) => onChange("capsCasual", e.target.value)}
              />
            </Field>
            <Field label="Sick Cap (from total)">
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.capsSick}
                onChange={(e) => onChange("capsSick", e.target.value)}
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
            <button
              type="button"
              disabled={resetting}
              onClick={async () => {
                setResetMsg(null);
                if (!window.confirm('Reset all employees\' leave balances? This will zero out usage and pool, then re-accrue to current month.')) return;
                try {
                  setResetting(true);
                  const res = await api.post('/companies/leave-balances/reset', { reaccrue: true });
                  setResetMsg(`Reset completed for ${res.data.count || 0} employees.`);
                } catch (e: any) {
                  setResetMsg(e?.response?.data?.error || 'Failed to reset leave balances');
                } finally {
                  setResetting(false);
                }
              }}
              className="ml-3 inline-flex items-center justify-center rounded-md border border-error/30 bg-error/10 px-4 py-2 text-error hover:bg-error/15 disabled:opacity-60"
            >
              {resetting ? 'Resetting…' : 'Reset Leave Balances'}
            </button>
            {resetMsg && (
              <span className="ml-3 text-sm text-muted">{resetMsg}</span>
            )}
          </div>
        </form>
      </section>

      {hErr && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {hErr}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Bank Holidays</h3>
        </div>
        <div className="px-6 py-5 space-y-5">
          <ul className="list-disc pl-6 space-y-1">
            {holidays.length === 0 && (
              <li className="list-none text-sm text-muted">No holidays added.</li>
            )}
            {holidays.map((h) => (
              <li key={h.date}>
                {new Date(h.date).toLocaleDateString()}
                {h.name ? ` - ${h.name}` : ""}
              </li>
            ))}
          </ul>
          <form
            onSubmit={addHoliday}
            className="grid gap-4 md:grid-cols-3 items-end"
          >
            <div className="space-y-2">
              <label className="text-sm font-medium">Date</label>
              <input
                type="date"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={hForm.date}
                onChange={(e) => onHolidayChange("date", e.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Name</label>
              <input
                type="text"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={hForm.name}
                onChange={(e) => onHolidayChange("name", e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={hSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {hSubmitting ? "Adding..." : "Add"}
            </button>
          </form>
        </div>
      </section>

      {ovErr && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {ovErr}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Day Overrides</h3>
          <div className="inline-flex items-center gap-2">
            <label className="text-sm text-muted">Month</label>
            <input
              type="month"
              value={ovMonth}
              onChange={async (e) => { setOvMonth(e.target.value); await loadOverrides(e.target.value); }}
              className="rounded-md border border-border bg-surface px-3 py-2"
            />
          </div>
        </div>
        <div className="px-6 py-5 space-y-5">
          <p className="text-sm text-muted">Declare exceptions: mark a working day as Holiday or Half-Day; or lift a weekend/bank holiday as Working.</p>
          <ul className="list-disc pl-6 space-y-1">
            {overrides.length === 0 && (
              <li className="list-none text-sm text-muted">No overrides for {ovMonth}.</li>
            )}
            {overrides.map((o) => (
              <li key={o.date} className="flex items-center justify-between gap-3">
                <div>
                  {new Date(o.date).toLocaleDateString()} — {o.type.replace('_',' ')}{o.note ? `: ${o.note}` : ''}
                </div>
                <button
                  className="text-xs rounded-md border border-border px-2 py-1 hover:bg-bg"
                  onClick={async () => {
                    try {
                      await api.delete(`/companies/day-overrides/${o.date}`);
                      await loadOverrides(ovMonth);
                    } catch {
                      toast.error('Failed to delete override');
                    }
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <form onSubmit={addOverride} className="grid gap-4 md:grid-cols-4 items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium">Date</label>
              <input
                type="date"
                value={ovForm.date}
                onChange={(e) => onOvChange('date', e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <select
                value={ovForm.type}
                onChange={(e) => onOvChange('type', e.target.value as DayOverride['type'])}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="WORKING">Working Day</option>
                <option value="HOLIDAY">Holiday</option>
                <option value="HALF_DAY">Half-Day</option>
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Note (optional)</label>
              <input
                type="text"
                value={ovForm.note || ''}
                onChange={(e) => onOvChange('note', e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g., Special working Saturday"
              />
            </div>
            <button
              type="submit"
              disabled={ovSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {ovSubmitting ? 'Saving...' : 'Save'}
            </button>
          </form>
        </div>
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
