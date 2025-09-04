"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

type FieldType = "text" | "number" | "date";
type FieldCategory = "earning" | "deduction" | "info";
type Field = {
  id: string;
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
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const PROTECTED_KEYS = new Set([
  "basic",
  "hra",
  "medical",
  "basic_pay",
  "house_rent_allowance",
]);

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

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/salary/templates");
        const f = (res.data.template?.fields || []) as any[];
        const s = res.data.template?.settings || {};
        const normalized = f
          .map((fld: any, i: number) => {
            const k = fld.key || slugify(fld.label || "");
            const prot =
              PROTECTED_KEYS.has(k) ||
              PROTECTED_KEYS.has(slugify(fld.label || ""));
            return {
              id: fld.id || uid(),
              autoKey: !fld.key || fld.key === slugify(fld.label),
              key: k,
              label: fld.label || "",
              type: (fld.type as FieldType) || "text",
              required: !!fld.required,
              defaultValue: fld.defaultValue ?? "",
              category: (fld.category as FieldCategory) || "info",
              order: Number.isFinite(fld.order) ? fld.order : i,
              locked: fld.locked || prot,
            } as Field;
          })
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        setFields(normalized);
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
        id: uid(),
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
        const prot =
          f.locked ||
          PROTECTED_KEYS.has(f.key) ||
          PROTECTED_KEYS.has(slugify(f.label));
        if (prot) {
          const allowed: Partial<Field> = {};
          if ("defaultValue" in patch)
            allowed.defaultValue = patch.defaultValue;
          if ("category" in patch) allowed.category = patch.category;
          if ("type" in patch) allowed.type = patch.type as FieldType;
          return { ...f, ...allowed, locked: true };
        }
        const next = { ...f, ...patch };
        if (next.autoKey && "label" in patch)
          next.key = slugify(next.label || "");
        return next;
      })
    );
  }

  function removeField(i: number) {
    setFields((prev) => {
      const f = prev[i];
      const prot =
        f.locked ||
        PROTECTED_KEYS.has(f.key) ||
        PROTECTED_KEYS.has(slugify(f.label));
      if (prot) return prev;
      return prev.filter((_, idx) => idx !== i);
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
            className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm sm:w-60"
          />
          <select
            className="h-10 rounded-md border border-border bg-bg px-2 text-sm"
            value={cat}
            onChange={(e) => setCat(e.target.value as any)}
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="earning">Earning</option>
            <option value="deduction">Deduction</option>
          </select>
          <select
            className="h-10 rounded-md border border-border bg-bg px-2 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
          >
            <option value="all">Any Type</option>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
          </select>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
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
              className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm"
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
              className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm"
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
              className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm"
              min={0}
              step="0.01"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 pb-20">
        {filtered.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
            No fields match.
          </div>
        )}

        {filtered.map((f, iFiltered) => {
          const i = fields.indexOf(f);
          const isDup = f.key && duplicateSet.has(f.key);
          const isInvalid = invalids.has(i);
          const prot =
            f.locked ||
            PROTECTED_KEYS.has(f.key) ||
            PROTECTED_KEYS.has(slugify(f.label));
          const disabled = !!prot;

          return (
            <div
              key={f.id}
              className={`rounded-md border bg-surface p-3 ${
                isInvalid ? "border-amber-600" : "border-border"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
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
                {prot && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
                    protected
                  </span>
                )}
                <div className="ml-auto">
                  {!prot && (
                    <button
                      className="rounded-md px-2 py-1 text-xs text-error underline"
                      onClick={() => removeField(i)}
                    >
                      Remove
                    </button>
                  )}
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
                    className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm disabled:opacity-60"
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
                        disabled={disabled}
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
                    className={`h-10 w-full rounded-md border px-3 text-sm ${
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
                    className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm disabled:opacity-60"
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
                    className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm disabled:opacity-60"
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
                    className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 left-0 right-0 z-10 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex max-w-screen-lg items-center gap-2 px-3 py-3">
          {err && <div className="text-xs text-error">{err}</div>}
          {ok && <div className="text-xs text-success">{ok}</div>}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={addField}
              className="h-10 rounded-md border border-border bg-bg px-4 text-sm"
            >
              Add Field
            </button>
            <button
              onClick={save}
              disabled={hasDuplicateKeys || invalids.size > 0}
              className="h-10 rounded-md bg-primary px-5 text-sm text-white disabled:opacity-50"
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
      </div>

      {(hasDuplicateKeys || invalids.size > 0) && (
        <div className="text-sm text-amber-600">
          {hasDuplicateKeys ? "Duplicate keys. " : ""}
          {invalids.size ? `${invalids.size} field(s) need label/key.` : ""}
        </div>
      )}
    </div>
  );
}
