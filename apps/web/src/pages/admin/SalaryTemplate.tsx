"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";

type FieldType = "text" | "number" | "date";
type FieldCategory = "earning" | "deduction" | "info";
type Field = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  locked?: boolean;
  defaultValue?: any;
  order?: number;
  category?: FieldCategory;
  autoKey?: boolean;
};

type Settings = {
  basicPercent: number;
  hraPercent: number;
  medicalAmount: number;
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
  const [settings, setSettings] = useState<Settings>({
    basicPercent: 30,
    hraPercent: 45,
    medicalAmount: 1500,
  });
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | FieldCategory>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | FieldType>("all");
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/salary/templates");
        const f = (res.data.template?.fields || []) as Field[];
        setFields(
          f
            .map((fld) => ({
              autoKey: !fld.key || fld.key === slugify(fld.label),
              ...fld,
              category: (fld.category as FieldCategory) || "info",
            }))
            .sort((a, b) => (a.order || 0) - (b.order || 0))
        );
        const s = res.data.template?.settings || {};
        setSettings({
          basicPercent: Number.isFinite(Number(s.basicPercent))
            ? Number(s.basicPercent)
            : 30,
          hraPercent: Number.isFinite(Number(s.hraPercent))
            ? Number(s.hraPercent)
            : 45,
          medicalAmount: Number.isFinite(Number(s.medicalAmount))
            ? Number(s.medicalAmount)
            : 1500,
        });
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load template");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const counts = useMemo(() => {
    const c = { total: fields.length, earning: 0, deduction: 0, info: 0 };
    for (const f of fields) c[(f.category as FieldCategory) || "info"]++;
    return c;
  }, [fields]);

  const { hasDuplicateKeys, invalids, duplicateSet } = useMemo(() => {
    const map = new Map<string, number>();
    const invalidIdx: number[] = [];
    fields.forEach((f, i) => {
      const k = (f.key || "").trim();
      if (k) map.set(k, (map.get(k) || 0) + 1);
      if (!f.label.trim() || !k) invalidIdx.push(i);
    });
    const dupes = new Set(
      [...map.entries()].filter(([, c]) => c > 1).map(([k]) => k)
    );
    return {
      hasDuplicateKeys: dupes.size > 0,
      invalids: new Set(invalidIdx),
      duplicateSet: dupes,
    };
  }, [fields]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return fields.filter((f) => {
      if (cat !== "all" && (f.category || "info") !== cat) return false;
      if (typeFilter !== "all" && f.type !== typeFilter) return false;
      if (!qq) return true;
      return (
        f.label.toLowerCase().includes(qq) ||
        (f.key || "").toLowerCase().includes(qq)
      );
    });
  }, [fields, q, cat, typeFilter]);

  const save = useCallback(async () => {
    try {
      setErr(null);
      setOk(null);
      const payload = {
        fields: fields.map((f, i) => ({ ...f, order: i })),
        settings,
      };
      await api.post("/salary/templates", payload);
      setOk("Saved");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to save template");
    }
  }, [fields, settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey as any);
    return () => window.removeEventListener("keydown", onKey as any);
  }, [save]);

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
        autoKey: true,
        order: prev.length,
      },
    ]);
  }

  function updateField(i: number, patch: Partial<Field>) {
    setFields((prev) =>
      prev.map((f, idx) => {
        if (idx !== i) return f;
        const next = { ...f, ...patch };
        if (next.autoKey && "label" in patch)
          next.key = slugify(next.label || "");
        return next;
      })
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

  function onDragStart(idx: number) {
    dragIndex.current = idx;
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function onDrop(idx: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from == null || from === idx) return;
    setFields((prev) => {
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      arr.splice(idx, 0, moved);
      return arr;
    });
  }

  if (loading) return <div>Loading…</div>;

  return (
    <div className="mx-auto w-full max-w-screen-lg space-y-4 px-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Salary Template</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs">
          {counts.total} • {counts.earning} earning • {counts.deduction}{" "}
          deduction • {counts.info} info
        </span>
        <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm sm:w-56"
          />
          <select
            className="h-9 rounded-md border border-border bg-bg px-2 text-sm"
            value={cat}
            onChange={(e) => setCat(e.target.value as any)}
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="earning">Earning</option>
            <option value="deduction">Deduction</option>
          </select>
          <select
            className="h-9 rounded-md border border-border bg-bg px-2 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
          >
            <option value="all">Any Type</option>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
          </select>
          <button
            onClick={addField}
            className="h-9 rounded-md border border-border bg-bg px-3 text-sm"
          >
            Add
          </button>
          <button
            onClick={save}
            disabled={hasDuplicateKeys || invalids.size > 0}
            className="h-9 rounded-md bg-primary px-4 text-sm text-white disabled:opacity-50"
            title={
              hasDuplicateKeys
                ? "Duplicate keys"
                : invalids.size
                ? "Fix empty label/key"
                : undefined
            }
          >
            Save
          </button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-3">
        <div className="mb-2 text-sm font-medium">Default Components</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="mb-1 text-[11px] text-muted">
              Basic Earned (% of CTC)
            </div>
            <input
              type="number"
              value={settings.basicPercent}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  basicPercent: Number(e.target.value),
                }))
              }
              className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm"
              min={0}
              step="0.01"
            />
          </div>
          <div>
            <div className="mb-1 text-[11px] text-muted">HRA (% of Basic)</div>
            <input
              type="number"
              value={settings.hraPercent}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  hraPercent: Number(e.target.value),
                }))
              }
              className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm"
              min={0}
              step="0.01"
            />
          </div>
          <div>
            <div className="mb-1 text-[11px] text-muted">Medical (Flat)</div>
            <input
              type="number"
              value={settings.medicalAmount}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  medicalAmount: Number(e.target.value),
                }))
              }
              className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm"
              min={0}
              step="0.01"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {filtered.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
            No fields match.
          </div>
        )}

        {filtered.map((f, iFiltered) => {
          const i = fields.indexOf(f);
          const isDup = f.key && duplicateSet.has(f.key);
          const isInvalid = invalids.has(i);
          const disabled = !!f.locked;
          return (
            <div
              key={`${f.key}-${i}`}
              className={`rounded-md border bg-surface p-2 ${
                isInvalid ? "border-amber-600" : "border-border"
              }`}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragOver={onDragOver}
              onDrop={() => onDrop(i)}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button className="h-8 w-8 cursor-grab rounded-md border border-border text-xs">
                  ⋮⋮
                </button>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    (f.category || "info") === "earning"
                      ? "bg-emerald-100 text-emerald-800"
                      : (f.category || "info") === "deduction"
                      ? "bg-rose-100 text-rose-800"
                      : "bg-slate-100 text-slate-800"
                  }`}
                >
                  {f.category || "info"}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-800">
                  {f.type}
                </span>
                {f.locked && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
                    locked
                  </span>
                )}
                {isDup && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] text-rose-800">
                    duplicate
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40"
                    onClick={() => move(i, -1)}
                    disabled={i === 0 || disabled}
                  >
                    ↑
                  </button>
                  <button
                    className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40"
                    onClick={() => move(i, 1)}
                    disabled={i === fields.length - 1 || disabled}
                  >
                    ↓
                  </button>
                  <button
                    className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40"
                    onClick={() => updateField(i, { locked: !f.locked })}
                  >
                    {f.locked ? "Unlock" : "Lock"}
                  </button>
                  <button
                    className="rounded-md px-2 py-1 text-xs text-error underline disabled:opacity-40"
                    onClick={() => removeField(i)}
                    disabled={disabled}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-6">
                <div className="md:col-span-3">
                  <div className="mb-1 text-[11px] text-muted">Label</div>
                  <input
                    value={f.label}
                    onChange={(e) =>
                      updateField(i, {
                        label: e.target.value,
                        ...(f.autoKey ? { key: slugify(e.target.value) } : {}),
                      })
                    }
                    disabled={disabled}
                    className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm disabled:opacity-60"
                    placeholder="Basic Pay"
                  />
                </div>

                <div className="md:col-span-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
                    <span>Key</span>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={!!f.autoKey}
                        onChange={(e) =>
                          updateField(i, { autoKey: e.target.checked })
                        }
                      />
                      Auto
                    </label>
                  </div>
                  <input
                    value={f.key}
                    onChange={(e) =>
                      updateField(i, { key: slugify(e.target.value) })
                    }
                    disabled={disabled || !!f.autoKey}
                    className={`h-9 w-full rounded-md border px-3 text-sm ${
                      isDup ? "border-error" : "border-border"
                    } bg-bg disabled:opacity-60`}
                    placeholder="basic_pay"
                  />
                </div>

                <div className="md:col-span-2">
                  <div className="mb-1 text-[11px] text-muted">Type</div>
                  <select
                    value={f.type}
                    onChange={(e) =>
                      updateField(i, {
                        type: e.target.value as FieldType,
                        defaultValue: "",
                      })
                    }
                    disabled={disabled}
                    className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm disabled:opacity-60"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <div className="mb-1 text-[11px] text-muted">Category</div>
                  <select
                    value={f.category || "info"}
                    onChange={(e) =>
                      updateField(i, {
                        category: e.target.value as FieldCategory,
                      })
                    }
                    disabled={disabled}
                    className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm disabled:opacity-60"
                  >
                    <option value="info">Info</option>
                    <option value="earning">Earning</option>
                    <option value="deduction">Deduction</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <div className="mb-1 text-[11px] text-muted">Default</div>
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
                    disabled={disabled}
                    className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm disabled:opacity-60"
                  />
                  <label className="mt-2 inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={!!f.required}
                      onChange={(e) =>
                        updateField(i, { required: e.target.checked })
                      }
                      disabled={disabled}
                    />
                    Required
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {(err || ok || hasDuplicateKeys || invalids.size > 0) && (
        <div className="text-sm">
          {err && <div className="text-error">{err}</div>}
          {ok && <div className="text-success">{ok}</div>}
          {(hasDuplicateKeys || invalids.size > 0) && (
            <div className="text-amber-600">
              {hasDuplicateKeys ? "Duplicate keys. " : ""}
              {invalids.size ? `${invalids.size} field(s) need label/key.` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
