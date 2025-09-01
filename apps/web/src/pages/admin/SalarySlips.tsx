import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

type EmployeeLite = { id: string; name: string; email: string };
type FieldType = "text" | "number" | "date";
type Field = { key: string; label: string; type: FieldType; required: boolean; defaultValue?: any; order?: number };

export default function SalarySlipsAdmin() {
  const today = new Date();
  const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState<string>(ym);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [template, setTemplate] = useState<Field[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // load employees and template
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [emps, tpl] = await Promise.all([
          api.get("/companies/employees"),
          api.get("/salary/templates"),
        ]);
        const list: EmployeeLite[] = (emps.data.employees || []).map((e: any) => ({ id: e.id, name: e.name, email: e.email }));
        setEmployees(list);
        setTemplate((tpl.data.template?.fields || []) as Field[]);
        if (!employeeId && list.length) setEmployeeId(list[0].id);
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load slip when filters change
  useEffect(() => {
    (async () => {
      if (!employeeId || !month) return;
      try {
        setErr(null);
        setOk(null);
        const res = await api.get(`/salary/slips`, { params: { employeeId, month } });
        const tpl: Field[] = (res.data.template?.fields || []) as Field[];
        setTemplate(tpl);
        const v = res.data.slip?.values || {};
        setValues({ ...Object.fromEntries(Object.entries(v)) });
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load slip");
      }
    })();
  }, [employeeId, month]);

  function setValue(key: string, val: any) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  async function save() {
    try {
      setSaving(true);
      setErr(null);
      setOk(null);
      await api.post("/salary/slips", { employeeId, month, values });
      setOk("Saved");
    } catch (e: any) {
      const msg = e?.response?.data?.missing?.length
        ? `Missing required: ${e.response.data.missing.join(', ')}`
        : (e?.response?.data?.error || "Failed to save");
      setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  async function downloadPdf() {
    try {
      setDownloading(true);
      const res = await api.get(`/salary/slips/pdf`, { params: { employeeId, month }, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const emp = employees.find((e) => e.id === employeeId);
      const namePart = emp ? emp.name.replace(/[^a-z0-9\-_.]+/gi, '_') : employeeId;
      await downloadFileBlob(blob, `SalarySlip-${namePart}-${month}.pdf`);
    } catch (e) {
      console.error(e);
      alert('Failed to download PDF');
    } finally {
      setDownloading(false);
    }
  }

  const requiredMissing = useMemo(() => {
    return (template || [])
      .filter((f) => f.required)
      .some((f) => values[f.key] === undefined || values[f.key] === null || values[f.key] === "");
  }, [template, values]);

  if (loading) return <div>Loading…</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Salary Slips</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-muted">Employee</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2"
          >
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.email})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </div>
      </div>

      <div>
        <button
          onClick={downloadPdf}
          disabled={!employeeId || !month || downloading}
          className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-50"
        >
          {downloading ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>

      {err && <div className="text-error text-sm">{err}</div>}
      {ok && <div className="text-success text-sm">{ok}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(template || []).map((f) => (
          <div key={f.key} className="space-y-1">
            <label className="text-sm font-medium">
              {f.label} {f.required && <span className="text-error">*</span>}
            </label>
            <InputByType field={f} value={values[f.key] ?? f.defaultValue ?? ''} onChange={(v) => setValue(f.key, v)} />
          </div>
        ))}
      </div>

      <div>
        <button
          onClick={save}
          disabled={saving || requiredMissing}
          className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function InputByType({ field, value, onChange }: { field: Field; value: any; onChange: (v: any) => void }) {
  const common = "w-full rounded-md border border-border bg-surface px-3 py-2";
  if (field.type === 'number') {
    return (
      <input
        type="number"
        value={value === undefined || value === null ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className={common}
      />
    );
  }
  if (field.type === 'date') {
    return (
      <input
        type="date"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={common}
      />
    );
  }
  return (
    <input
      type="text"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className={common}
    />
  );
}

async function downloadFileBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 0);
}
