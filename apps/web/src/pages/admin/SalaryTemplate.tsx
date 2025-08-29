import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

type FieldType = "text" | "number" | "date";
type FieldCategory = "earning" | "deduction" | "info";
type Field = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  defaultValue?: any;
  order?: number;
  category?: FieldCategory;
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
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
        setFields(
          f
            .map((fld) => ({
              ...fld,
              category: (fld.category as FieldCategory) || "info",
            }))
            .sort((a, b) => (a.order || 0) - (b.order || 0))
        );
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
      {
        key: "",
        label: "",
        type: "text",
        required: false,
        defaultValue: "",
        category: "info",
      },
    ]);
  }

  function updateField(i: number, patch: Partial<Field>) {
    setFields((prev) =>
      prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f))
    );
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

  const { hasDuplicateKeys, duplicateSet } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of fields) {
      const k = (f.key || "").trim();
      if (!k) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const dupes = new Set<string>(
      [...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k)
    );
    return { hasDuplicateKeys: dupes.size > 0, duplicateSet: dupes };
  }, [fields]);

  if (loading) return <div>Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold">Salary Template</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={hasDuplicateKeys}
            className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-50"
            title={hasDuplicateKeys ? "Fix duplicate keys to save" : undefined}
          >
            Save
          </button>
          <button
            onClick={addField}
            className="rounded-md border border-border px-4 py-2 bg-bg"
          >
            Add Field
          </button>
        </div>
      </div>

      {err && <div className="text-error text-sm">{err}</div>}
      {ok && <div className="text-success text-sm">{ok}</div>}
      {hasDuplicateKeys && (
        <div className="text-error text-sm">
          Duplicate keys detected. Please ensure each key is unique.
        </div>
      )}

      <div className="space-y-3">
        {fields.map((f, i) => {
          const isDup = f.key && duplicateSet.has(f.key);
          return (
            <div
              key={i}
              className="grid md:grid-cols-12 grid-cols-12 gap-3 items-start border border-border rounded-md p-3 bg-surface"
            >
              {/* Label */}
              <div className="col-span-12 md:col-span-3 min-w-0">
                <label className="text-xs text-muted block mb-1 whitespace-nowrap">
                  Label
                </label>
                <input
                  value={f.label}
                  onChange={(e) =>
                    updateField(i, {
                      label: e.target.value,
                      key: f.key || slugify(e.target.value),
                    })
                  }
                  className="w-full min-w-0 rounded-md border border-border bg-bg px-3 py-2"
                  placeholder="e.g. Basic Pay"
                />
              </div>

              {/* Key */}
              <div className="col-span-12 md:col-span-3 min-w-0">
                <label className="text-xs text-muted block mb-1 whitespace-nowrap">
                  Key
                </label>
                <input
                  value={f.key}
                  onChange={(e) =>
                    updateField(i, { key: slugify(e.target.value) })
                  }
                  className={`w-full min-w-0 rounded-md px-3 py-2 border ${
                    isDup ? "border-error" : "border-border"
                  } bg-bg`}
                  placeholder="basic_pay"
                />
                {isDup && (
                  <div className="mt-1 text-[11px] text-error">
                    This key duplicates another field.
                  </div>
                )}
              </div>

              {/* Type */}
              <div className="col-span-6 md:col-span-2 min-w-0">
                <label className="text-xs text-muted block mb-1 whitespace-nowrap">
                  Type
                </label>
                <select
                  value={f.type}
                  onChange={(e) =>
                    updateField(i, {
                      type: e.target.value as FieldType,
                      defaultValue: "",
                    })
                  }
                  className="w-full min-w-0 rounded-md border border-border bg-bg px-3 py-2"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                </select>
              </div>

              {/* Category */}
              <div className="col-span-6 md:col-span-2 min-w-0">
                <label className="text-xs text-muted block mb-1 whitespace-nowrap">
                  Category
                </label>
                <select
                  value={f.category || "info"}
                  onChange={(e) =>
                    updateField(i, {
                      category: e.target.value as FieldCategory,
                    })
                  }
                  className="w-full min-w-0 rounded-md border border-border bg-bg px-3 py-2"
                >
                  <option value="info">Info</option>
                  <option value="earning">Earning</option>
                  <option value="deduction">Deduction</option>
                </select>
              </div>

              {/* Default + Required */}
              <div className="col-span-12 md:col-span-2 min-w-0">
                <label className="text-xs text-muted block mb-1 whitespace-nowrap">
                  Default
                </label>
                <input
                  type={
                    f.type === "number"
                      ? "number"
                      : f.type === "date"
                      ? "date"
                      : "text"
                  }
                  value={f.defaultValue ?? ""}
                  onChange={(e) =>
                    updateField(i, {
                      defaultValue:
                        f.type === "number"
                          ? e.target.value === ""
                            ? ""
                            : Number(e.target.value)
                          : e.target.value,
                    })
                  }
                  className="w-full min-w-0 rounded-md border border-border bg-bg px-3 py-2"
                />
                <label className="mt-2 inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!f.required}
                    onChange={(e) =>
                      updateField(i, { required: e.target.checked })
                    }
                  />
                  Required
                </label>
              </div>

              {/* Actions row (own grid row so md sum stays 12) */}
              <div className="col-span-12 flex items-center justify-end gap-3">
                <div className="flex items-center gap-2">
                  <button
                    className="text-sm underline disabled:opacity-40"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    className="text-sm underline disabled:opacity-40"
                    onClick={() => move(i, 1)}
                    disabled={i === fields.length - 1}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    className="text-sm text-error underline"
                    onClick={() => removeField(i)}
                    title="Remove field"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
