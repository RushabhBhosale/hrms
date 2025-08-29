import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

type FieldType = "text" | "number" | "date";
type Field = { key: string; label: string; type: FieldType; required: boolean; defaultValue?: any; order?: number };

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export default function SalaryTemplate() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [fields, setFields] = useState<Field[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/salary/templates");
        const f = (res.data.template?.fields || []) as Field[];
        setFields(f.sort((a, b) => (a.order || 0) - (b.order || 0)));
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load template");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    try {
      setErr(null);
      setOk(null);
      const payload = { fields: fields.map((f, i) => ({ ...f, order: i })) };
      await api.post("/salary/templates", payload);
      setOk("Template saved");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to save template");
    }
  }

  function addField() {
    setFields((prev) => [
      ...prev,
      { key: "", label: "", type: "text", required: false, defaultValue: "" },
    ]);
  }

  function updateField(i: number, patch: Partial<Field>) {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function removeField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i));
  }

  function move(i: number, dir: -1 | 1) {
    setFields((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  const hasDuplicateKeys = useMemo(() => {
    const seen = new Set<string>();
    for (const f of fields) {
      if (!f.key) continue;
      const k = f.key;
      if (seen.has(k)) return true;
      seen.add(k);
    }
    return false;
  }, [fields]);

  if (loading) return <div>Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Salary Template</h2>
        <button
          onClick={save}
          disabled={hasDuplicateKeys}
          className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {err && <div className="text-error text-sm">{err}</div>}
      {ok && <div className="text-success text-sm">{ok}</div>}
      {hasDuplicateKeys && (
        <div className="text-error text-sm">Duplicate keys detected. Please ensure each key is unique.</div>
      )}
      <div className="space-y-3">
        {fields.map((f, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end border border-border rounded-md p-3 bg-surface">
            <div className="col-span-3">
              <label className="text-xs text-muted">Label</label>
              <input
                value={f.label}
                onChange={(e) => updateField(i, { label: e.target.value, key: f.key || slugify(e.target.value) })}
                className="w-full rounded-md border border-border bg-bg px-3 py-2"
                placeholder="e.g. Basic Pay"
              />
            </div>
            <div className="col-span-3">
              <label className="text-xs text-muted">Key</label>
              <input
                value={f.key}
                onChange={(e) => updateField(i, { key: slugify(e.target.value) })}
                className="w-full rounded-md border border-border bg-bg px-3 py-2"
                placeholder="basic_pay"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted">Type</label>
              <select
                value={f.type}
                onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                className="w-full rounded-md border border-border bg-bg px-3 py-2"
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted">Default</label>
              <input
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                value={f.defaultValue ?? ''}
                onChange={(e) => updateField(i, { defaultValue: f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })}
                className="w-full rounded-md border border-border bg-bg px-3 py-2"
              />
            </div>
            <div className="col-span-1 flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!f.required}
                  onChange={(e) => updateField(i, { required: e.target.checked })}
                />
                Required
              </label>
            </div>
            <div className="col-span-1 flex items-center justify-end gap-2">
              <button className="text-sm underline" onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button className="text-sm underline" onClick={() => move(i, 1)} disabled={i === fields.length - 1}>
                ↓
              </button>
              <button className="text-sm text-error underline" onClick={() => removeField(i)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <div>
        <button onClick={addField} className="rounded-md border border-border px-4 py-2 bg-bg">
          Add Field
        </button>
      </div>
    </div>
  );
}

