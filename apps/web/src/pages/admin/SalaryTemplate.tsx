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
  defaultValue?: any;
  order?: number;
  category?: FieldCategory;
  autoKey?: boolean;
  amountType?: "fixed" | "percent";
  locked?: boolean; // UI-only lock
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

// FIRST 4 ARE SYSTEM:
const PROTECTED_KEYS = new Set([
  "basic_earned",
  "hra",
  "medical",
  "other_allowances",
]);

export default function SalaryTemplate() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [fields, setFields] = useState<Field[]>([]);
  // Kept for payload compatibility; no separate UI for these
  const [settings, setSettings] = useState<Settings>({
    basicPercent: 35,
    hraPercent: 45,
    medicalAmount: 1500,
  });

  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | FieldCategory>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | FieldType>("all");

  // Load template
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const res = await api.get("/salary/templates");
        const rawFields = (res.data.template?.fields || []) as any[];
        const s = (res.data.template?.settings || {}) as Partial<Settings>;

        let normalized: Field[] = rawFields
          .map((fld: any, i: number) => {
            const key = fld.key || slugify(fld.label || "");
            const isProtected = PROTECTED_KEYS.has(key) || !!fld.locked;
            return {
              id: fld.id || uid(),
              key,
              label: fld.label || "",
              type: (fld.type as FieldType) || "text",
              defaultValue: fld.defaultValue ?? "",
              category: (fld.category as FieldCategory) || "info",
              order: Number.isFinite(fld.order) ? fld.order : i,
              autoKey: !fld.key || fld.key === slugify(fld.label),
              amountType: (fld.amountType as "fixed" | "percent") || "fixed",
              locked: isProtected,
            } as Field;
          })
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        // Hydrate system field values from settings (if API didn't send defaults)
        for (const f of normalized) {
          if (f.key === "basic_earned") {
            const v = Number.isFinite(Number(s.basicPercent))
              ? Number(s.basicPercent)
              : undefined;
            if (v !== undefined) f.defaultValue = v;
            else if (f.defaultValue == null) f.defaultValue = 0;
          } else if (f.key === "hra") {
            const v = Number.isFinite(Number(s.hraPercent))
              ? Number(s.hraPercent)
              : undefined;
            if (v !== undefined) f.defaultValue = v;
            else if (f.defaultValue == null) f.defaultValue = 0;
          } else if (f.key === "medical") {
            const v = Number.isFinite(Number(s.medicalAmount))
              ? Number(s.medicalAmount)
              : undefined;
            if (v !== undefined) f.defaultValue = v;
            else if (f.defaultValue == null) f.defaultValue = 0;
          } else if (f.key === "other_allowances") {
            if (f.defaultValue == null) f.defaultValue = 0;
          }
        }

        // Keep settings state in sync (for payload compatibility)
        setSettings({
          basicPercent: Number.isFinite(Number(s.basicPercent))
            ? Number(s.basicPercent)
            : Number(
                normalized.find((x) => x.key === "basic_earned")?.defaultValue
              ) || 0,
          hraPercent: Number.isFinite(Number(s.hraPercent))
            ? Number(s.hraPercent)
            : Number(normalized.find((x) => x.key === "hra")?.defaultValue) ||
              0,
          medicalAmount: Number.isFinite(Number(s.medicalAmount))
            ? Number(s.medicalAmount)
            : Number(
                normalized.find((x) => x.key === "medical")?.defaultValue
              ) || 0,
        });

        setFields(normalized);
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

  // Validation
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

  // Save template — settings mirror system field values
  const save = useCallback(async () => {
    try {
      setErr(null);
      setOk(null);

      const basic = fields.find((x) => x.key === "basic_earned");
      const hra = fields.find((x) => x.key === "hra");
      const med = fields.find((x) => x.key === "medical");

      const nextSettings: Settings = {
        basicPercent: Number(basic?.defaultValue ?? settings.basicPercent ?? 0),
        hraPercent: Number(hra?.defaultValue ?? settings.hraPercent ?? 0),
        medicalAmount: Number(med?.defaultValue ?? settings.medicalAmount ?? 0),
      };
      setSettings(nextSettings);

      await api.post("/salary/templates", {
        fields: fields.map((f, i) => ({ ...f, order: i })),
        settings: nextSettings,
      });

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
        defaultValue: "",
        category: "info",
        autoKey: true,
        order: prev.length,
        amountType: "fixed",
      },
    ]);
  }

  // System fields: only value editable
  function updateField(i: number, patch: Partial<Field>) {
    setFields((prev) =>
      prev.map((f, idx) => {
        if (idx !== i) return f;
        const isProtected = f.locked || PROTECTED_KEYS.has(f.key);
        if (isProtected) {
          const allowed: Partial<Field> = {};
          if ("defaultValue" in patch)
            allowed.defaultValue = patch.defaultValue;
          return { ...f, ...allowed, locked: true };
        }
        const next = { ...f, ...patch };
        if (next.autoKey && "label" in patch)
          next.key = slugify(next.label || "");
        if ("key" in patch) next.key = slugify(String(patch.key || ""));
        return next;
      })
    );
  }

  function removeField(i: number) {
    setFields((prev) => {
      const f = prev[i];
      if (f.locked || PROTECTED_KEYS.has(f.key)) return prev; // can't remove system fields
      return prev.filter((_, idx) => idx !== i);
    });
  }

  if (loading) return <div>Loading…</div>;

  return (
    <div className="mx-auto w-full max-w-screen-lg space-y-3 px-3">
      {/* Header / filters */}
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
            className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm sm:w-60"
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
        </div>
      </div>

      {/* Fields list – compact & scrollable */}
      <div className="rounded-md border border-border bg-surface p-2">
        <div className="max-h-[70vh] overflow-auto pr-1">
          {filtered.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
              No fields match.
            </div>
          )}

          <div className="grid grid-cols-1 gap-2">
            {filtered.map((f, iFiltered) => {
              const i = fields.indexOf(f);
              const isDup = f.key && duplicateSet.has(f.key);
              const isInvalid = invalids.has(i);
              const isProtected = f.locked || PROTECTED_KEYS.has(f.key);
              const disableKeyLabel = !!isProtected;

              return (
                <div
                  key={f.id}
                  className={`rounded border ${
                    isInvalid ? "border-amber-600" : "border-border"
                  } bg-white p-2`}
                >
                  {/* Row header chips */}
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] ${
                        (f.category || "info") === "earning"
                          ? "bg-emerald-100 text-emerald-800"
                          : (f.category || "info") === "deduction"
                          ? "bg-rose-100 text-rose-800"
                          : "bg-slate-100 text-slate-800"
                      }`}
                    >
                      {f.category || "info"}
                    </span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-800">
                      {f.type}
                    </span>
                    {isProtected && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                        system
                      </span>
                    )}
                    <div className="ml-auto">
                      {!isProtected && (
                        <button
                          className="text-xs text-error underline"
                          onClick={() => removeField(i)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inputs grid – dense */}
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                    {/* Label */}
                    <div>
                      <div className="mb-0.5 text-[10px] text-muted">Label</div>
                      <input
                        value={f.label}
                        onChange={(e) =>
                          updateField(i, {
                            label: e.target.value,
                            ...(f.autoKey
                              ? { key: slugify(e.target.value) }
                              : {}),
                          })
                        }
                        disabled={disableKeyLabel}
                        className="h-9 w-full rounded border border-border bg-bg px-2 text-sm disabled:opacity-60"
                        placeholder="Basic Earned"
                      />
                    </div>

                    {/* Key */}
                    <div>
                      <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted">
                        <span>Key</span>
                        <label className="inline-flex items-center gap-1 text-[10px]">
                          <input
                            type="checkbox"
                            checked={!!f.autoKey}
                            onChange={(e) =>
                              updateField(i, { autoKey: e.target.checked })
                            }
                            disabled={disableKeyLabel}
                          />
                          Auto
                        </label>
                      </div>
                      <input
                        value={f.key}
                        onChange={(e) =>
                          updateField(i, { key: slugify(e.target.value) })
                        }
                        disabled={disableKeyLabel || !!f.autoKey}
                        className={`h-9 w-full rounded border px-2 text-sm ${
                          isDup ? "border-error" : "border-border"
                        } bg-bg disabled:opacity-60`}
                        placeholder="basic_earned"
                      />
                    </div>

                    {/* Type / Category */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="mb-0.5 text-[10px] text-muted">
                          Type
                        </div>
                        <select
                          value={f.type}
                          onChange={(e) =>
                            updateField(i, {
                              type: e.target.value as FieldType,
                              defaultValue: "",
                            })
                          }
                          disabled={isProtected}
                          className="h-9 w-full rounded border border-border bg-bg px-2 text-sm disabled:opacity-60"
                        >
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="date">Date</option>
                        </select>
                      </div>
                      <div>
                        <div className="mb-0.5 text-[10px] text-muted">
                          Category
                        </div>
                        <select
                          value={f.category || "info"}
                          onChange={(e) =>
                            updateField(i, {
                              category: e.target.value as FieldCategory,
                            })
                          }
                          disabled={isProtected}
                          className="h-9 w-full rounded border border-border bg-bg px-2 text-sm disabled:opacity-60"
                        >
                          <option value="info">Info</option>
                          <option value="earning">Earning</option>
                          <option value="deduction">Deduction</option>
                        </select>
                      </div>
                    </div>

                    {/* Value (+ amountType for non-system numbers) */}
                    <div>
                      <div className="mb-0.5 text-[10px] text-muted">Value</div>
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
                        className="h-9 w-full rounded border border-border bg-bg px-2 text-sm"
                      />
                      {f.type === "number" && !isProtected && (
                        <div className="mt-1 grid grid-cols-2 gap-2">
                          <select
                            value={f.amountType || "fixed"}
                            onChange={(e) =>
                              updateField(i, {
                                amountType: e.target.value as
                                  | "fixed"
                                  | "percent",
                              })
                            }
                            className="h-8 w-full rounded border border-border bg-bg px-2 text-xs"
                          >
                            <option value="fixed">Fixed</option>
                            <option value="percent">Percent</option>
                          </select>
                          <span className="self-center text-[10px] text-muted">
                            {f.amountType === "percent"
                              ? "Interpreted as %"
                              : "Fixed amount"}
                          </span>
                        </div>
                      )}
                      {f.type === "number" && isProtected && (
                        <div className="mt-1 text-[10px] text-amber-700">
                          {f.key === "basic_earned"
                            ? "Basic Earned (value only)"
                            : f.key === "hra"
                            ? "HRA (value only)"
                            : f.key === "medical"
                            ? "Medical (value only)"
                            : "Other Allowances (value only)"}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Sticky bottom bar */}
      <div className="sticky bottom-0 left-0 right-0 z-10 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex max-w-screen-lg items-center gap-2 px-3 py-2">
          {err && <div className="text-xs text-error">{err}</div>}
          {ok && <div className="text-xs text-success">{ok}</div>}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={addField}
              className="h-9 rounded border border-border bg-bg px-3 text-sm"
            >
              Add Field
            </button>
            <button
              onClick={save}
              disabled={hasDuplicateKeys || invalids.size > 0}
              className="h-9 rounded bg-primary px-4 text-sm text-white disabled:opacity-50"
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
