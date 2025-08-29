import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

type FieldType = "text" | "number" | "date";
type Field = { key: string; label: string; type: FieldType; required: boolean };

export default function MySalarySlip() {
  const today = new Date();
  const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState<string>(ym);
  const [template, setTemplate] = useState<Field[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await api.get(`/salary/slips/mine`, { params: { month } });
        const tpl: Field[] = (res.data.template?.fields || []) as Field[];
        setTemplate(tpl);
        const v = res.data.slip?.values || {};
        setValues({ ...Object.fromEntries(Object.entries(v)) });
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load salary slip");
      } finally {
        setLoading(false);
      }
    })();
  }, [month]);

  const hasData = useMemo(() => Object.keys(values || {}).length > 0, [values]);

  if (loading) return <div>Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">My Salary Slip</h2>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2"
        />
      </div>
      {err && <div className="text-error text-sm">{err}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {template.length === 0 && (
          <div className="text-sm text-muted">No salary template configured yet.</div>
        )}
        {template.map((f) => (
          <div key={f.key} className="border border-border rounded-md p-3 bg-surface">
            <div className="text-xs text-muted">{f.label}</div>
            <div className="text-base">{formatValue(values[f.key])}</div>
          </div>
        ))}
      </div>
      {!hasData && template.length > 0 && (
        <div className="text-sm text-muted">No values filled for this month yet.</div>
      )}
    </div>
  );
}

function formatValue(v: any) {
  if (v === undefined || v === null || v === "") return "-";
  return String(v);
}

